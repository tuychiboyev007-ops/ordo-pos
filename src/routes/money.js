/**
 * Pul: nasiya (mijoz qarzi), yetkazib beruvchilar va ularga qarz, rasxodlar, bosh sahifa.
 */
import { salesCost } from '../lib/cost.js';
import { json, fail, body, str, int, isDay, dayRange } from '../lib/http.js';
import { PAY_METHODS } from '../../public/js/core.js';

const n = (v) => Number(v) || 0;
const ID = /^[A-Za-z0-9_-]{6,64}$/;
const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// ---------- Nasiya ----------
export async function debts(req, env, db, auth) {
  const rows = await db.all(`SELECT c.id, c.name, c.phone, c.note, c.debt::float8 AS debt,
    (SELECT MAX(at) FROM debt_moves m WHERE m.company_id = c.company_id AND m.customer_id = c.id AND m.kind = 'qarz') AS last_debt,
    (SELECT MAX(at) FROM debt_moves m WHERE m.company_id = c.company_id AND m.customer_id = c.id AND m.kind = 'tolov') AS last_pay
    FROM customers c WHERE c.company_id = ? ORDER BY c.debt DESC, c.name LIMIT 1000`, auth.c);
  return json({ ok: true, customers: rows, total: rows.reduce((s, r) => s + Math.max(0, r.debt), 0) });
}

export async function debt(req, env, db, auth) {
  const id = new URL(req.url).searchParams.get('id') || '';
  const c = await db.first('SELECT id, name, phone, note, debt::float8 AS debt FROM customers WHERE company_id = ? AND id = ?', auth.c, id);
  if (!c) return fail(404, 'not_found');
  const moves = await db.all(`SELECT m.id, m.kind, m.amount::float8 AS amount, m.order_id, m.method, m.note, m.at, u.name AS user_name, o.number
    FROM debt_moves m LEFT JOIN users u ON u.id = m.user_id AND u.company_id = m.company_id LEFT JOIN orders o ON o.id = m.order_id AND o.company_id = m.company_id
    WHERE m.company_id = ? AND m.customer_id = ? ORDER BY m.at DESC LIMIT 500`, auth.c, id);
  return json({ ok: true, customer: c, moves });
}

/** Boshqaruvdan: yangi mijoz, eski qarz yozish, kassasiz to'lov (karta/bank). */
export async function saveCustomer(req, env, db, auth) {
  const b = await body(req);
  const name = str(b.name, 80); const phone = str(b.phone, 30);
  if (!name && !phone) return fail(400, 'need_name', 'Ism yoki telefon kerak');
  if (b.id) {
    const r = await db.all('UPDATE customers SET name = ?, phone = ?, note = ? WHERE company_id = ? AND id = ? RETURNING id', name, phone, str(b.note, 200), auth.c, String(b.id));
    return r.length ? json({ ok: true, id: b.id }) : fail(404, 'not_found');
  }
  const id = newId('c');
  await db.run('INSERT INTO customers (company_id, id, name, phone, note) VALUES (?, ?, ?, ?, ?)', auth.c, id, name, phone, str(b.note, 200));
  return json({ ok: true, id });
}

export async function debtMove(req, env, db, auth) {
  const b = await body(req);
  const kind = b.kind === 'qarz' ? 'qarz' : 'tolov';
  const amount = int(b.amount);
  if (!(amount > 0)) return fail(400, 'bad_amount', 'Summa noto\'g\'ri');
  const method = PAY_METHODS.includes(b.method) && b.method !== 'qarz' ? b.method : 'karta';
  if (kind === 'tolov' && method === 'naqd') return fail(400, 'use_kassa', 'Naqd to\'lovni kassadan qabul qiling — kassa puli bilan mos kelsin');
  const r = await db.tx(async (tx) => {
    const c = await tx.first('SELECT id, debt FROM customers WHERE company_id = ? AND id = ? FOR UPDATE', auth.c, String(b.customer_id || ''));
    if (!c) return 'not_found';
    if (kind === 'tolov' && amount > n(c.debt)) return 'over';
    await tx.run(`INSERT INTO debt_moves (company_id, id, customer_id, kind, amount, method, note, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())`,
      auth.c, newId('d'), c.id, kind, amount, kind === 'tolov' ? method : null, str(b.note, 200) || (kind === 'qarz' ? 'Eski qarz' : null), auth.u);
    await tx.run('UPDATE customers SET debt = debt + ? WHERE company_id = ? AND id = ?', kind === 'qarz' ? amount : -amount, auth.c, c.id);
    return 'ok';
  });
  if (r === 'not_found') return fail(404, 'not_found');
  if (r === 'over') return fail(409, 'over_debt', 'Qarzdan ko\'p to\'lov');
  return json({ ok: true });
}

