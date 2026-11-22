/**
 * Telegram bot bilan aloqa (birinchisi — Mazza Point boti).
 *
 * Kassa restoran ichida ishlaydi, bot esa internetda (Vercel) — bot kassaga o'zi
 * yozolmaydi. Shuning uchun kassa har necha soniyada botdan so'raydi (POST /api/bot/pull):
 *   1) kassada o'zgargan holatlarni botga yuboradi (bot_events navbati) — mijozga xabar boradi;
 *   2) botdagi yangi buyurtmalarni oladi va kassada "Telegram bot" buyurtmasi qilib ochadi;
 *   3) ochiq bot buyurtmalarining botdagi holatini oladi (egasi Telegram'da o'zgartirgan bo'lsa).
 *
 * Bot tomoni: mazza-point-bot/api/pos.js. Kalitni egasi botda /kassa yozib oladi.
 * Buyurtma raqami botdagidek (ext.number) — takror kelsa ikkinchi marta ochilmaydi.
 */
import { applyOp, botCanMove, money, qty3 } from '../../public/js/core.js';
import { json, fail, body, str } from '../lib/http.js';
import { saveOrder, currentShift } from './sync.js';

/** Tizim nomidan qilingan amal (bot buyurtmasini ochish, promokod chegirmasi). */
const SYS = 0;
const sysCtx = { users: new Map([[SYS, { id: SYS, role: 'owner', active: true }]]) };

