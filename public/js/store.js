/**
 * Kassaning mahalliy holati — internetsiz ishlash shu yerda.
 *
 * Ko'rinadigan buyurtma = serverdan kelgan oxirgi holat + hali yuborilmagan amallar (outbox).
 * Har amal avval shu yerda yadro (core.applyOp) bilan tekshiriladi — noto'g'ri bo'lsa
 * navbatga umuman tushmaydi. Navbat localStorage'da: sahifa yopilib qolsa ham yo'qolmaydi.
 */
import { applyOp, OpError } from './core.js';
import { get, post } from './api.js';
import { uid } from './ui.js';

const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* xotira to'lsa — navbat hamon xotirada */ } },
};

const listeners = new Set();
export const S = {
  boot: LS.get('ordo.boot', null),
  server: new Map((LS.get('ordo.orders', [])).map((o) => [o.id, o])),
  outbox: LS.get('ordo.outbox', []),
  recent: LS.get('ordo.recent', []),
  shift: LS.get('ordo.shift', null),
  notes: LS.get('ordo.notes', []),
  stop: new Set(LS.get('ordo.stop', [])),
  online: navigator.onLine !== false,
  syncing: false,
  lastSync: LS.get('ordo.lastSync', null),
  failed: LS.get('ordo.failed', []),
  user: null,
};

export const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((fn) => { try { fn(S); } catch (e) { console.error(e); } });

function persist() {
  LS.set('ordo.orders', [...S.server.values()].filter((o) => o.status === 'open'));
  LS.set('ordo.outbox', S.outbox);
  LS.set('ordo.recent', S.recent.slice(0, 300));
  LS.set('ordo.shift', S.shift);
  LS.set('ordo.notes', S.notes);
  LS.set('ordo.stop', [...S.stop]);
}

export const usersCtx = () => ({ users: new Map((S.boot?.staff || []).map((u) => [u.id, { role: u.role, active: true }])) });

/** Barcha buyurtmalar: server + kutilayotgan amallar. */
export function orders() {
  const map = new Map([...S.server.entries()]);
  const ctx = usersCtx();
  for (const op of S.outbox) {
    if (!op.order_id) continue;
    try { map.set(op.order_id, applyOp(map.get(op.order_id) || null, op, ctx)); } catch { /* server holati o'zgargan — keyingi sinxronda tuzaladi */ }
  }
  return map;
}
export const openOrders = () => [...orders().values()].filter((o) => o.status === 'open');
export const order = (id) => orders().get(id) || null;

/** Smena: server + kutilayotgan smena amallari. */
export function shift() {
  let sh = S.shift;
  for (const op of S.outbox) {
    if (op.type === 'shift.open' && !sh) sh = { id: op.data.shift_id, opened_at: op.at, opening_cash: op.data.cash, opened_by: op.by, status: 'open', pending: true };
    if (op.type === 'shift.close' && sh?.id === op.data.shift_id) sh = null;
  }
  return sh;
}

export function notes() {
  const list = [...S.notes];
  for (const op of S.outbox) {
    if (op.type === 'note.add') list.unshift({ id: op.data.note_id, text: op.data.text, user_id: op.by, at: op.at, pending: true });
    if (op.type === 'note.done') { const i = list.findIndex((n) => n.id === op.data.note_id); if (i >= 0) list.splice(i, 1); }
  }
  return list;
}

/**
 * Amal: avval mahalliy tekshiruv (xato bo'lsa OpError tashlanadi va hech narsa o'zgarmaydi),
 * keyin navbat. Buyurtmaga tegishli bo'lmagan amallar (smena, rasxod...) serverda tekshiriladi.
 */
export function dispatch(type, data = {}, orderId = null) {
  const op = { id: uid('p'), type, order_id: orderId, by: S.user?.id, at: new Date().toISOString(), data };
  if (!op.by) throw new OpError('no_user', 'Xodim tanlanmagan');
  if (orderId) {
    const cur = order(orderId);
    const next = applyOp(cur, op, usersCtx());
    if (next.status !== 'open' && cur?.status === 'open') rememberClosed(next);
  }
  S.outbox.push(op);
  persist();
  emit();
  flushSoon();
  return op;
}