// ---------- Yetkazib beruvchilar ----------
export async function suppliers(req, env, db, auth) {
  const rows = await db.all(`SELECT s.id, s.name, s.phone, s.note, s.debt::float8 AS debt,
    (SELECT MAX(at) FROM supplier_moves m WHERE m.company_id = s.company_id AND m.supplier_id = s.id AND m.kind = 'kirim') AS last_in
    FROM suppliers s WHERE s.company_id = ? AND s.active = true ORDER BY s.name`, auth.c);
  return json({ ok: true, suppliers: rows, total: rows.reduce((s, r) => s + Math.max(0, r.debt), 0) });
}

export async function saveSupplier(req, env, db, auth) {
  const b = await body(req); const id = int(b.id, 0);
  const name = str(b.name, 80); if (!name) return fail(400, 'need_name', 'Nomi kerak');
  if (id) {
    const r = await db.all('UPDATE suppliers SET name = ?, phone = ?, note = ? WHERE company_id = ? AND id = ? RETURNING id', name, str(b.phone, 30), str(b.note, 200), auth.c, id);
    return r.length ? json({ ok: true, id }) : fail(404, 'not_found');
  }
  const r = await db.first('INSERT INTO suppliers (company_id, name, phone, note) VALUES (?, ?, ?, ?) RETURNING id', auth.c, name, str(b.phone, 30), str(b.note, 200));
  return json({ ok: true, id: r.id });
}

export async function supplierPay(req, env, db, auth) {
  const b = await body(req);
  const amount = int(b.amount);
  if (!(amount > 0)) return fail(400, 'bad_amount', 'Summa noto\'g\'ri');
  const payFrom = ['kassa', 'karta', 'bank', 'boshqa'].includes(b.pay_from) ? b.pay_from : 'boshqa';
  const r = await db.tx(async (tx) => {
    const s = await tx.first('SELECT id, debt FROM suppliers WHERE company_id = ? AND id = ? FOR UPDATE', auth.c, int(b.supplier_id));
    if (!s) return 'not_found';
    let shift = null;
    if (payFrom === 'kassa') {
      shift = await tx.first("SELECT id FROM shifts WHERE company_id = ? AND status = 'open' LIMIT 1", auth.c);
      if (!shift) return 'no_shift';
    }
    await tx.run("INSERT INTO supplier_moves (company_id, supplier_id, kind, amount, pay_from, shift_id, note, user_id, at) VALUES (?, ?, 'tolov', ?, ?, ?, ?, ?, now())",
      auth.c, s.id, amount, payFrom, shift?.id || null, str(b.note, 200), auth.u);
    await tx.run('UPDATE suppliers SET debt = debt - ? WHERE company_id = ? AND id = ?', amount, auth.c, s.id);
    return 'ok';
  });
  if (r === 'not_found') return fail(404, 'not_found');
  if (r === 'no_shift') return fail(409, 'no_shift', 'Kassadan to\'lash uchun smena ochiq bo\'lishi kerak');
  return json({ ok: true });
}

export async function supplier(req, env, db, auth) {
  const id = int(new URL(req.url).searchParams.get('id'));
  const s = await db.first('SELECT id, name, phone, note, debt::float8 AS debt FROM suppliers WHERE company_id = ? AND id = ?', auth.c, id);
  if (!s) return fail(404, 'not_found');
  const moves = await db.all(`SELECT m.id, m.kind, m.amount::float8 AS amount, m.doc_id, m.pay_from, m.note, m.at, u.name AS user_name
    FROM supplier_moves m LEFT JOIN users u ON u.id = m.user_id AND u.company_id = m.company_id WHERE m.company_id = ? AND m.supplier_id = ? ORDER BY m.at DESC, m.id DESC LIMIT 500`, auth.c, id);
  return json({ ok: true, supplier: s, moves });
}

