/**
 * ordo — oshxona ekrani (planshet yoki televizor).
 * Oshxonaga yuborilgan taomlar kartochkada ko'rinadi, oshpaz tayyorini bosadi — kassa va ofitsiantga
 * "tayyor" bo'lib boradi. Olib ketishda buyurtma oldin to'lanadi, shuning uchun yopilgan buyurtma ham
 * (taomi tayyor bo'lgunicha) ekranda turadi. Bosilgan "tayyor" internet uzilsa navbatda turadi.
 */
import { TYPE_NAMES, modsText } from './core.js';
import { get, post, deviceToken } from './api.js';
import { $, $$, esc, qty, time, uid, initials, icon, toast, MARK } from './ui.js';

if (!deviceToken()) location.replace('/?qurilma=1&keyin=/oshxona');

const LS = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* */ } },
};
const st = {
  boot: LS.get('ordo.k.boot', null), user: null, orders: [], outbox: LS.get('ordo.k.outbox', []),
  station: LS.get('ordo.k.station', 'all'), sound: LS.get('ordo.k.sound', true), online: true, now: Date.now(), seen: null,
};
const tableName = (id) => st.boot?.tables.find((t) => t.id === id)?.name || '';
const staffName = (id) => st.boot?.staff.find((u) => u.id === id)?.name || '';

// Navbatdagi (hali serverga yetmagan) belgilar ekranda darhol ko'rinadi.
function readyOf(it) {
  let r = it.ready_at || null;
  for (const op of st.outbox) if (op.data.item_ids.includes(it.id)) r = op.data.undo ? null : op.at;
  return r;
}
const hasStations = () => (st.boot?.stations || []).length > 0;
function visible(it) {
  if (it.status !== 'sent') return false;
  if (hasStations() && !it.station_id) return false; // sexi yo'q (ichimlik, sous) — kassaning o'zida beriladi
  return st.station === 'all' || it.station_id === Number(st.station);
}

