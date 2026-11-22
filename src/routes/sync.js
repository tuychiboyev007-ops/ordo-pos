/**
 * Kassadan kelgan amallar (ops) navbati.
 *
 * Kassa har amalni avval o'zida qo'llaydi va navbatga qo'yadi; internet bo'lsa
 * darhol, bo'lmasa keyin shu yerga yuboradi. Server har amalni BITTA marta
 * qo'llaydi (ops.id — kalit): aloqa uzilib kassa qayta yuborsa ham buyurtma
 * ikki marta yozilmaydi. Rad etilgan amal ham yoziladi (error bilan) — kassa
 * uni qayta-qayta yubormasin va egasi keyin "nima rad etilgan"ini ko'rsin.
 */
import { applyOp, totals, shiftSummary, OpError, money, PAY_METHODS } from '../../public/js/core.js';
import { json, fail, body, int, str } from '../lib/http.js';
import { consume } from '../lib/stock.js';
import { queueStatus } from './bot.js';
import { unitCosts } from '../lib/cost.js';

const ID = /^[A-Za-z0-9_-]{6,64}$/;

/** Amal vaqti — kassa soatidan. Soat oldinga ketgan bo'lsa (5 daqiqadan ko'p) — server vaqti olinadi. */
function opTime(v) {
  const t = v && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : NaN;
  const now = Date.now();
  return new Date(Number.isNaN(t) || t > now + 5 * 60e3 ? now : t).toISOString();
}

/** Postgres ma'lumot xatolari (22xxx, 23xxx) — amal rad etiladi, butun navbat to'xtab qolmaydi. */
const dataError = (e) => typeof e?.code === 'string' && /^2[23]/.test(e.code);

export async function loadUsers(db, company) {
  const rows = await db.all('SELECT id, role, active FROM users WHERE company_id = ?', company);
  return new Map(rows.map((r) => [r.id, r]));
}

export async function currentShift(db, company) {
  return db.first("SELECT * FROM shifts WHERE company_id = ? AND status = 'open' ORDER BY opened_at DESC LIMIT 1", company);
}

/** Kassadagi pul harakatlari (buyurtmadan tashqari) — X/Z hisobot uchun. */
export async function shiftMoves(db, company, shiftId) {
  const a = await db.all('SELECT kind, amount::float8 AS amount FROM cash_moves WHERE company_id = ? AND shift_id = ?', company, shiftId);
  const e = await db.all("SELECT 'rasxod' AS kind, amount::float8 AS amount FROM expenses WHERE company_id = ? AND shift_id = ? AND pay_from = 'kassa' AND deleted_at IS NULL", company, shiftId);
  const d = await db.all("SELECT 'qarz_tolov' AS kind, amount::float8 AS amount, method FROM debt_moves WHERE company_id = ? AND shift_id = ? AND kind = 'tolov'", company, shiftId);
  const s = await db.all("SELECT 'yetkazuvchi' AS kind, amount::float8 AS amount FROM supplier_moves WHERE company_id = ? AND shift_id = ? AND kind = 'tolov' AND pay_from = 'kassa'", company, shiftId);
  return [...a, ...e, ...d, ...s];
}

export async function saveOrder(tx, company, doc, existed) {
  const t = totals(doc);
  const args = [doc.number, doc.type, doc.table_id, doc.waiter_id, doc.status, doc.guests, doc.opened_at, doc.closed_at,
    doc.shift_id, t.subtotal, t.discount, t.service, t.total, JSON.stringify(doc), doc.rev];
  if (existed) {
    await tx.run(`UPDATE orders SET number = ?, type = ?, table_id = ?, waiter_id = ?, status = ?, guests = ?, opened_at = ?, closed_at = ?,
      shift_id = ?, subtotal = ?, discount = ?, service = ?, total = ?, doc = ?::jsonb, rev = ?, updated_at = now()
      WHERE company_id = ? AND id = ?`, ...args, company, doc.id);
  } else {
    await tx.run(`INSERT INTO orders (company_id, id, number, type, table_id, waiter_id, status, guests, opened_at, closed_at,
      shift_id, subtotal, discount, service, total, doc, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?)`,
    company, doc.id, ...args);
  }
}

/**
 * Buyurtma yopilganda (yoki bekor qilinganda) bir marta: hisobot jadvallari,
 * texnologik karta bo'yicha ombordan ayirish, qarzga to'langan bo'lsa mijoz qarzi.
 */
