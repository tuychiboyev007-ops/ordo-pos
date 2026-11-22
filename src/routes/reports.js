/**
 * Hisobotlar — faqat yopilgan buyurtmalardan (order_items, payments yopilganda yoziladi).
 * Kun — Toshkent kuni. Har ko'rsatkich alohida so'rovda: bitta JOIN'da yig'ilsa
 * to'lovlar taomlar soniga ko'payib ketardi.
 */
import { json, fail, isDay, dayRange } from '../lib/http.js';
import { salesCost } from '../lib/cost.js';

const LOCAL = (col) => `((${col} AT TIME ZONE 'UTC') + interval '5 hours')`;
const n = (v) => Number(v) || 0;

export async function summary(req, env, db, auth) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from'); const to = url.searchParams.get('to') || from;
  if (!isDay(from) || !isDay(to) || to < from) return fail(400, 'bad_range', 'Sana noto\'g\'ri');
  const [f, t] = dayRange(from, to);
  const c = auth.c;

  const tot = await db.first(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total), 0)::float8 AS total, COALESCE(SUM(subtotal), 0)::float8 AS subtotal,
    COALESCE(SUM(discount), 0)::float8 AS discount, COALESCE(SUM(service), 0)::float8 AS service, COALESCE(SUM(guests), 0)::int AS guests
    FROM orders WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ?`, c, f, t);
  const voids = await db.all(`SELECT id, number, type, table_id, closed_at, doc->>'void_reason' AS reason, (doc->>'void_by')::int AS by, total::float8 AS total
    FROM orders WHERE company_id = ? AND status = 'void' AND closed_at >= ? AND closed_at < ? ORDER BY closed_at DESC LIMIT 200`, c, f, t);
  // To'lovlar — shu davrda YOPILGAN buyurtmalarniki (jami bilan aynan bir to'plam).
  const methods = await db.all(`SELECT p.method, COUNT(*)::int AS n, SUM(p.amount)::float8 AS sum FROM payments p
    JOIN orders o ON o.id = p.order_id AND o.company_id = p.company_id
    WHERE p.company_id = ? AND o.status = 'closed' AND o.closed_at >= ? AND o.closed_at < ? GROUP BY p.method ORDER BY sum DESC`, c, f, t);
  const types = await db.all(`SELECT type, COUNT(*)::int AS n, SUM(total)::float8 AS sum FROM orders
    WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ? GROUP BY type ORDER BY sum DESC`, c, f, t);
  const days = await db.all(`SELECT to_char(${LOCAL('closed_at')}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n, SUM(total)::float8 AS sum FROM orders
    WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ? GROUP BY 1 ORDER BY 1`, c, f, t);
  const hours = await db.all(`SELECT EXTRACT(HOUR FROM ${LOCAL('closed_at')})::int AS h, COUNT(*)::int AS n, SUM(total)::float8 AS sum FROM orders
    WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ? GROUP BY 1 ORDER BY 1`, c, f, t);
  const items = await db.all(`SELECT i.product_id, i.name, SUM(i.qty)::float8 AS qty, SUM(i.sum)::float8 AS sum, i.unit
    FROM order_items i JOIN orders o ON o.id = i.order_id AND o.company_id = i.company_id
    WHERE i.company_id = ? AND o.status = 'closed' AND i.status <> 'cancelled' AND o.closed_at >= ? AND o.closed_at < ?
    GROUP BY i.product_id, i.name, i.unit ORDER BY sum DESC LIMIT 300`, c, f, t);
  const waiters = await db.all(`SELECT o.waiter_id AS id, u.name, COUNT(*)::int AS orders, SUM(o.total)::float8 AS sum, SUM(o.service)::float8 AS service,
    SUM(o.guests)::int AS guests FROM orders o LEFT JOIN users u ON u.id = o.waiter_id AND u.company_id = o.company_id
    WHERE o.company_id = ? AND o.status = 'closed' AND o.closed_at >= ? AND o.closed_at < ? GROUP BY o.waiter_id, u.name ORDER BY sum DESC`, c, f, t);
  // Oshxonaga ketgandan keyin bekor qilingan taomlar — pul nazoratining eng muhim qismi.
  const cancels = await db.all(`SELECT i.name, i.qty::float8 AS qty, i.sum::float8 AS sum, i.cancel_reason AS reason, i.cancelled_by, i.added_by,
    o.number, o.id AS order_id, o.closed_at FROM order_items i JOIN orders o ON o.id = i.order_id AND o.company_id = i.company_id
    WHERE i.company_id = ? AND i.status = 'cancelled' AND i.sent_at IS NOT NULL AND o.closed_at >= ? AND o.closed_at < ?
    ORDER BY o.closed_at DESC LIMIT 300`, c, f, t);
  const discounts = await db.all(`SELECT id AS order_id, number, discount::float8 AS sum, doc->'discount'->>'reason' AS reason,
    (doc->'discount'->>'by')::int AS by, doc->'discount'->>'kind' AS kind, (doc->'discount'->>'value')::float8 AS value, closed_at
    FROM orders WHERE company_id = ? AND status = 'closed' AND discount > 0 AND closed_at >= ? AND closed_at < ? ORDER BY closed_at DESC LIMIT 300`, c, f, t);
  const users = Object.fromEntries((await db.all('SELECT id, name FROM users WHERE company_id = ?', c)).map((u) => [u.id, u.name]));
  const cost = { cost: (await salesCost(db, c, f, t)).cost };
  // Ro'yxatlar 200–300 ta bilan cheklangan — jami alohida, cheklovsiz hisoblanadi.
  const cx = await db.first(`SELECT COALESCE(SUM(i.sum), 0)::float8 AS v FROM order_items i JOIN orders o ON o.id = i.order_id AND o.company_id = i.company_id
    WHERE i.company_id = ? AND i.status = 'cancelled' AND i.sent_at IS NOT NULL AND o.closed_at >= ? AND o.closed_at < ?`, c, f, t);
  const vx = await db.first("SELECT COUNT(*)::int AS n FROM orders WHERE company_id = ? AND status = 'void' AND closed_at >= ? AND closed_at < ?", c, f, t);

  return json({
    ok: true, from, to,
    totals: { ...tot, avg_check: tot.orders ? Math.round(n(tot.total) / tot.orders) : 0, cost: Math.round(n(cost.cost)),
      cancelled_sum: Math.round(n(cx.v)), voids: vx.n },
    methods, types, days, hours, items, waiters, cancels, discounts, voids, users,
  });
}

export async function shifts(req, env, db, auth) {
  const rows = await db.all(`SELECT id, number, opened_at, closed_at, opened_by, closed_by, opening_cash::float8 AS opening_cash,
    counted_cash::float8 AS counted_cash, expected_cash::float8 AS expected_cash, status, summary FROM shifts
    WHERE company_id = ? ORDER BY opened_at DESC LIMIT 100`, auth.c);
  return json({ ok: true, shifts: rows });
}

/** Buyurtma tarixi: har amal kim tomonidan, qachon (ops jadvali). */
export async function orderLog(req, env, db, auth) {
  const id = new URL(req.url).searchParams.get('id');
  const order = await db.first('SELECT doc FROM orders WHERE company_id = ? AND id = ?', auth.c, id || '');
  if (!order) return fail(404, 'not_found');
  const ops = await db.all('SELECT id, type, user_id, at, data, error FROM ops WHERE company_id = ? AND order_id = ? ORDER BY applied_at', auth.c, id);
  return json({ ok: true, order: order.doc, ops });
}

/**
 * Foyda: har taom bo'yicha — nechta sotildi, tushum, tannarx, foyda. Pastda: chegirma, rasxod, sof foyda.
 * Taom foydasi chegirmagacha (chegirma butun buyurtmaga beriladi); umumiy foydada chegirma ayiriladi.
 */
export async function profit(req, env, db, auth) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from'); const to = url.searchParams.get('to') || from;
  if (!isDay(from) || !isDay(to) || to < from) return fail(400, 'bad_range', 'Sana noto\'g\'ri');
  const [f, t] = dayRange(from, to); const c = auth.c;
  const sc = await salesCost(db, c, f, t);
  const tot = await db.first(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total), 0)::float8 AS total, COALESCE(SUM(discount), 0)::float8 AS discount,
    COALESCE(SUM(service), 0)::float8 AS service FROM orders WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ?`, c, f, t);
  const exp = await db.first('SELECT COALESCE(SUM(amount), 0)::float8 AS v FROM expenses WHERE company_id = ? AND deleted_at IS NULL AND at >= ? AND at < ?', c, f, t);
  const waste = await db.first("SELECT COALESCE(-SUM(qty * cost), 0)::float8 AS v FROM stock_moves m WHERE company_id = ? AND kind = 'utilizatsiya' AND at >= ? AND at < ? AND NOT EXISTS (SELECT 1 FROM stock_docs d WHERE d.company_id = m.company_id AND d.id = m.doc_id AND d.cancelled_at IS NOT NULL)", c, f, t);
  const revenue = Math.round(n(tot.total));
  const gross = revenue - sc.cost;
  const expenses = Math.round(n(exp.v)); const wasteV = Math.round(n(waste.v));
  return json({
    ok: true, from, to,
    totals: { orders: tot.orders, items_revenue: sc.revenue, discount: Math.round(n(tot.discount)), service: Math.round(n(tot.service)), revenue,
      cost: sc.cost, gross, expenses, waste: wasteV, net: gross - expenses - wasteV, no_cost: sc.items.filter((x) => x.no_cost).length },
    items: sc.items.sort((a, b) => b.profit - a.profit),
  });
}