function rememberClosed(doc) {
  S.recent = [doc, ...S.recent.filter((o) => o.id !== doc.id)].slice(0, 300);
}

export function nextNumber(shiftId) {
  const c = LS.get('ordo.counter', { shift: null, n: 0 });
  if (c.shift !== shiftId) { c.shift = shiftId; c.n = 0; }
  // Boshqa kassa yoki oldingi sahifada berilgan raqamlar ham hisobga olinadi — takrorlanmasin.
  const seen = [...orders().values(), ...S.recent].filter((o) => o.shift_id === shiftId).map((o) => Number(o.number) || 0);
  const server = S.shift?.id === shiftId ? Number(S.shift.last_number) || 0 : 0;
  c.n = Math.max(c.n, server, ...seen, 0) + 1;
  LS.set('ordo.counter', c);
  return c.n;
}

let timer = null;
export function flushSoon(ms = 150) { clearTimeout(timer); timer = setTimeout(tick, ms); }

async function tick() {
  if (S.syncing) return flushSoon(400);
  S.syncing = true;
  try {
    if (S.outbox.length) await flush();
    else await pull();
    S.online = true;
  } catch (e) {
    S.online = !e.offline ? S.online : false;
    if (e.status === 401) location.href = '/?qurilma=1&keyin=' + encodeURIComponent(location.pathname);
  } finally {
    S.syncing = false;
    emit();
    clearTimeout(timer);
    timer = setTimeout(tick, S.outbox.length ? (S.online ? 1500 : 6000) : 5000);
  }
}

async function flush() {
  const batch = S.outbox.slice(0, 100);
  const r = await post('/api/sync', { ops: batch });
  const done = new Set(r.results.map((x) => x.id));
  for (const x of r.results) {
    if (!x.ok && !x.dup) {
      const op = batch.find((o) => o.id === x.id);
      S.failed.unshift({ ...x, op, at: new Date().toISOString() });
    }
  }
  S.failed = S.failed.slice(0, 50); LS.set('ordo.failed', S.failed);
  S.outbox = S.outbox.filter((o) => !done.has(o.id));
  for (const doc of r.orders || []) {
    if (doc.status === 'open') S.server.set(doc.id, doc);
    else { S.server.delete(doc.id); rememberClosed(doc); }
  }
  S.shift = r.shift || null;
  S.lastSync = new Date().toISOString();
  LS.set('ordo.lastSync', S.lastSync);
  persist();
  if (S.outbox.length) flushSoon(50);
  else await pull();
}

async function pull() {
  const r = await get('/api/state');
  // Navbatda amali bor buyurtma serverdan kelgani bilan almashtiriladi — kutilayotgan amallar ustiga qayta qo'llanadi.
  const open = new Map(r.orders.map((o) => [o.id, o]));
  for (const [id, o] of S.server) if (!open.has(id) && o.status === 'open') S.server.delete(id);
  for (const [id, o] of open) S.server.set(id, o);
  S.stop = new Set(r.stop);
  S.shift = r.shift || null;
  S.notes = r.notes || [];
  S.lastSync = new Date().toISOString();
  LS.set('ordo.lastSync', S.lastSync);
  persist();
}

export async function refreshBoot() {
  const b = await get('/api/boot');
  S.boot = b;
  LS.set('ordo.boot', b);
  emit();
  return b;
}

export function start() {
  window.addEventListener('online', () => { S.online = true; flushSoon(10); });
  window.addEventListener('offline', () => { S.online = false; emit(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushSoon(10); });
  flushSoon(10);
}

export const stationName = (id) => S.boot?.stations.find((s) => s.id === id)?.name || 'Oshxona';
export const tableName = (id) => S.boot?.tables.find((t) => t.id === id)?.name || '';
export const hallOf = (tableId) => S.boot?.halls.find((h) => h.id === S.boot.tables.find((t) => t.id === tableId)?.hall_id);
export const staffName = (id) => S.boot?.staff.find((u) => u.id === id)?.name || '';
export const product = (id) => S.boot?.products.find((p) => p.id === id);
export const setting = (k, d = '') => S.boot?.settings?.[k] ?? d;