// =================== Kirish ===================
function lock() {
  st.user = null; try { localStorage.removeItem('ordo.k.user'); } catch { /* */ }
  const staff = st.boot?.staff || [];
  $('#app').innerHTML = `<div class="k-lock"><div class="lg">${MARK}<b>ordo</b><span>oshxona</span></div><p>Kim ishlayapti?</p>
    <div class="who">${staff.map((u) => `<button data-u="${u.id}"><span class="av" style="background:${esc(u.color || '#3d4a63')}">${esc(initials(u.name))}</span>${esc(u.name)}</button>`).join('')}</div>
    <div class="pin" id="pin" hidden></div></div>`;
  $$('[data-u]').forEach((b) => b.onclick = () => askPin(staff.find((u) => u.id === Number(b.dataset.u))));
}
function askPin(u) {
  const box = $('#pin'); box.hidden = false; $('.k-lock .who').hidden = true;
  let pin = '';
  const draw = () => { box.querySelector('.dots').innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join(''); };
  box.innerHTML = `<div class="nm">${esc(u.name)}</div><div class="dots"></div><div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button data-d="${d}">${d}</button>`).join('')}<button class="fn" data-d="back">Orqaga</button><button data-d="0">0</button><button class="fn" data-d="ok">Kirish</button></div>`;
  draw();
  const check = async () => {
    try { await post('/api/pin', { user_id: u.id, pin }); st.user = u; LS.set('ordo.k.user', u.id); mount(); }
    catch (e) { pin = ''; draw(); toast(e.message || 'PIN noto\'g\'ri', 'bad'); }
  };
  box.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
    const d = b.dataset.d;
    if (d === 'back') { box.hidden = true; $('.k-lock .who').hidden = false; return; }
    if (d === 'ok') return pin.length >= 4 && check();
    if (pin.length < 6) pin += d; draw();
    if (pin.length === 4 || pin.length === 6) check();
  });
}

// =================== Ekran ===================
function mount() {
  $('#app').innerHTML = `<header class="k-top"><span class="mk">${MARK}</span><b>Oshxona</b><div class="seg" id="seg"></div><span class="sp"></span>
      <span class="cnt" id="cnt"></span><span class="net" id="net"></span><button class="ib" id="snd" title="Ovoz"></button>
      <span class="clock" id="clock"></span><button class="ib" id="out" title="Chiqish">${icon('lock')}</button></header>
    <main class="k-board" id="board"></main><section class="k-done" id="done"></section>`;
  $('#out').onclick = lock;
  $('#snd').onclick = () => { st.sound = !st.sound; LS.set('ordo.k.sound', st.sound); if (st.sound) beep(); render(); };
  render(); poll();
}

function cardsOf() {
  const cards = [];
  for (const o of st.orders) {
    const items = o.items.filter(visible).map((it) => ({ ...it, ready: readyOf(it) }));
    if (!items.length) continue;
    const pending = items.filter((i) => !i.ready);
    const first = Math.min(...items.map((i) => Date.parse(i.sent_at) || Date.now()));
    cards.push({ o, items, pending, first, done: !pending.length, lastReady: Math.max(...items.map((i) => (i.ready ? Date.parse(i.ready) : 0))) });
  }
  return cards;
}

function render() {
  if (!st.user || !$('#board')) return;
  const stations = st.boot?.stations || [];
  $('#seg').innerHTML = stations.length ? [['all', 'Hammasi'], ...stations.map((s) => [String(s.id), s.name])].map(([k, l]) => `<button data-st="${k}" class="${String(st.station) === k ? 'on' : ''}">${esc(l)}</button>`).join('') : '';
  const cards = cardsOf();
  const active = cards.filter((c) => !c.done).sort((a, b) => a.first - b.first);
  const done = cards.filter((c) => c.done).sort((a, b) => b.lastReady - a.lastReady).slice(0, 8);
  $('#cnt').textContent = active.length ? `${active.length} ta buyurtma · ${active.reduce((s, c) => s + c.pending.length, 0)} ta taom` : '';
  $('#net').innerHTML = !st.online ? `<span class="off">${icon('offline')}Internet yo'q${st.outbox.length ? ` · ${st.outbox.length}` : ''}</span>` : st.outbox.length ? `<span>${st.outbox.length} navbatda</span>` : '';
  $('#snd').innerHTML = st.sound ? icon('bell') : '<s>Ovoz</s>';
  $('#board').innerHTML = active.map((c) => {
    const min = Math.floor((st.now - c.first) / 60000);
    const cls = min >= 20 ? 'bad' : min >= 10 ? 'warn' : '';
    const where = c.o.type === 'zal' ? `Stol ${esc(tableName(c.o.table_id))}` : esc(TYPE_NAMES[c.o.type] || '');
    return `<article class="tk ${cls}"><header><b>№ ${esc(c.o.number ?? '')}</b><span class="wh">${where}</span><span class="tm">${min} daq</span></header>
      <div class="sub">${esc(staffName(c.o.waiter_id))}${c.o.status === 'closed' ? ' · to\'langan' : ''}${c.o.comment ? ` · <i>${esc(c.o.comment)}</i>` : ''}</div>
      <ul>${c.items.map((it) => `<li class="${it.ready ? 'rd' : ''}" data-it="${it.id}" data-o="${c.o.id}"><span class="q">${it.unit === 'kg' ? qty(it.qty, 'kg') : qty(it.qty)}</span>
        <span class="n">${esc(it.name)}${it.mods?.length ? `<small>${esc(modsText(it))}</small>` : ''}${it.comment ? `<small class="c">! ${esc(it.comment)}</small>` : ''}</span>${it.ready ? icon('check') : ''}</li>`).join('')}</ul>
      <button class="all" data-all="${c.o.id}">${icon('check')}Hammasi tayyor</button></article>`;
  }).join('') || `<div class="k-empty">${icon('check')}<p>Hozircha buyurtma yo'q</p></div>`;
  $('#done').innerHTML = done.length ? `<span class="h">Tayyor bo'lganlar</span>${done.map((c) => `<button data-undo="${c.o.id}" title="Qaytarish">№ ${esc(c.o.number ?? '')} · ${c.o.type === 'zal' ? 'Stol ' + esc(tableName(c.o.table_id)) : esc(TYPE_NAMES[c.o.type] || '')} · ${time(new Date(c.lastReady))}<i>qaytarish</i></button>`).join('')}` : '';
}