async function cfgOf(db, c) {
  const rows = await db.all("SELECT key, value FROM settings WHERE company_id = ? AND key LIKE 'bot\\_%'", c);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
const setKey = (db, c, key, value) => db.run(
  'INSERT INTO settings (company_id, key, value) VALUES (?, ?, ?) ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value', c, key, value);

/** Botning /api/pos manziliga so'rov. Javob kelmasa yoki xato bo'lsa — tushunarli matn bilan xato. */
export async function botCall(url, key, payload, timeout = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(String(url).replace(/\/+$/, '') + '/api/pos', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json', 'x-pos-key': key },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) throw new Error('Bot kaliti noto\'g\'ri — botda /kassa yozib yangisini oling');
    if (!res.ok) throw new Error(data.message || `Bot xato qaytardi (${res.status})`);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Bot javob bermadi');
    if (e instanceof TypeError) throw new Error('Botga ulanib bo\'lmadi — manzil yoki internetni tekshiring');
    throw e;
  } finally { clearTimeout(t); }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[‘’ʻʼ`]/g, "'").replace(/,/g, '.').replace(/\s+/g, ' ').trim();
const phone = (d) => { d = String(d || '').replace(/\D/g, '').slice(-9); return d.length === 9 ? `+998 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7)}` : ''; };

/** Botdagi satrni kassadagi taomga moslaydi: "Sous" + "Sirniy" → "Sirniy sous", "Coca-Cola" + "0,5 L" → "Coca-Cola 0,5 L". */
export function matchProduct(line, byName) {
  const name = line.name || ''; const opt = line.option || '';
  for (const k of [opt, `${name} ${opt}`, `${opt} ${name}`, name]) {
    const p = k.trim() && byName.get(norm(k));
    if (p) return p;
  }
  return null;
}

/** Bitta bot buyurtmasini kassada ochadi. Allaqachon bor bo'lsa — hech narsa qilmaydi. */
export async function importOrder(db, c, bo) {
  const number = String(bo.number || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 12);
  if (!number) return false;
  // Bot bazasi tozalanib raqamlar qaytadan boshlangan bo'lsa — yangi "avlod" (eski buyurtma bilan aralashmasin).
  const gen = Number((await db.first("SELECT value FROM settings WHERE company_id = ? AND key = 'bot_gen'", c))?.value || 0);
  const id = gen ? `tg${c}-g${gen}-${number}` : `tg${c}-${number}`;
  return db.tx(async (tx) => {
    if (await tx.first('SELECT id FROM orders WHERE company_id = ? AND id = ?', c, id)) return false;
    const products = await tx.all(`SELECT p.id, p.name, p.unit, COALESCE(p.station_id, k.station_id) AS station_id FROM products p
      LEFT JOIN categories k ON k.id = p.category_id AND k.company_id = p.company_id WHERE p.company_id = ? AND p.active = true`, c);
    const byName = new Map(products.map((p) => [norm(p.name), p]));
    const shift = await currentShift(tx, c);
    const last = shift ? await tx.first('SELECT COALESCE(MAX(number), 0)::int AS n FROM orders WHERE company_id = ? AND shift_id = ?', c, shift.id) : null;
    const at = bo.at ? new Date(Number(bo.at)).toISOString() : new Date().toISOString();
    const pickup = bo.delivery === 'pickup';
    const comment = [
      bo.comment ? String(bo.comment).slice(0, 200) : '',
      bo.pay === 'karta' ? 'To\'lov: kartaga o\'tkazdi (chek botda)' : 'To\'lov: naqd',
      !pickup && bo.fee == null ? 'Yetkazish narxi: operator aytadi' : '',
    ].filter(Boolean).join(' · ');
    let seq = 0;
    const op = (type, data) => ({ id: `${id}-op${seq++}`, type, by: SYS, at, data, order_id: id });
    let doc = applyOp(null, op('open', {
      type: 'bot', number: last ? last.n + 1 : null, shift_id: shift?.id || null, waiter_id: null,
      customer: { name: bo.user || '', phone: phone(bo.phone), address: pickup ? '' : bo.address || '' }, comment,
      ext: { source: 'telegram', number, status: 'new', delivery: pickup ? 'pickup' : 'delivery', pay: bo.pay, user: bo.user, username: bo.username, at, gen },
    }), sysCtx);
    let unmatched = 0;
    for (const [i, l] of (Array.isArray(bo.lines) ? bo.lines : []).slice(0, 60).entries()) {
      const p = matchProduct(l, byName);
      if (!p) unmatched++;
      const q = qty3(l.qty);
      if (!(q > 0)) continue;
      doc = applyOp(doc, op('add', { item: {
        id: `${id}-i${i}`, product_id: p?.id ?? null, name: p?.name || [l.name, l.option].filter(Boolean).join(' · '),
        price: l.gift ? 0 : money(l.price), qty: q, unit: l.unit === 'kg' ? 'kg' : 'dona', station_id: p?.station_id ?? null,
        comment: l.gift ? 'Sovg\'a (bonus)' : p ? '' : 'Menyuda topilmadi — botdagi nomi',
      } }), sysCtx);
    }
    if (!pickup && Number(bo.fee) > 0) {
      doc = applyOp(doc, op('add', { item: { id: `${id}-fee`, product_id: null, name: 'Yetkazib berish', price: money(bo.fee), qty: 1, unit: 'dona', station_id: null } }), sysCtx);
    }
    if (Number(bo.discount) > 0) {
      doc = applyOp(doc, op('discount', { kind: 'sum', value: money(bo.discount), reason: bo.promo ? `Promokod ${String(bo.promo).slice(0, 30)}` : 'Botdagi chegirma' }), sysCtx);
    }
    if (unmatched) doc.ext.unmatched = unmatched;
    await saveOrder(tx, c, doc, false);
    await tx.run('INSERT INTO ops (company_id, id, order_id, type, user_id, at, data) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb) ON CONFLICT (id) DO NOTHING',
      c, `${id}-import`, id, 'bot.import', null, at, JSON.stringify({ number, total: bo.total, lines: (bo.lines || []).length }));
    return true;
  });
}

/** Botdagi holat o'zgargan bo'lsa (egasi Telegram'da bosgan) — kassadagi buyurtmaga ham yoziladi. */
async function applyInbound(db, c, orderId, status) {
  return db.tx(async (tx) => {
    const row = await tx.first("SELECT doc FROM orders WHERE company_id = ? AND id = ? AND status = 'open' FOR UPDATE", c, orderId);
    if (!row?.doc?.ext || !botCanMove(row.doc.ext.status, status)) return false;
    const doc = applyOp(row.doc, { id: `${orderId}-in-${status}`, type: 'ext', by: SYS, at: new Date().toISOString(), data: { status }, order_id: orderId }, sysCtx);
    doc.ext.from_bot = true;
    await saveOrder(tx, c, doc, true);
    return true;
  });
}

/** Kassadagi sync() chaqiradi: bot buyurtmasi holati o'zgarsa — botga yuborish navbatiga. */
export async function queueStatus(tx, c, before, doc, opType) {
  if (doc?.ext?.source !== 'telegram' || !before) return;
  // Eski avlod buyurtmasi (bot raqamlari qaytadan boshlangan) — uning holati botdagi yangi buyurtmaga borib qolmasin.
  const gen = Number((await tx.first("SELECT value FROM settings WHERE company_id = ? AND key = 'bot_gen'", c))?.value || 0);
  if ((doc.ext.gen || 0) !== gen) return;
  let st = null;
  if (doc.status === 'closed' && before.status === 'open') st = 'done';
  else if (doc.status === 'void' && before.status === 'open') st = 'cancelled';
  else if (opType === 'ext' && doc.ext.status !== before.ext?.status) st = doc.ext.status;
  if (st) await tx.run('INSERT INTO bot_events (company_id, number, status, order_id) VALUES (?, ?, ?, ?)', c, doc.ext.number, st, doc.id);
}

/** Kassa har ~8 soniyada chaqiradi. Bir nechta kassa bo'lsa ham bir vaqtda faqat bittasi botga boradi. */
export async function pull(req, env, db, auth) {
  const c = auth.c;
  const cfg = await cfgOf(db, c);
  if (!cfg.bot_url || !cfg.bot_key) return json({ ok: true, off: true });
  const now = Date.now();
  await db.run("INSERT INTO settings (company_id, key, value) VALUES (?, 'bot_pull_at', '0') ON CONFLICT (company_id, key) DO NOTHING", c);
  const claim = await db.first("UPDATE settings SET value = ? WHERE company_id = ? AND key = 'bot_pull_at' AND COALESCE(NULLIF(value, ''), '0')::bigint < ? RETURNING value",
    String(now), c, now - 5000);
  if (!claim) return json({ ok: true, skipped: true });
  let created = 0; let changed = 0; let sent = 0;
  try {
    const evs = await db.all("SELECT id, number, status FROM bot_events WHERE company_id = ? AND sent_at IS NULL AND created_at > now() - interval '24 hours' ORDER BY id LIMIT 20", c);
    for (const ev of evs) {
      try {
        await botCall(cfg.bot_url, cfg.bot_key, { act: 'status', number: ev.number, status: ev.status });
        await db.run('UPDATE bot_events SET sent_at = now(), tries = tries + 1, error = NULL WHERE company_id = ? AND id = ?', c, ev.id);
        sent++;
      } catch (e) {
        await db.run('UPDATE bot_events SET tries = tries + 1, error = ? WHERE company_id = ? AND id = ?', String(e.message).slice(0, 200), c, ev.id);
        break; // bot javob bermayapti — qolganlari keyingi safar; buyurtmalarni olish baribir davom etadi
      }
    }
    const gen = Number(cfg.bot_gen || 0);
    const open = (await db.all("SELECT id, doc FROM orders WHERE company_id = ? AND status = 'open' AND type = 'bot'", c)).filter((r) => (r.doc?.ext?.gen || 0) === gen);
    const numbers = open.map((r) => r.doc?.ext?.number).filter(Boolean);
    // bot_last bo'sh — yangi ulanish: bot faqat oxirgi raqamni aytadi, eski buyurtmalar kassaga tushmaydi.
    const init = cfg.bot_last == null || cfg.bot_last === '';
    const r = await botCall(cfg.bot_url, cfg.bot_key, { act: 'pull', init, after: Number(cfg.bot_last || 0), numbers });
    for (const bo of r.orders || []) if (await importOrder(db, c, bo)) created++;
    for (const row of open) {
      const st = r.statuses?.[row.doc.ext.number];
      if (st && st !== row.doc.ext.status && (await applyInbound(db, c, row.id, st))) changed++;
    }
    // Botdagi raqamlar kassadagidan orqada (bot bazasi tozalangan) — keyingi safar boshidan olinadi.
    if (r.top != null && Number(r.top) < Number(cfg.bot_last || 0)) { await setKey(db, c, 'bot_last', '0'); await setKey(db, c, 'bot_gen', String(gen + 1)); }
    else if (r.last != null) await setKey(db, c, 'bot_last', String(r.last));
    await setKey(db, c, 'bot_error', '');
    await setKey(db, c, 'bot_ok_at', new Date().toISOString());
  } catch (e) {
    await setKey(db, c, 'bot_error', String(e.message).slice(0, 200));
    return json({ ok: true, error: e.message, created, changed, sent });
  }
  return json({ ok: true, created, changed, sent });
}

// ---------- Boshqaruv: ulash va holat ----------

export async function status(req, env, db, auth) {
  const cfg = await cfgOf(db, auth.c);
  const pending = await db.first("SELECT COUNT(*)::int AS n FROM bot_events WHERE company_id = ? AND sent_at IS NULL AND created_at > now() - interval '24 hours'", auth.c);
  const today = await db.first("SELECT COUNT(*)::int AS n FROM orders WHERE company_id = ? AND type = 'bot' AND opened_at > now() - interval '24 hours'", auth.c);
  return json({ ok: true, url: cfg.bot_url || '', key_set: !!cfg.bot_key, last: cfg.bot_last || '', error: cfg.bot_error || '',
    ok_at: cfg.bot_ok_at || null, pending: pending.n, orders_24h: today.n });
}

const goodUrl = (u) => /^https:\/\/[^\s/]+\.[^\s/]+\/?$/i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(u);

/** Manzil va kalitni tekshirib saqlaydi. key bo'sh kelsa — eskisi qoladi. off: true — uzadi. */
export async function save(req, env, db, auth) {
  const b = await body(req);
  const c = auth.c;
  if (b.off) {
    for (const k of ['bot_url', 'bot_key']) await setKey(db, c, k, '');
    return json({ ok: true, off: true });
  }
  const cfg = await cfgOf(db, c);
  const url = str(b.url, 200)?.replace(/\/+$/, '') || '';
  const key = str(b.key, 120) || cfg.bot_key || '';
  if (!goodUrl(url)) return fail(400, 'bad_url', 'Bot manzili https://… ko\'rinishida bo\'lsin (masalan https://mazza-point.vercel.app)');
  if (!key) return fail(400, 'need_key', 'Kalitni kiriting — botda /kassa yozsangiz beradi');
  let ping;
  try { ping = await botCall(url, key, { act: 'ping' }); } catch (e) { return fail(400, 'bot_error', e.message); }
  if (url !== (cfg.bot_url || '')) await setKey(db, c, 'bot_last', ''); // yangi bot — eski buyurtmalar tushmasin
  await setKey(db, c, 'bot_url', url);
  await setKey(db, c, 'bot_key', key);
  await setKey(db, c, 'bot_error', '');
  return json({ ok: true, name: ping.name || '' });
}

export async function check(req, env, db, auth) {
  const cfg = await cfgOf(db, auth.c);
  if (!cfg.bot_url || !cfg.bot_key) return fail(400, 'off', 'Bot ulanmagan');
  try { const p = await botCall(cfg.bot_url, cfg.bot_key, { act: 'ping' }); return json({ ok: true, name: p.name || '' }); } catch (e) { return fail(400, 'bot_error', e.message); }
}