// ---------- Rasxod ----------
export const EXPENSE_CATS = ['Ish haqi', 'Ijara', 'Kommunal', 'Transport', 'Xo\'jalik mollari', 'Ta\'mirlash', 'Reklama', 'Soliq', 'Boshqa'];

export async function expenses(req, env, db, auth) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from'); const to = url.searchParams.get('to') || from;
  if (!isDay(from) || !isDay(to) || to < from) return fail(400, 'bad_range', 'Sana noto\'g\'ri');
  const [f, t] = dayRange(from, to);
  const rows = await db.all(`SELECT e.id, e.category, e.amount::float8 AS amount, e.note, e.pay_from, e.at, u.name AS user_name FROM expenses e
    LEFT JOIN users u ON u.id = e.user_id AND u.company_id = e.company_id WHERE e.company_id = ? AND e.deleted_at IS NULL AND e.at >= ? AND e.at < ? ORDER BY e.at DESC LIMIT 2000`, auth.c, f, t);
  const by = await db.all(`SELECT category, COUNT(*)::int AS n, SUM(amount)::float8 AS sum FROM expenses WHERE company_id = ? AND deleted_at IS NULL AND at >= ? AND at < ?
    GROUP BY category ORDER BY sum DESC`, auth.c, f, t);
  const tot = await db.first('SELECT COALESCE(SUM(amount), 0)::float8 AS sum, COUNT(*)::int AS n FROM expenses WHERE company_id = ? AND deleted_at IS NULL AND at >= ? AND at < ?', auth.c, f, t);
  return json({ ok: true, expenses: rows, by_category: by, total: tot.sum, count: tot.n, truncated: tot.n > rows.length, categories: EXPENSE_CATS });
}

export async function saveExpense(req, env, db, auth) {
  const b = await body(req);
  const amount = int(b.amount); if (!(amount > 0)) return fail(400, 'bad_amount', 'Summa noto\'g\'ri');
  const cat = str(b.category, 60); if (!cat) return fail(400, 'need_category', 'Rasxod turi kerak');
  const payFrom = ['kassa', 'karta', 'bank', 'boshqa'].includes(b.pay_from) ? b.pay_from : 'boshqa';
  let shift = null;
  if (payFrom === 'kassa') {
    shift = await db.first("SELECT id FROM shifts WHERE company_id = ? AND status = 'open' LIMIT 1", auth.c);
    if (!shift) return fail(409, 'no_shift', 'Kassadan rasxod uchun smena ochiq bo\'lishi kerak');
  }
  const id = ID.test(String(b.id || '')) ? String(b.id) : newId('e');
  await db.run(`INSERT INTO expenses (company_id, id, category, amount, note, pay_from, shift_id, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, now())
    ON CONFLICT (id) DO NOTHING`, auth.c, id, cat, amount, str(b.note, 200), payFrom, shift?.id || null, auth.u);
  return json({ ok: true, id });
}

export async function deleteExpense(req, env, db, auth) {
  const b = await body(req);
  const e = await db.first('SELECT id, shift_id FROM expenses WHERE company_id = ? AND id = ? AND deleted_at IS NULL', auth.c, String(b.id || ''));
  if (!e) return fail(404, 'not_found');
  if (e.shift_id) {
    const sh = await db.first('SELECT status FROM shifts WHERE company_id = ? AND id = ?', auth.c, e.shift_id);
    if (sh?.status === 'closed') return fail(409, 'shift_closed', 'Yopilgan smenadagi kassa rasxodi o\'chmaydi');
  }
  await db.run('UPDATE expenses SET deleted_at = now(), deleted_by = ? WHERE company_id = ? AND id = ?', auth.u, auth.c, e.id);
  return json({ ok: true });
}