function mark(orderId, itemIds, undo = false) {
  if (!itemIds.length) return;
  st.outbox.push({ id: uid('p'), type: 'ready', order_id: orderId, by: st.user.id, at: new Date().toISOString(), data: { item_ids: itemIds, undo } });
  LS.set('ordo.k.outbox', st.outbox);
  render(); flush();
}

async function flush() {
  if (!st.outbox.length) return;
  try {
    const batch = st.outbox.slice(0, 50);
    const r = await post('/api/sync', { ops: batch });
    const done = new Set(r.results.map((x) => x.id));
    st.outbox = st.outbox.filter((o) => !done.has(o.id)); LS.set('ordo.k.outbox', st.outbox);
    for (const doc of r.orders || []) { const i = st.orders.findIndex((o) => o.id === doc.id); if (i >= 0) st.orders[i] = doc; }
    st.online = true;
  } catch (e) { if (e.offline) st.online = false; if (e.status === 401) location.href = '/?qurilma=1&keyin=/oshxona'; }
  render();
}

let pollT = null;
async function poll() {
  clearTimeout(pollT);
  try {
    if (st.outbox.length) await flush();
    const r = await get('/api/kitchen');
    st.orders = r.orders || []; st.online = true;
    // Yangi taom keldi — ovoz.
    const ids = new Set(); for (const o of st.orders) for (const it of o.items) if (visible(it) && !it.ready_at) ids.add(it.id);
    if (st.seen && [...ids].some((x) => !st.seen.has(x))) { if (st.sound) beep(); }
    st.seen = ids;
  } catch (e) { if (e.offline) st.online = false; if (e.status === 401) location.href = '/?qurilma=1&keyin=/oshxona'; }
  render();
  pollT = setTimeout(poll, 4000);
}

let actx = null;
function beep() {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    [0, 0.18].forEach((d) => { const o = actx.createOscillator(); const g = actx.createGain(); o.frequency.value = 880; o.connect(g); g.connect(actx.destination);
      g.gain.setValueAtTime(0.0001, actx.currentTime + d); g.gain.exponentialRampToValueAtTime(0.3, actx.currentTime + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + d + 0.15);
      o.start(actx.currentTime + d); o.stop(actx.currentTime + d + 0.16); });
  } catch { /* */ }
}

document.addEventListener('click', (e) => {
  if (!st.user) return;
  const li = e.target.closest('[data-it]');
  if (li) { const o = st.orders.find((x) => x.id === li.dataset.o); const it = o?.items.find((i) => i.id === li.dataset.it); if (it) mark(o.id, [it.id], !!readyOf(it)); return; }
  const all = e.target.closest('[data-all]');
  if (all) { const o = st.orders.find((x) => x.id === all.dataset.all); if (o) mark(o.id, o.items.filter((i) => visible(i) && !readyOf(i)).map((i) => i.id)); return; }
  const un = e.target.closest('[data-undo]');
  if (un) { const o = st.orders.find((x) => x.id === un.dataset.undo); if (o) mark(o.id, o.items.filter((i) => visible(i) && readyOf(i)).map((i) => i.id), true); return; }
  const sg = e.target.closest('[data-st]');
  if (sg) { st.station = sg.dataset.st; LS.set('ordo.k.station', st.station); render(); }
});
document.addEventListener('pointerdown', () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch { /* */ } }, { passive: true });
setInterval(() => { st.now = Date.now(); const c = $('#clock'); if (c) c.textContent = time(new Date()); render(); }, 15000);

(async () => {
  try { st.boot = await get('/api/boot'); LS.set('ordo.k.boot', st.boot); }
  catch (e) { if (!st.boot) { $('#app').innerHTML = `<div class="k-empty" style="padding-top:100px">${esc(e.message)}<p>Internetni tekshirib, sahifani yangilang.</p></div>`; return; } }
  const saved = LS.get('ordo.k.user', null);
  const u = st.boot.staff.find((x) => x.id === saved);
  if (u) { st.user = u; mount(); } else lock();
  const c = $('#clock'); if (c) c.textContent = time(new Date());
})();