export async function finalizeOrder(tx, company, doc) {
  await tx.run('DELETE FROM order_items WHERE company_id = ? AND order_id = ?', company, doc.id);
  await tx.run('DELETE FROM payments WHERE company_id = ? AND order_id = ?', company, doc.id);
  const units = doc.items.some((i) => i.product_id) ? await unitCosts(tx, company) : new Map();
  // Qo'shimchalar: tannarxi (masalliqdan yoki qo'lda) va ombordan yechiladigan masalliq.
  const modIds = [...new Set(doc.items.flatMap((i) => (i.mods || []).map((m) => m.id)).filter(Number.isInteger))];
  const modDefs = new Map((modIds.length ? await tx.all(`SELECT m.id, m.cost::float8 AS cost, m.ingredient_id, m.ingredient_qty::float8 AS iq, g.cost::float8 AS icost
    FROM modifiers m LEFT JOIN ingredients g ON g.id = m.ingredient_id AND g.company_id = m.company_id
    WHERE m.company_id = ? AND m.id IN (${modIds.map(() => '?').join(',')})`, company, ...modIds) : []).map((r) => [r.id, r]));
  const modCost = (m) => { const d = modDefs.get(m.id); if (!d) return 0; return d.ingredient_id && d.iq > 0 ? Math.round(d.iq * (Number(d.icost) || 0)) : Math.round(Number(d.cost) || 0); };
  for (const it of doc.items) {
    let uc = it.product_id ? units.get(it.product_id)?.cost || null : null;
    const mc = (it.mods || []).reduce((s, m) => s + modCost(m), 0);
    if (mc) uc = (uc || 0) + mc;
    await tx.run(`INSERT INTO order_items (company_id, id, order_id, product_id, name, price, qty, sum, unit, station_id, status,
      sent_at, cancel_reason, cancelled_by, added_by, closed_at, cost, mods) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    company, it.id, doc.id, it.product_id, it.name, it.price, it.qty, money(it.price * it.qty), it.unit, it.station_id,
    it.status, it.sent_at, it.cancel_reason || null, it.cancelled_by || null, it.added_by || null, doc.closed_at, uc,
    it.mods?.length ? it.mods.map((m) => m.name).join(', ') : null);
  }
  if (doc.status !== 'closed') return;
  for (const p of doc.payments) {
    if (p.void) continue;
    await tx.run('INSERT INTO payments (company_id, id, order_id, method, amount, shift_id, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      company, p.id, doc.id, p.method, p.amount, doc.shift_id, p.by, p.at);
    if (p.method === 'qarz' && doc.customer?.id) {
      const c = doc.customer;
      await tx.run(`INSERT INTO customers (company_id, id, name, phone) VALUES (?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET name = COALESCE(NULLIF(EXCLUDED.name, ''), customers.name), phone = COALESCE(NULLIF(EXCLUDED.phone, ''), customers.phone)
        WHERE customers.company_id = EXCLUDED.company_id`,
      company, c.id, c.name || null, c.phone || null);
      await tx.run(`INSERT INTO debt_moves (company_id, id, customer_id, kind, amount, order_id, shift_id, user_id, at)
        VALUES (?, ?, ?, 'qarz', ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`, company, 'q' + p.id, c.id, p.amount, doc.id, doc.shift_id, p.by, p.at);
      await tx.run('UPDATE customers SET debt = debt + ? WHERE company_id = ? AND id = ?', p.amount, company, c.id);
    }
  }
  const live = doc.items.filter((i) => i.status !== 'cancelled' && i.product_id);
  const extra = [];
  for (const it of doc.items) {
    if (it.status === 'cancelled') continue;
    for (const m of it.mods || []) { const d = modDefs.get(m.id); if (d?.ingredient_id && d.iq > 0) extra.push({ product_id: it.product_id, ingredient_id: d.ingredient_id, qty: d.iq * it.qty }); }
  }
  await consume(tx, company, live.map((i) => ({ product_id: i.product_id, qty: i.qty })), { order_id: doc.id, user_id: doc.closed_by, at: doc.closed_at, extra });
}

async function openShift(tx, company) {
  return tx.first("SELECT id FROM shifts WHERE company_id = ? AND status = 'open' LIMIT 1", company);
}

/** Buyurtmadan tashqari amallar: smena, kassa puli, rasxod, qarz to'lovi, eslatma. */
async function miscOp(tx, company, op, deviceId) {
  const d = op.data || {};
  switch (op.type) {
    case 'shift.open': {
      if (!ID.test(String(d.shift_id || ''))) throw new OpError('bad_shift', 'Smena id si noto\'g\'ri');
      const ex = await tx.first('SELECT id FROM shifts WHERE company_id = ? AND id = ?', company, d.shift_id);
      if (ex) return;
      if (await openShift(tx, company)) throw new OpError('shift_open', 'Ochiq smena bor — avval uni yoping');
      const n = await tx.first('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM shifts WHERE company_id = ?', company);
      await tx.run('INSERT INTO shifts (company_id, id, number, device_id, opened_by, opened_at, opening_cash) VALUES (?, ?, ?, ?, ?, ?, ?)',
        company, d.shift_id, n.n, deviceId, op.by, op.at, Math.max(0, money(d.cash)));
      return;
    }
    case 'shift.cash': case 'shift.close': {
      const sh = await tx.first('SELECT * FROM shifts WHERE company_id = ? AND id = ? FOR UPDATE', company, d.shift_id);
      if (!sh) throw new OpError('no_shift', 'Smena topilmadi');
      if (sh.status !== 'open') throw new OpError('shift_closed', 'Smena yopilgan');
      if (op.type === 'shift.cash') {
        const amount = money(d.amount);
        if (!(amount > 0)) throw new OpError('bad_amount', 'Summa noto\'g\'ri');
        if (!['kirim', 'chiqim'].includes(d.kind)) throw new OpError('bad_kind', 'Turi noto\'g\'ri');
        if (!ID.test(String(d.move_id || ''))) throw new OpError('bad_id', 'Id noto\'g\'ri');
        await tx.run(`INSERT INTO cash_moves (company_id, id, shift_id, kind, amount, reason, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO NOTHING`, company, d.move_id, sh.id, d.kind, amount, String(d.reason || '').slice(0, 160), op.by, op.at);
        return;
      }
      const open = await tx.first("SELECT COUNT(*)::int AS n FROM orders WHERE company_id = ? AND status = 'open'", company);
      if (open.n > 0) throw new OpError('open_orders', `Ochiq buyurtmalar bor (${open.n} ta) — avval yoping`);
      const orders = (await tx.all("SELECT doc FROM orders WHERE company_id = ? AND shift_id = ? AND status <> 'open'", company, sh.id)).map((r) => r.doc);
      const s = shiftSummary(sh, orders, await shiftMoves(tx, company, sh.id));
      const counted = Math.max(0, money(d.counted));
      s.counted_cash = counted; s.diff = counted - s.expected_cash;
      await tx.run(`UPDATE shifts SET status = 'closed', closed_by = ?, closed_at = ?, counted_cash = ?, expected_cash = ?, summary = ?::jsonb
        WHERE company_id = ? AND id = ?`, op.by, op.at, counted, s.expected_cash, JSON.stringify(s), company, sh.id);
      return;
    }
    case 'expense': {
      if (!ID.test(String(d.expense_id || ''))) throw new OpError('bad_id', 'Id noto\'g\'ri');
      const amount = money(d.amount);
      if (!(amount > 0)) throw new OpError('bad_amount', 'Summa noto\'g\'ri');
      const cat = str(d.category, 60); if (!cat) throw new OpError('need_category', 'Rasxod turi kerak');
      const fromKassa = (d.pay_from || 'kassa') === 'kassa';
      let shift = null;
      if (fromKassa) {
        const sh = d.shift_id ? await tx.first('SELECT id, status FROM shifts WHERE company_id = ? AND id = ?', company, d.shift_id) : null;
        if (!sh || sh.status !== 'open') throw new OpError('no_shift', 'Kassadan rasxod uchun smena ochiq bo\'lishi kerak');
        shift = sh.id;
      }
      await tx.run(`INSERT INTO expenses (company_id, id, category, amount, note, pay_from, shift_id, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO NOTHING`, company, d.expense_id, cat, amount, str(d.note, 200), fromKassa ? 'kassa' : str(d.pay_from, 20), shift, op.by, op.at);
      return;
    }
    case 'debt.pay': {
      if (!ID.test(String(d.move_id || ''))) throw new OpError('bad_id', 'Id noto\'g\'ri');
      const amount = money(d.amount);
      if (!(amount > 0)) throw new OpError('bad_amount', 'Summa noto\'g\'ri');
      const method = PAY_METHODS.includes(d.method) && d.method !== 'qarz' ? d.method : 'naqd';
      const cu = await tx.first('SELECT id, debt FROM customers WHERE company_id = ? AND id = ? FOR UPDATE', company, d.customer_id || '');
      if (!cu) throw new OpError('no_customer', 'Mijoz topilmadi');
      if (amount > Number(cu.debt)) throw new OpError('over_debt', 'Qarzdan ko\'p to\'lov');
      const sh = d.shift_id ? await tx.first("SELECT id FROM shifts WHERE company_id = ? AND id = ? AND status = 'open'", company, d.shift_id) : null;
      if (method === 'naqd' && !sh) throw new OpError('no_shift', 'Naqd to\'lov uchun smena ochiq bo\'lishi kerak');
      const r = await tx.all(`INSERT INTO debt_moves (company_id, id, customer_id, kind, amount, method, shift_id, note, user_id, at)
        VALUES (?, ?, ?, 'tolov', ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING RETURNING id`, company, d.move_id, cu.id, amount, method, sh?.id || null, str(d.note, 200), op.by, op.at);
      if (r.length) await tx.run('UPDATE customers SET debt = debt - ? WHERE company_id = ? AND id = ?', amount, company, cu.id);
      return;
    }
    case 'note.add': {
      if (!ID.test(String(d.note_id || ''))) throw new OpError('bad_id', 'Id noto\'g\'ri');
      const text = str(d.text, 500); if (!text) throw new OpError('need_text', 'Matn bo\'sh');
      await tx.run('INSERT INTO notes (company_id, id, text, user_id, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING', company, d.note_id, text, op.by, op.at);
      return;
    }
    case 'note.done': {
      await tx.run('UPDATE notes SET done_at = ?, done_by = ? WHERE company_id = ? AND id = ? AND done_at IS NULL', op.at, op.by, company, String(d.note_id || ''));
      return;
    }
    default: throw new OpError('bad_op', 'Noma\'lum amal');
  }
}

export async function sync(req, env, db, auth) {
  const b = await body(req);
  const ops = Array.isArray(b.ops) ? b.ops.slice(0, 200) : [];
  const company = auth.c;
  const users = await loadUsers(db, company);
  const results = [];
  const touched = new Set();

  for (const raw of ops) {
    const op = {
      id: String(raw?.id || ''), type: String(raw?.type || ''), order_id: raw?.order_id ? String(raw.order_id) : null,
      by: int(raw?.by, 0), at: opTime(raw?.at),
      data: raw?.data && typeof raw.data === 'object' ? raw.data : {},
    };
    if (!ID.test(op.id)) { results.push({ id: op.id, ok: false, error: 'bad_id' }); continue; }
    const seen = await db.first('SELECT error FROM ops WHERE company_id = ? AND id = ?', company, op.id);
    if (seen) { results.push({ id: op.id, ok: !seen.error, dup: true, error: seen.error || undefined }); if (op.order_id) touched.add(op.order_id); continue; }

    let error = null; let message;
    try {
      await db.tx(async (tx) => {
        const u = users.get(op.by);
        if (!u || u.active === false) throw new OpError('bad_user', 'Xodim topilmadi');
        if (!op.order_id) await miscOp(tx, company, op, auth.d);
        else {
          if (!ID.test(op.order_id)) throw new OpError('bad_order', 'Buyurtma id si noto\'g\'ri');
          if ((op.type === 'open' || op.type === 'move') && op.data.table_id != null) {
            const t = await tx.first('SELECT id FROM tables WHERE company_id = ? AND id = ? AND active = true', company, Number(op.data.table_id) || 0);
            if (!t) throw new OpError('bad_table', 'Stol topilmadi');
          }
          const row = await tx.first('SELECT doc FROM orders WHERE company_id = ? AND id = ? FOR UPDATE', company, op.order_id);
          // Bitta stolda ikkita ochiq buyurtma bo'lmasin (ikki kassa bir vaqtda ochsa).
          if ((op.type === 'open' && !row && op.data.type === 'zal') || op.type === 'move') {
            const busy = await tx.first("SELECT number FROM orders WHERE company_id = ? AND status = 'open' AND table_id = ? AND id <> ? LIMIT 1",
              company, Number(op.data.table_id) || 0, op.order_id);
            if (busy) throw new OpError('table_busy', `Bu stolda ochiq buyurtma bor${busy.number ? ` (№${busy.number})` : ''}`);
          }
          // Ikki kassa bir xil raqam bergan bo'lsa — keyingisi navbatdagi raqamni oladi.
          if (op.type === 'open' && !row && op.data.shift_id && Number(op.data.number)) {
            const dup = await tx.first('SELECT id FROM orders WHERE company_id = ? AND shift_id = ? AND number = ? LIMIT 1', company, op.data.shift_id, Number(op.data.number));
            if (dup) {
              const mx = await tx.first('SELECT COALESCE(MAX(number), 0)::int AS n FROM orders WHERE company_id = ? AND shift_id = ?', company, op.data.shift_id);
              op.data = { ...op.data, number: mx.n + 1 };
            }
          }
          // Yopish/bekor qilish — faqat OCHIQ smenaga. Smena boshqa kassada yopilgan bo'lsa — hozirgi ochiq smenaga.
          if (op.type === 'close' || op.type === 'void') {
            const want = op.data.shift_id || row?.doc?.shift_id || null;
            let sh = want ? await tx.first('SELECT id, status FROM shifts WHERE company_id = ? AND id = ?', company, want) : null;
            if (!sh || sh.status !== 'open') sh = await openShift(tx, company);
            if (!sh && op.type === 'close') throw new OpError('no_shift', 'Smena yopiq — buyurtmani yopish uchun smena oching');
            op.data = { ...op.data, shift_id: sh?.id || null };
          }
          const doc = applyOp(row?.doc || null, op, { users });
          if (!row || doc.rev !== row.doc.rev) {
            await saveOrder(tx, company, doc, !!row);
            if (doc.status !== 'open' && (!row || row.doc.status === 'open')) await finalizeOrder(tx, company, doc);
            await queueStatus(tx, company, row?.doc, doc, op.type);
          }
        }
        await tx.run('INSERT INTO ops (company_id, id, order_id, type, user_id, at, data, device_id) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?)',
          company, op.id, op.order_id, op.type, op.by || null, op.at, JSON.stringify(op.data), auth.d || null);
      });
    } catch (e) {
      if (!(e instanceof OpError) && !dataError(e)) throw e;
      error = e instanceof OpError ? e.code : 'db_error';
      message = e instanceof OpError ? e.message : `Ma'lumot saqlanmadi (${e.code})`;
      await db.run('INSERT INTO ops (company_id, id, order_id, type, user_id, at, data, device_id, error) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?) ON CONFLICT (id) DO NOTHING',
        company, op.id, op.order_id, op.type, op.by || null, op.at, JSON.stringify(op.data), auth.d || null, error);
    }
    if (op.order_id) touched.add(op.order_id);
    results.push(error ? { id: op.id, ok: false, error, message } : { id: op.id, ok: true });
  }

  const orders = [];
  for (const id of touched) {
    const r = await db.first('SELECT doc FROM orders WHERE company_id = ? AND id = ?', company, id);
    if (r) orders.push(r.doc);
  }
  return json({ ok: true, results, orders, shift: await currentShift(db, company) });
}

/** Kassa har necha soniyada so'raydi: ochiq buyurtmalar, smena, stop-list, eslatmalar. */
export async function state(req, env, db, auth) {
  const company = auth.c;
  const orders = (await db.all("SELECT doc FROM orders WHERE company_id = ? AND status = 'open' ORDER BY opened_at", company)).map((r) => r.doc);
  const stop = (await db.all('SELECT id FROM products WHERE company_id = ? AND stop = true AND active = true', company)).map((r) => r.id);
  const shift = await currentShift(db, company);
  const notes = await db.all("SELECT id, text, user_id, at FROM notes WHERE company_id = ? AND done_at IS NULL ORDER BY at DESC LIMIT 50", company);
  const last = shift ? await db.first('SELECT COALESCE(MAX(number), 0)::int AS n FROM orders WHERE company_id = ? AND shift_id = ?', company, shift.id) : null;
  if (shift) shift.last_number = last.n;
  await db.run('UPDATE devices SET last_seen = now() WHERE company_id = ? AND id = ?', company, auth.d || 0);
  return json({ ok: true, orders, stop, shift, notes, now: new Date().toISOString() });
}

/**
 * Oshxona ekrani: oshxonaga yuborilgan, hali tayyor bo'lmagan taomlar.
 * Yopilgan buyurtma ham kiradi (olib ketishda oldin to'lanadi) — oxirgi 8 soatdagisi.
 */
export async function kitchen(req, env, db, auth) {
  const company = auth.c;
  const since = new Date(Date.now() - 8 * 3600e3).toISOString();
  const rows = (await db.all(`SELECT doc FROM orders WHERE company_id = ? AND (status = 'open' OR (status = 'closed' AND closed_at > ?)) ORDER BY opened_at LIMIT 400`, company, since)).map((r) => r.doc);
  const cut = Date.now() - 20 * 60e3;
  const orders = rows.filter((o) => o.items.some((i) => i.status === 'sent' && (!i.ready_at || Date.parse(i.ready_at) > cut)));
  return json({ ok: true, orders, now: new Date().toISOString() });
}

/** Mijozlar (nasiya uchun tanlash) — kassa qidiradi. */
export async function customers(req, env, db, auth) {
  const q = (new URL(req.url).searchParams.get('q') || '').trim().toLowerCase();
  const like = '%' + q.replace(/[%_\\]/g, (m) => '\\' + m) + '%';
  const digits = q.replace(/\D/g, '');
  const dlike = digits.length >= 4 ? '%' + digits + '%' : '';
  const rows = await db.all(`SELECT id, name, phone, debt::float8 AS debt FROM customers WHERE company_id = ?
    AND (? = '' OR lower(coalesce(name, '')) LIKE ? OR coalesce(phone, '') LIKE ?
      OR (? <> '' AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') LIKE ?)) ORDER BY debt DESC, name LIMIT 50`, auth.c, q, like, like, dlike, dlike);
  // Telefon to'liq yozilgan bo'lsa — shu raqamdagi oxirgi buyurtmaning ismi va manzili (doimiy mijoz).
  let last = null;
  if (digits.length >= 9) {
    last = await db.first(`SELECT doc->'customer'->>'name' AS name, doc->'customer'->>'address' AS address FROM orders
      WHERE company_id = ? AND regexp_replace(coalesce(doc->'customer'->>'phone', ''), '\\D', '', 'g') LIKE ?
      ORDER BY (coalesce(doc->'customer'->>'address', '') <> '') DESC, opened_at DESC LIMIT 1`, auth.c, '%' + digits.slice(-9));
  }
  return json({ ok: true, customers: rows, last });
}

/** Bir kunlik / smenadagi yopilgan buyurtmalar (kassadagi "Buyurtmalar" ro'yxati). */
export async function ordersOfDay(req, env, db, auth) {
  const url = new URL(req.url);
  const shiftId = url.searchParams.get('shift_id');
  let rows;
  if (shiftId) rows = await db.all("SELECT doc FROM orders WHERE company_id = ? AND shift_id = ? AND status <> 'open' ORDER BY closed_at DESC LIMIT 1000", auth.c, shiftId);
  else {
    const day = url.searchParams.get('day');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return fail(400, 'bad_day');
    const f = new Date(Date.parse(day + 'T00:00:00Z') - 5 * 3600e3).toISOString();
    const t = new Date(Date.parse(day + 'T00:00:00Z') + 19 * 3600e3).toISOString();
    rows = await db.all("SELECT doc FROM orders WHERE company_id = ? AND status <> 'open' AND closed_at >= ? AND closed_at < ? ORDER BY closed_at DESC LIMIT 1000", auth.c, f, t);
  }
  return json({ ok: true, orders: rows.map((r) => r.doc) });
}

export async function shiftReport(req, env, db, auth) {
  const id = new URL(req.url).searchParams.get('id');
  const sh = id ? await db.first('SELECT * FROM shifts WHERE company_id = ? AND id = ?', auth.c, id) : await currentShift(db, auth.c);
  if (!sh) return fail(404, 'no_shift', 'Smena topilmadi');
  if (sh.status === 'closed' && sh.summary) return json({ ok: true, shift: sh, summary: sh.summary });
  const orders = (await db.all("SELECT doc FROM orders WHERE company_id = ? AND shift_id = ? AND status <> 'open'", auth.c, sh.id)).map((r) => r.doc);
  return json({ ok: true, shift: sh, summary: shiftSummary(sh, orders, await shiftMoves(db, auth.c, sh.id)) });
}