// ---------- Bosh sahifa ----------
export async function dashboard(req, env, db, auth) {
  const day = new URL(req.url).searchParams.get('day');
  if (!isDay(day)) return fail(400, 'bad_day');
  const [f, t] = dayRange(day, day); const c = auth.c;
  const sales = await db.first(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total), 0)::float8 AS total, COALESCE(SUM(guests), 0)::int AS guests
    FROM orders WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ?`, c, f, t);
  const open = await db.first("SELECT COUNT(*)::int AS n, COALESCE(SUM(total), 0)::float8 AS sum FROM orders WHERE company_id = ? AND status = 'open'", c);
  const methods = await db.all(`SELECT p.method, SUM(p.amount)::float8 AS sum FROM payments p JOIN orders o ON o.id = p.order_id AND o.company_id = p.company_id
    WHERE p.company_id = ? AND o.status = 'closed' AND o.closed_at >= ? AND o.closed_at < ? GROUP BY p.method`, c, f, t);
  const top = await db.all(`SELECT i.name, SUM(i.qty)::float8 AS qty, SUM(i.sum)::float8 AS sum, i.unit FROM order_items i JOIN orders o ON o.id = i.order_id AND o.company_id = i.company_id
    WHERE i.company_id = ? AND o.status = 'closed' AND i.status <> 'cancelled' AND o.closed_at >= ? AND o.closed_at < ? GROUP BY i.name, i.unit ORDER BY sum DESC LIMIT 8`, c, f, t);
  const hours = await db.all(`SELECT EXTRACT(HOUR FROM ((closed_at AT TIME ZONE 'UTC') + interval '5 hours'))::int AS h, SUM(total)::float8 AS sum FROM orders
    WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ? GROUP BY 1 ORDER BY 1`, c, f, t);
  const cost = { v: (await salesCost(db, c, f, t)).cost };
  const exp = await db.first('SELECT COALESCE(SUM(amount), 0)::float8 AS v FROM expenses WHERE company_id = ? AND deleted_at IS NULL AND at >= ? AND at < ?', c, f, t);
  const waste = await db.first("SELECT COALESCE(-SUM(qty * cost), 0)::float8 AS v FROM stock_moves m WHERE company_id = ? AND kind = 'utilizatsiya' AND at >= ? AND at < ? AND NOT EXISTS (SELECT 1 FROM stock_docs d WHERE d.company_id = m.company_id AND d.id = m.doc_id AND d.cancelled_at IS NOT NULL)", c, f, t);
  const low = await db.all('SELECT id, name, unit, stock, min_stock FROM ingredients WHERE company_id = ? AND active = true AND stock <= min_stock ORDER BY stock - min_stock LIMIT 12', c);
  const debtsTot = await db.first('SELECT COALESCE(SUM(debt) FILTER (WHERE debt > 0), 0)::float8 AS v, COUNT(*) FILTER (WHERE debt > 0)::int AS n FROM customers WHERE company_id = ?', c);
  const supTot = await db.first('SELECT COALESCE(SUM(debt) FILTER (WHERE debt > 0), 0)::float8 AS v FROM suppliers WHERE company_id = ? AND active = true', c);
  const cancels = await db.first(`SELECT COUNT(*)::int AS n, COALESCE(SUM(i.sum), 0)::float8 AS v FROM order_items i JOIN orders o ON o.id = i.order_id AND o.company_id = i.company_id
    WHERE i.company_id = ? AND i.status = 'cancelled' AND i.sent_at IS NOT NULL AND o.closed_at >= ? AND o.closed_at < ?`, c, f, t);
  return json({
    ok: true, day,
    sales: { ...sales, avg: sales.orders ? Math.round(sales.total / sales.orders) : 0 }, open,
    methods, top, hours, food_cost: Math.round(n(cost.v)), expenses: Math.round(n(exp.v)), waste: Math.round(n(waste.v)),
    profit: Math.round(n(sales.total) - n(cost.v) - n(exp.v) - n(waste.v)),
    low: low.map((l) => ({ ...l, stock: n(l.stock), min_stock: n(l.min_stock) })),
    debts: debtsTot, supplier_debt: n(supTot.v), cancels,
  });
}
