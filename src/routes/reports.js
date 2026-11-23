/**
 * Hisobotlar — faqat yopilgan buyurtmalardan (order_items, payments yopilganda yoziladi).
 * Kun — Toshkent kuni. Har ko'rsatkich alohida so'rovda: bitta JOIN'da yig'ilsa
 * to'lovlar taomlar soniga ko'payib ketardi.
 */
import { json, fail, isDay, dayRange } from '../lib/http.js';
import { salesCost, unitCosts, ingCosts } from '../lib/cost.js';

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
/** "Xodimlar oldi" — rasxodning shu turlari (ish haqi, avans). Tur nomi erkin yozilishi mumkin, shuning uchun so'z bo'yicha. */
const STAFF_CAT = /ish\s*haqi|avans|oylik|maosh/i;

/**
 * Davrning pul yakuni: savdo, tannarx, rasxod (shundan xodimlarga), utilizatsiya, sof foyda.
 * "Foyda" hisoboti ham, Moddiy hisobotdagi pul xulosasi ham SHUNDAN — ikki ekranda raqamlar bir xil bo'lishi shart.
 */
export async function periodMoney(db, c, f, t) {
  const sc = await salesCost(db, c, f, t);
  const tot = await db.first(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total), 0)::float8 AS total, COALESCE(SUM(discount), 0)::float8 AS discount,
    COALESCE(SUM(service), 0)::float8 AS service FROM orders WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ?`, c, f, t);
  const exp = await db.all('SELECT category, COALESCE(SUM(amount), 0)::float8 AS v FROM expenses WHERE company_id = ? AND deleted_at IS NULL AND at >= ? AND at < ? GROUP BY category', c, f, t);
  const waste = await db.first("SELECT COALESCE(-SUM(qty * cost), 0)::float8 AS v FROM stock_moves m WHERE company_id = ? AND kind = 'utilizatsiya' AND at >= ? AND at < ? AND NOT EXISTS (SELECT 1 FROM stock_docs d WHERE d.company_id = m.company_id AND d.id = m.doc_id AND d.cancelled_at IS NOT NULL)", c, f, t);
  const revenue = Math.round(n(tot.total));
  const gross = revenue - sc.cost;
  const expenses = Math.round(exp.reduce((s, x) => s + n(x.v), 0));
  const staff = Math.round(exp.filter((x) => STAFF_CAT.test(x.category || '')).reduce((s, x) => s + n(x.v), 0));
  const wasteV = Math.round(n(waste.v));
  return { sc, totals: { orders: tot.orders, items_revenue: sc.revenue, discount: Math.round(n(tot.discount)), service: Math.round(n(tot.service)), revenue,
    cost: sc.cost, gross, expenses, staff, waste: wasteV, net: gross - expenses - wasteV, no_cost: sc.items.filter((x) => x.no_cost).length } };
}

export async function profit(req, env, db, auth) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from'); const to = url.searchParams.get('to') || from;
  if (!isDay(from) || !isDay(to) || to < from) return fail(400, 'bad_range', 'Sana noto\'g\'ri');
  const [f, t] = dayRange(from, to);
  const { sc, totals } = await periodMoney(db, auth.c, f, t);
  return json({ ok: true, from, to, totals, items: sc.items.sort((a, b) => b.profit - a.profit) });
}

/**
 * Analitika: tanlangan davr OLDINGI shu uzunlikdagi davr bilan solishtiriladi, hafta kuni va soat kesimi,
 * toifalar ulushi va foydasi, taomlarning ABC tahlili, sotilmayotgan taomlar.
 * Pul raqamlari `periodMoney` dan — "Foyda" hisoboti bilan aynan bir xil chiqadi.
 */
export async function analytics(req, env, db, auth) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from'); const to = url.searchParams.get('to') || from;
  if (!isDay(from) || !isDay(to) || to < from) return fail(400, 'bad_range', 'Sana noto\'g\'ri');
  const c = auth.c;
  const DAY = 86400e3;
  const shift = (day, k) => new Date(Date.parse(day + 'T00:00:00Z') + k * DAY).toISOString().slice(0, 10);
  const len = Math.round((Date.parse(to) - Date.parse(from)) / DAY) + 1;
  if (len > 400) return fail(400, 'bad_range', 'Davr 400 kundan oshmasin');
  const pTo = shift(from, -1); const pFrom = shift(pTo, -(len - 1));
  const [f, t] = dayRange(from, to); const [pf, pt] = dayRange(pFrom, pTo);

  const one = async (a, b) => {
    const { sc, totals } = await periodMoney(db, c, a, b);
    const x = await db.first(`SELECT COALESCE(SUM(guests), 0)::int AS guests FROM orders WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ?`, c, a, b);
    const items_qty = Math.round(sc.items.reduce((s, i) => s + i.qty, 0) * 10) / 10;
    return { sc, totals: { ...totals, guests: x.guests, items_qty, avg_check: totals.orders ? Math.round(totals.revenue / totals.orders) : 0,
      margin: totals.revenue ? Math.round((totals.gross / totals.revenue) * 1000) / 10 : 0 } };
  };
  const cur = await one(f, t);
  const old = await one(pf, pt);

  const daysQ = (a, b) => db.all(`SELECT to_char(${LOCAL('closed_at')}, 'YYYY-MM-DD') AS day, COUNT(*)::int AS n, SUM(total)::float8 AS sum FROM orders
    WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ? GROUP BY 1 ORDER BY 1`, c, a, b);
  const fill = (rows, start) => {
    const m = new Map(rows.map((r) => [r.day, r]));
    return Array.from({ length: len }, (_, k) => { const day = shift(start, k); const r = m.get(day); return { day, n: r?.n || 0, sum: Math.round(n(r?.sum)) }; });
  };
  const days = fill(await daysQ(f, t), from);
  const prev_days = fill(await daysQ(pf, pt), pFrom);

  // Hafta kuni × soat (Toshkent vaqti). 1 — dushanba … 7 — yakshanba.
  const heat = (await db.all(`SELECT EXTRACT(ISODOW FROM ${LOCAL('closed_at')})::int AS dow, EXTRACT(HOUR FROM ${LOCAL('closed_at')})::int AS h,
      COUNT(*)::int AS n, SUM(total)::float8 AS sum FROM orders
    WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ? GROUP BY 1, 2 ORDER BY 1, 2`, c, f, t))
    .map((r) => ({ dow: r.dow, h: r.h, n: r.n, sum: Math.round(n(r.sum)) }));
  // O'rtacha — davrda shu hafta kuni NECHA MARTA kelganiga bo'linadi (savdo bo'lmagan kun ham sanaladi).
  const dowCount = [0, 0, 0, 0, 0, 0, 0, 0];
  for (let k = 0; k < len; k++) { const d = new Date(Date.parse(from + 'T00:00:00Z') + k * DAY).getUTCDay(); dowCount[d === 0 ? 7 : d]++; }
  const weekdays = [1, 2, 3, 4, 5, 6, 7].map((dow) => {
    const rows = heat.filter((r) => r.dow === dow);
    const sumV = rows.reduce((s, r) => s + r.sum, 0); const cnt = rows.reduce((s, r) => s + r.n, 0);
    return { dow, days: dowCount[dow], n: cnt, sum: sumV, avg: dowCount[dow] ? Math.round(sumV / dowCount[dow]) : 0 };
  });
  const hoursMap = new Map();
  for (const r of heat) { const x = hoursMap.get(r.h) || { h: r.h, n: 0, sum: 0 }; x.n += r.n; x.sum += r.sum; hoursMap.set(r.h, x); }
  const hours = [...hoursMap.values()].sort((a, b) => a.h - b.h);

  // Taomlar: ABC (sinf — taom qo'shilishidan OLDINGI yig'ma ulushdan: yagona taom "C" bo'lib qolmasin) va oldingi davr bilan farq.
  const prods = await db.all(`SELECT p.id, p.name, p.price::float8 AS price, p.category_id, p.active, p.stop, ct.name AS category FROM products p
    LEFT JOIN categories ct ON ct.id = p.category_id AND ct.company_id = p.company_id WHERE p.company_id = ?`, c);
  const pmap = new Map(prods.map((p) => [p.id, p]));
  const oldBy = new Map(old.sc.items.map((i) => [i.product_id ?? 'n:' + i.name, i]));
  const sorted = [...cur.sc.items].sort((a, b) => b.revenue - a.revenue);
  const totalRev = sorted.reduce((s, i) => s + i.revenue, 0);
  let acc = 0;
  const abc = { A: { n: 0, revenue: 0 }, B: { n: 0, revenue: 0 }, C: { n: 0, revenue: 0 } };
  const items = sorted.map((i) => {
    const before = totalRev ? acc / totalRev : 0;
    const cls = before < 0.8 ? 'A' : before < 0.95 ? 'B' : 'C';
    acc += i.revenue; abc[cls].n++; abc[cls].revenue += i.revenue;
    const o = oldBy.get(i.product_id ?? 'n:' + i.name);
    return { product_id: i.product_id, name: i.name, unit: i.unit, category: pmap.get(i.product_id)?.category || null, qty: i.qty, revenue: i.revenue,
      cost: i.cost, profit: i.profit, no_cost: i.no_cost, margin: i.revenue ? Math.round((i.profit / i.revenue) * 1000) / 10 : 0,
      share: totalRev ? Math.round((i.revenue / totalRev) * 1000) / 10 : 0, cls, prev_revenue: o?.revenue || 0, prev_qty: o?.qty || 0 };
  });
  // Oldin sotilgan-u, bu davrda umuman sotilmagan taomlar ham "pasaydi" ro'yxatida ko'rinsin.
  const soldNow = new Set(cur.sc.items.map((i) => i.product_id ?? 'n:' + i.name));
  const gone = old.sc.items.filter((i) => !soldNow.has(i.product_id ?? 'n:' + i.name))
    .map((i) => ({ product_id: i.product_id, name: i.name, prev_revenue: i.revenue, prev_qty: i.qty })).sort((a, b) => b.prev_revenue - a.prev_revenue).slice(0, 50);

  const cats = new Map();
  for (const i of items) {
    const p = pmap.get(i.product_id); const key = p?.category_id || 0;
    const x = cats.get(key) || { id: key, name: p?.category || 'Toifasiz', qty: 0, revenue: 0, cost: 0, profit: 0, n: 0 };
    x.qty += i.qty; x.revenue += i.revenue; x.cost += i.cost; x.profit += i.profit; x.n++; cats.set(key, x);
  }
  const categories = [...cats.values()].map((x) => ({ ...x, qty: Math.round(x.qty * 10) / 10, share: totalRev ? Math.round((x.revenue / totalRev) * 1000) / 10 : 0,
    margin: x.revenue ? Math.round((x.profit / x.revenue) * 1000) / 10 : 0 })).sort((a, b) => b.revenue - a.revenue);

  // Menyuda turgan, lekin shu davrda bir marta ham sotilmagan taomlar; oxirgi sotilgan kuni so'nggi 180 kundan qidiriladi.
  const since = new Date(Date.parse(t) - 180 * DAY).toISOString();
  const last = new Map((await db.all(`SELECT i.product_id, MAX(i.closed_at) AS at FROM order_items i
    WHERE i.company_id = ? AND i.status <> 'cancelled' AND i.closed_at >= ? AND i.closed_at < ? AND i.product_id IS NOT NULL GROUP BY i.product_id`, c, since, t))
    .map((r) => [r.product_id, new Date(r.at).toISOString()]));
  const soldIds = new Set(cur.sc.items.map((i) => i.product_id).filter(Boolean));
  const dead = prods.filter((p) => p.active && !soldIds.has(p.id))
    .map((p) => ({ id: p.id, name: p.name, price: Math.round(n(p.price)), category: p.category || null, stop: !!p.stop, last_sold: last.get(p.id) || null }))
    .sort((a, b) => String(b.last_sold || '').localeCompare(String(a.last_sold || '')) || a.name.localeCompare(b.name));

  // ---- Savdo kesimlari: xodim, buyurtma turi, to'lov turi, zal va stollar ----
  const staff = Object.fromEntries((await db.all('SELECT id, name, role FROM users WHERE company_id = ?', c)).map((u) => [u.id, u]));
  const waitersQ = (a, b) => db.all(`SELECT waiter_id AS id, COUNT(*)::int AS orders, COALESCE(SUM(total), 0)::float8 AS sum, COALESCE(SUM(guests), 0)::int AS guests,
    COALESCE(SUM(discount), 0)::float8 AS discount FROM orders WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ? GROUP BY waiter_id`, c, a, b);
  const wPrev = new Map((await waitersQ(pf, pt)).map((r) => [r.id, Math.round(n(r.sum))]));
  // Oshxonaga ketgandan keyin bekor qilingan taomlar — kim KIRITGANI bo'yicha.
  const wCancel = new Map((await db.all(`SELECT i.added_by AS id, COUNT(*)::int AS n, COALESCE(SUM(i.sum), 0)::float8 AS sum FROM order_items i
    JOIN orders o ON o.id = i.order_id AND o.company_id = i.company_id
    WHERE i.company_id = ? AND i.status = 'cancelled' AND i.sent_at IS NOT NULL AND o.closed_at >= ? AND o.closed_at < ? GROUP BY i.added_by`, c, f, t)).map((r) => [r.id, r]));
  const rev = cur.totals.revenue;
  const waiters = (await waitersQ(f, t)).map((r) => ({ id: r.id, name: staff[r.id]?.name || '—', role: staff[r.id]?.role || null, orders: r.orders, sum: Math.round(n(r.sum)), guests: r.guests,
    discount: Math.round(n(r.discount)), avg: r.orders ? Math.round(n(r.sum) / r.orders) : 0, share: rev ? Math.round((n(r.sum) / rev) * 1000) / 10 : 0,
    prev: wPrev.get(r.id) || 0, cancel_n: wCancel.get(r.id)?.n || 0, cancel_sum: Math.round(n(wCancel.get(r.id)?.sum)) })).sort((a, b) => b.sum - a.sum);
  const typesQ = (a, b) => db.all(`SELECT type, COUNT(*)::int AS n, COALESCE(SUM(total), 0)::float8 AS sum FROM orders
    WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ? GROUP BY type`, c, a, b);
  const tPrev = new Map((await typesQ(pf, pt)).map((r) => [r.type, Math.round(n(r.sum))]));
  const types = (await typesQ(f, t)).map((r) => ({ type: r.type, n: r.n, sum: Math.round(n(r.sum)), avg: r.n ? Math.round(n(r.sum) / r.n) : 0,
    share: rev ? Math.round((n(r.sum) / rev) * 1000) / 10 : 0, prev: tPrev.get(r.type) || 0 })).sort((a, b) => b.sum - a.sum);
  const paid = await db.all(`SELECT p.method, COUNT(*)::int AS n, COALESCE(SUM(p.amount), 0)::float8 AS sum FROM payments p
    JOIN orders o ON o.id = p.order_id AND o.company_id = p.company_id
    WHERE p.company_id = ? AND o.status = 'closed' AND o.closed_at >= ? AND o.closed_at < ? GROUP BY p.method`, c, f, t);
  const paidSum = paid.reduce((a, r) => a + n(r.sum), 0);
  const methods = paid.map((r) => ({ method: r.method, n: r.n, sum: Math.round(n(r.sum)), share: paidSum ? Math.round((n(r.sum) / paidSum) * 1000) / 10 : 0 })).sort((a, b) => b.sum - a.sum);
  // Zal: o'tirish vaqti — buyurtma ochilgandan yopilguncha (12 soatdan uzun — unutilgan buyurtma, o'rtachani buzmasin).
  const SIT = `AVG(EXTRACT(EPOCH FROM (o.closed_at - o.opened_at)) / 60) FILTER (WHERE o.opened_at IS NOT NULL AND o.closed_at - o.opened_at < interval '12 hours')`;
  const halls = (await db.all(`SELECT h.id, h.name, COUNT(*)::int AS n, COALESCE(SUM(o.total), 0)::float8 AS sum, COALESCE(SUM(o.guests), 0)::int AS guests, ${SIT}::float8 AS minutes
    FROM orders o JOIN tables tb ON tb.id = o.table_id AND tb.company_id = o.company_id JOIN halls h ON h.id = tb.hall_id AND h.company_id = o.company_id
    WHERE o.company_id = ? AND o.status = 'closed' AND o.type = 'zal' AND o.closed_at >= ? AND o.closed_at < ? GROUP BY h.id, h.name ORDER BY sum DESC`, c, f, t))
    .map((r) => ({ id: r.id, name: r.name, n: r.n, sum: Math.round(n(r.sum)), guests: r.guests, avg: r.n ? Math.round(n(r.sum) / r.n) : 0, minutes: Math.round(n(r.minutes)) }));
  const tables = (await db.all(`SELECT tb.id, tb.name, h.name AS hall, COUNT(*)::int AS n, COALESCE(SUM(o.total), 0)::float8 AS sum
    FROM orders o JOIN tables tb ON tb.id = o.table_id AND tb.company_id = o.company_id JOIN halls h ON h.id = tb.hall_id AND h.company_id = o.company_id
    WHERE o.company_id = ? AND o.status = 'closed' AND o.type = 'zal' AND o.closed_at >= ? AND o.closed_at < ? GROUP BY tb.id, tb.name, h.name ORDER BY sum DESC LIMIT 12`, c, f, t))
    .map((r) => ({ id: r.id, name: r.name, hall: r.hall, n: r.n, sum: Math.round(n(r.sum)) }));
  const sitQ = async (a, b) => Math.round(n((await db.first(`SELECT ${SIT}::float8 AS m FROM orders o WHERE o.company_id = ? AND o.status = 'closed' AND o.type = 'zal' AND o.closed_at >= ? AND o.closed_at < ?`, c, a, b)).m));
  const extra = { sit_min: await sitQ(f, t), sit_prev: await sitQ(pf, pt),
    per_guest: cur.totals.guests ? Math.round(rev / cur.totals.guests) : 0, per_guest_prev: old.totals.guests ? Math.round(old.totals.revenue / old.totals.guests) : 0,
    items_per_check: cur.totals.orders ? Math.round((cur.totals.items_qty / cur.totals.orders) * 10) / 10 : 0,
    items_per_check_prev: old.totals.orders ? Math.round((old.totals.items_qty / old.totals.orders) * 10) / 10 : 0 };

  return json({ ok: true, from, to, days_n: len, prev: { from: pFrom, to: pTo }, cur: cur.totals, old: old.totals,
    days, prev_days, weekdays, hours, heat, categories, abc, items, gone, dead: dead.slice(0, 200), dead_n: dead.length, menu_n: prods.filter((p) => p.active).length,
    waiters, types, methods, halls, tables, extra, forecast: await monthForecast(db, c) });
}

/**
 * Oy yakuni bashorati: shu oyning hozirgacha savdosi + qolgan kunlar uchun so'nggi 28 kundagi
 * SHU HAFTA KUNINING o'rtacha savdosi (juma va shanba boshqa kunlardan farq qiladi). Tanlangan davrga bog'liq emas.
 */
export async function monthForecast(db, c) {
  const DAY = 86400e3;
  const today = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  const shift = (day, k) => new Date(Date.parse(day + 'T00:00:00Z') + k * DAY).toISOString().slice(0, 10);
  const first = today.slice(0, 8) + '01';
  const y = Number(today.slice(0, 4)); const m = Number(today.slice(5, 7));
  const lastDay = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const sumQ = async (a, b) => { const [f, t] = dayRange(a, b); return Math.round(n((await db.first("SELECT COALESCE(SUM(total), 0)::float8 AS v FROM orders WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ?", c, f, t)).v)); };
  const soFar = await sumQ(first, today);
  const prevEnd = shift(first, -1); const prevMonth = await sumQ(prevEnd.slice(0, 8) + '01', prevEnd);
  // So'nggi 28 kun (bugunni hisobga olmay — bugun hali tugamagan): hafta kuni bo'yicha o'rtacha.
  const [bf, bt] = dayRange(shift(today, -28), shift(today, -1));
  const byDow = new Map((await db.all(`SELECT EXTRACT(ISODOW FROM ${LOCAL('closed_at')})::int AS dow, COALESCE(SUM(total), 0)::float8 AS v FROM orders
    WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ? GROUP BY 1`, c, bf, bt)).map((r) => [r.dow, n(r.v) / 4]));
  const todaySum = await sumQ(today, today);
  let rest = 0; let daysLeft = 0;
  for (let d = shift(today, 1); d <= lastDay; d = shift(d, 1)) { const w = new Date(d + 'T00:00:00Z').getUTCDay(); rest += byDow.get(w === 0 ? 7 : w) || 0; daysLeft++; }
  // Bugun: kun oxirigacha odatdagi shu hafta kuni savdosiga yetadi deb olinadi (bugungi savdo undan oshgan bo'lsa — o'zi).
  const w0 = new Date(today + 'T00:00:00Z').getUTCDay(); const usual = byDow.get(w0 === 0 ? 7 : w0) || 0;
  const todayRest = Math.max(0, usual - todaySum);
  const basis = [...byDow.values()].reduce((a, v) => a + v, 0);
  return { month: today.slice(0, 7), so_far: soFar, projected: basis ? Math.round(soFar + todayRest + rest) : null, days_left: daysLeft, prev_month: prevMonth, has_basis: basis > 0 };
}

/**
 * Diagnostika: restoran holatini tekshiradi va nima noto'g'ri ekanini aytadi — savdo (7 kun), pul nazorati,
 * ombor va menyu (30 kun va hozirgi holat). Har tekshiruv: daraja (bad | warn | ok | info), sarlavha, izoh, qaysi bo'limda tuzatiladi.
 */
export async function diagnostics(req, env, db, auth) {
  const c = auth.c; const DAY = 86400e3;
  const day = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
  const shift = (d, k) => new Date(Date.parse(d + 'T00:00:00Z') + k * DAY).toISOString().slice(0, 10);
  const [f7, t] = dayRange(shift(day, -6), day); const [pf7, pt7] = dayRange(shift(day, -13), shift(day, -7)); const [f30] = dayRange(shift(day, -29), day);
  const fmt = (v) => String(Math.round(n(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const pc = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const pctText = (v) => String(v).replace('.', ',') + '%';
  const names = (rows, k = 4) => rows.slice(0, k).map((r) => r.name).join(', ') + (rows.length > k ? ` va yana ${rows.length - k} ta` : '');
  const checks = [];
  const add = (group, key, level, title, detail, page = null) => checks.push({ group, key, level, title, detail, page });

  const revQ = (a, b) => db.first(`SELECT COUNT(*)::int AS orders, COALESCE(SUM(total), 0)::float8 AS total, COALESCE(SUM(discount), 0)::float8 AS discount
    FROM orders WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ?`, c, a, b);
  const w1 = await revQ(f7, t); const w0 = await revQ(pf7, pt7); const m30 = await revQ(f30, t);
  const pm = await periodMoney(db, c, f30, t);

  // ---------- Savdo ----------
  if (!m30.orders) add('Savdo', 'no_sales', 'info', 'So\'nggi 30 kunda savdo yo\'q', 'Kassada buyurtmalar yopilgach bu yerda savdo tahlili paydo bo\'ladi.', 'orders');
  else {
    if (n(w0.total) > 0) {
      const p = Math.round(((n(w1.total) - n(w0.total)) / n(w0.total)) * 1000) / 10;
      add('Savdo', 'trend', p <= -20 ? 'bad' : p <= -5 ? 'warn' : 'ok', `Savdo oldingi haftaga nisbatan ${p > 0 ? '+' : ''}${pctText(p)}`,
        `So'nggi 7 kun: ${fmt(w1.total)} so'm (${w1.orders} ta buyurtma). Undan oldingi 7 kun: ${fmt(w0.total)} so'm (${w0.orders} ta).`, 'analytics');
      if (w1.orders && w0.orders) {
        const a1 = n(w1.total) / w1.orders; const a0 = n(w0.total) / w0.orders; const ap = Math.round(((a1 - a0) / a0) * 1000) / 10;
        add('Savdo', 'avg_check', ap <= -10 ? 'warn' : 'ok', `O'rtacha chek ${fmt(a1)} so'm (${ap > 0 ? '+' : ''}${pctText(ap)})`,
          ap <= -10 ? `Oldingi haftada ${fmt(a0)} so'm edi — mijoz kamroq olyapti. Qo'shimcha taklif (ichimlik, garnir) va kombo o'ylab ko'ring.` : `Oldingi haftada ${fmt(a0)} so'm edi.`, 'analytics');
      }
    } else add('Savdo', 'trend', 'info', 'Solishtirish uchun ma\'lumot kam', `So'nggi 7 kun: ${fmt(w1.total)} so'm. Undan oldingi haftada savdo bo'lmagan.`, 'analytics');
    const sold = new Set(pm.sc.items.map((i) => i.product_id).filter(Boolean));
    const menu = await db.all('SELECT id, name FROM products WHERE company_id = ? AND active = true', c);
    const dead = menu.filter((p) => !sold.has(p.id));
    if (dead.length) add('Savdo', 'dead', dead.length > menu.length * 0.3 ? 'warn' : 'info', `${dead.length} ta taom 30 kunda bir marta ham sotilmadi`,
      `Menyudagi ${menu.length} ta taomdan: ${names(dead)}. Narxini, nomini yoki rasmini qayta ko'ring, kerak bo'lmasa menyudan olib tashlang.`, 'analytics');
    else add('Savdo', 'dead', 'ok', 'Menyudagi hamma taom sotilyapti', `So'nggi 30 kunda ${menu.length} ta taomning har biri kamida bir marta sotilgan.`, 'analytics');
  }

  // ---------- Pul nazorati ----------
  if (m30.orders) {
    const cx = await db.first(`SELECT COUNT(*)::int AS n, COALESCE(SUM(i.sum), 0)::float8 AS sum FROM order_items i JOIN orders o ON o.id = i.order_id AND o.company_id = i.company_id
      WHERE i.company_id = ? AND i.status = 'cancelled' AND i.sent_at IS NOT NULL AND o.closed_at >= ? AND o.closed_at < ?`, c, f30, t);
    const cp = pc(n(cx.sum), n(m30.total));
    const top = await db.first(`SELECT u.name, COUNT(*)::int AS n FROM order_items i JOIN orders o ON o.id = i.order_id AND o.company_id = i.company_id
      LEFT JOIN users u ON u.id = i.added_by AND u.company_id = i.company_id
      WHERE i.company_id = ? AND i.status = 'cancelled' AND i.sent_at IS NOT NULL AND o.closed_at >= ? AND o.closed_at < ? GROUP BY u.name ORDER BY n DESC LIMIT 1`, c, f30, t);
    add('Pul nazorati', 'cancels', cp > 3 ? 'bad' : cp > 1 ? 'warn' : 'ok', cx.n ? `Bekor qilingan taomlar: ${cx.n} ta, ${fmt(cx.sum)} so'm (${pctText(cp)})` : 'Oshxonaga ketgan taom bekor qilinmagan',
      cx.n ? `30 kunda oshxonaga yuborilgandan KEYIN bekor qilingan — bu to'g'ridan-to'g'ri yo'qotish yoki o'g'irlik belgisi bo'lishi mumkin.${top?.name ? ` Eng ko'p: ${top.name} (${top.n} ta).` : ''} Me'yor — savdoning 1% gacha.` : 'So\'nggi 30 kunda bunday holat yo\'q.', 'sales');
    const vd = await db.first("SELECT COUNT(*)::int AS n FROM orders WHERE company_id = ? AND status = 'void' AND closed_at >= ? AND closed_at < ?", c, f30, t);
    const vp = pc(vd.n, m30.orders + vd.n);
    add('Pul nazorati', 'voids', vd.n >= 3 && vp > 2 ? 'warn' : 'ok', vd.n ? `Bekor qilingan buyurtmalar: ${vd.n} ta (${pctText(vp)})` : 'Butunlay bekor qilingan buyurtma yo\'q',
      vd.n ? 'Butun buyurtma bekor qilingan holatlar. Har birining sababi va kim ruxsat bergani «Savdo» hisobotida.' : 'So\'nggi 30 kunda bunday holat yo\'q.', 'sales');
    const dp = pc(n(m30.discount), n(m30.total) + n(m30.discount));
    add('Pul nazorati', 'discounts', dp > 10 ? 'bad' : dp > 5 ? 'warn' : 'ok', n(m30.discount) ? `Chegirmalar: ${fmt(m30.discount)} so'm (${pctText(dp)})` : 'Chegirma berilmagan',
      n(m30.discount) ? `30 kunda berilgan chegirmalar savdoning ${pctText(dp)} qismi. Me'yor — 5% gacha; kim va nima sababdan bergani «Savdo» hisobotida.` : 'So\'nggi 30 kunda chegirma yo\'q.', 'sales');
  }
  const shiftsClosed = await db.all(`SELECT number, counted_cash::float8 AS counted, expected_cash::float8 AS expected FROM shifts
    WHERE company_id = ? AND status = 'closed' AND closed_at >= ? AND counted_cash IS NOT NULL AND expected_cash IS NOT NULL`, c, f30);
  if (shiftsClosed.length) {
    const diffs = shiftsClosed.map((x) => n(x.counted) - n(x.expected)).filter((d) => Math.abs(d) >= 1);
    const short = diffs.filter((d) => d < 0).reduce((a, d) => a + d, 0); const over = diffs.filter((d) => d > 0).reduce((a, d) => a + d, 0);
    add('Pul nazorati', 'cash_diff', short <= -100000 ? 'bad' : diffs.length ? 'warn' : 'ok', diffs.length ? `Kassa ${diffs.length} ta smenada farq qildi` : 'Kassa har smenada to\'g\'ri chiqqan',
      diffs.length ? `30 kunda ${shiftsClosed.length} ta smenadan ${diffs.length} tasida sanalgan pul kutilgandan farq qildi: kamomad ${fmt(-short)} so'm, ortiqcha ${fmt(over)} so'm.` : `30 kunda ${shiftsClosed.length} ta smena yopilgan — sanalgan pul hisobdagi bilan bir xil.`, 'shifts');
  }
  const openSh = await db.first("SELECT number, opened_at FROM shifts WHERE company_id = ? AND status = 'open' ORDER BY opened_at LIMIT 1", c);
  if (openSh) {
    const h = Math.round((Date.now() - new Date(openSh.opened_at).getTime()) / 3600e3);
    if (h >= 24) add('Pul nazorati', 'shift_open', 'warn', `Smena ${h} soatdan beri ochiq`, `Smena №${openSh.number ?? ''} yopilmagan. Har kuni oxirida smenani yoping — kassa puli va kunlik hisobot shunda to'g'ri chiqadi.`, 'shifts');
  }
  const cd = await db.first('SELECT COUNT(*) FILTER (WHERE debt > 0)::int AS n, COALESCE(SUM(debt) FILTER (WHERE debt > 0), 0)::float8 AS sum FROM customers WHERE company_id = ?', c);
  if (cd.n) add('Pul nazorati', 'debts', n(cd.sum) > n(m30.total) * 0.1 && n(m30.total) > 0 ? 'warn' : 'info', `Nasiya: ${cd.n} ta mijoz, ${fmt(cd.sum)} so'm`,
    n(cd.sum) > n(m30.total) * 0.1 && n(m30.total) > 0 ? 'Mijozlar qarzi oylik savdoning 10 foizidan oshgan — undirishni boshlang.' : 'Mijozlarning to\'lanmagan qarzi.', 'debts');
  const sd = await db.first('SELECT COUNT(*) FILTER (WHERE debt > 0)::int AS n, COALESCE(SUM(debt) FILTER (WHERE debt > 0), 0)::float8 AS sum FROM suppliers WHERE company_id = ? AND active = true', c);
  if (sd.n) add('Pul nazorati', 'supplier_debts', 'info', `Yetkazib beruvchilarga qarz: ${fmt(sd.sum)} so'm`, `${sd.n} ta yetkazib beruvchiga to'lanmagan qarz bor.`, 'suppliers');

  // ---------- Ombor ----------
  const ings = await db.all('SELECT id, name, unit, stock::float8 AS stock, min_stock::float8 AS min_stock FROM ingredients WHERE company_id = ? AND active = true ORDER BY name', c);
  if (!ings.length) add('Ombor', 'no_stock', 'info', 'Ombor yuritilmayapti', 'Element (kotlet, bulochka, Cola…) qo\'shilmagan. Ombor yuritilsa tannarx, foyda va qoldiq o\'zi hisoblanadi.', 'stock');
  else {
    const neg = ings.filter((i) => n(i.stock) < 0);
    add('Ombor', 'negative', neg.length ? 'bad' : 'ok', neg.length ? `${neg.length} ta elementning qoldig'i manfiy` : 'Manfiy qoldiq yo\'q',
      neg.length ? `${names(neg)} — sotilgan, lekin kirim kiritilmagan. Ombor → Elementlar → «Hammasini to'g'rilash» bilan haqiqiy qoldiq va narxni yozing.` : 'Hamma elementning qoldig\'i noldan yuqori.', 'stock');
    const low = ings.filter((i) => n(i.min_stock) > 0 && n(i.stock) >= 0 && n(i.stock) <= n(i.min_stock));
    if (low.length) add('Ombor', 'low', 'warn', `${low.length} ta element kam qolgan`, `${names(low)} — eng kam qoldiqdan past. Buyurtma bering.`, 'stock');
    const ic = await ingCosts(db, c);
    const usedIds = new Set((await db.all(`SELECT DISTINCT r.ingredient_id AS id FROM recipes r JOIN products p ON p.id = r.product_id AND p.company_id = r.company_id WHERE r.company_id = ? AND p.active = true`, c)).map((r) => r.id));
    const noCost = ings.filter((i) => usedIds.has(i.id) && !((ic.get(i.id) || 0) > 0));
    add('Ombor', 'no_cost', noCost.length ? 'bad' : 'ok', noCost.length ? `${noCost.length} ta elementning narxi yo'q` : 'Texkartadagi hamma elementning narxi bor',
      noCost.length ? `${names(noCost)} — texkartada bor, lekin hali kirim qilinmagan. Shu sababli taom tannarxi va foyda noto'g'ri chiqadi. Ombor → Elementlar → «Hammasini to'g'rilash» bilan narxini yozing.` : 'Taom tannarxi to\'liq hisoblanyapti.', 'stock');
    if (pm.totals.cost > 0) {
      const wp = pc(pm.totals.waste, pm.totals.cost);
      add('Ombor', 'waste', wp > 6 ? 'bad' : wp > 3 ? 'warn' : 'ok', pm.totals.waste ? `Utilizatsiya: ${fmt(pm.totals.waste)} so'm (${pctText(wp)})` : 'Utilizatsiya yozilmagan',
        pm.totals.waste ? `30 kunda hisobdan chiqarilgan mahsulot — sarflangan mahsulotning ${pctText(wp)} qismi. Me'yor — 3% gacha.` : 'So\'nggi 30 kunda buzilgan yoki yaroqsiz mahsulot yozilmagan. Bo\'lsa — yozib boring, aks holda ombor qoldig\'i to\'g\'ri chiqmaydi.', 'waste');
    }
    const inv = await db.first("SELECT MAX(at) AS at FROM stock_docs WHERE company_id = ? AND kind = 'inventar' AND cancelled_at IS NULL", c);
    const invDays = inv?.at ? Math.floor((Date.now() - new Date(inv.at).getTime()) / DAY) : null;
    add('Ombor', 'inventory', invDays == null || invDays > 30 ? 'warn' : 'ok', invDays == null ? 'Inventarizatsiya hali qilinmagan' : `Oxirgi inventarizatsiya ${invDays} kun oldin`,
      invDays == null || invDays > 30 ? 'Oyiga kamida bir marta omborni sanab, haqiqiy qoldiqni kiriting — kamomad va o\'g\'irlik shunda ko\'rinadi.' : 'Ombor yaqinda sanalgan.', 'inv');
  }

  // ---------- Menyu ----------
  const prods = await db.all(`SELECT id, name, price::float8 AS price, stop, (image IS NOT NULL) AS has_image FROM products WHERE company_id = ? AND active = true ORDER BY name`, c);
  if (!prods.length) add('Menyu', 'no_menu', 'bad', 'Menyu bo\'sh', 'Hali birorta taom qo\'shilmagan. Menyu → «+ Taom» yoki «+ Tayyor tovar».', 'menu');
  else {
    const units = await unitCosts(db, c);
    const noC = prods.filter((p) => !(units.get(p.id)?.cost > 0));
    add('Menyu', 'dish_cost', noC.length ? (pm.totals.no_cost ? 'bad' : 'warn') : 'ok', noC.length ? `${noC.length} ta taomning tannarxi noma'lum` : 'Hamma taomning tannarxi ma\'lum',
      noC.length ? `${names(noC)} — texkarta yozilmagan yoki elementlar kirim qilinmagan. Bu taomlar foyda hisobida "100% foyda" bo'lib ko'rinadi.` : 'Foyda har taom bo\'yicha to\'g\'ri hisoblanyapti.', 'menu');
    const withC = prods.filter((p) => units.get(p.id)?.cost > 0 && n(p.price) > 0).map((p) => ({ name: p.name, fc: pc(units.get(p.id).cost, n(p.price)) }));
    const loss = withC.filter((p) => p.fc >= 100); const high = withC.filter((p) => p.fc > 45 && p.fc < 100).sort((a, b) => b.fc - a.fc);
    if (loss.length) add('Menyu', 'loss', 'bad', `${loss.length} ta taom zararga sotilyapti`, `${names(loss)} — tannarxi sotuv narxidan yuqori. Narxini oshiring yoki texkartani tekshiring.`, 'menu');
    if (high.length) add('Menyu', 'high_cost', 'warn', `${high.length} ta taomning tannarxi juda yuqori`, `${high.slice(0, 4).map((p) => `${p.name} (${pctText(p.fc)})`).join(', ')}${high.length > 4 ? ` va yana ${high.length - 4} ta` : ''} — tannarx narxning 45 foizidan oshgan.`, 'menu');
    if (!loss.length && !high.length && withC.length) add('Menyu', 'margins', 'ok', 'Taomlar ustamasi me\'yorda', 'Tannarxi ma\'lum taomlar ichida zararga yoki juda kam foydaga sotilayotgani yo\'q.', 'menu');
    if (pm.sc.revenue > 0 && pm.totals.cost > 0) {
      const fc = pc(pm.totals.cost, pm.sc.revenue);
      add('Menyu', 'food_cost', fc > 50 ? 'bad' : fc > 40 ? 'warn' : 'ok', `Umumiy tannarx ulushi ${pctText(fc)}`, `30 kunda sotilgan taomlar tannarxi savdoning ${pctText(fc)} qismi. Restoran uchun me'yor — 25–40%.`, 'profit');
    }
    const noImg = prods.filter((p) => !p.has_image);
    if (noImg.length && noImg.length < prods.length) add('Menyu', 'images', 'info', `${noImg.length} ta taomda rasm yo'q`, `${names(noImg)} — kassada rasmsiz ko'rinadi.`, 'menu');
    const stop = prods.filter((p) => p.stop);
    if (stop.length) add('Menyu', 'stop', 'info', `${stop.length} ta taom stop-listda`, `${names(stop)} — hozir sotuvda ko'rinmaydi. Tayyor bo'lsa sotuvga qaytaring.`, 'menu');
  }

  // ---------- Sozlama ----------
  const cfg = Object.fromEntries((await db.all("SELECT key, value FROM settings WHERE company_id = ? AND key IN ('bot_url', 'bot_key')", c)).map((r) => [r.key, r.value]));
  add('Sozlama', 'bot', cfg.bot_url && cfg.bot_key ? 'ok' : 'info', cfg.bot_url && cfg.bot_key ? 'Telegram bot ulangan' : 'Telegram bot ulanmagan',
    cfg.bot_url && cfg.bot_key ? 'Botdan kelgan buyurtmalar kassaga tushadi.' : 'Bot orqali buyurtma olsangiz — Sozlamalar → Telegram bot bo\'limida ulang.', 'settings');
  const st = await db.first('SELECT COUNT(*)::int AS n FROM users WHERE company_id = ? AND active = true', c);
  if (st.n <= 1) add('Sozlama', 'staff', 'info', 'Faqat bitta xodim bor', 'Kassir va ofitsiantlarga alohida PIN bering — kim sotgani, kim bekor qilgani ko\'rinib turadi.', 'staff');

  const rank = { bad: 0, warn: 1, info: 2, ok: 3 };
  const order = ['Savdo', 'Pul nazorati', 'Ombor', 'Menyu', 'Sozlama'];
  checks.sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || rank[a.level] - rank[b.level]);
  const counts = { bad: 0, warn: 0, ok: 0, info: 0 };
  for (const x of checks) counts[x.level]++;
  const score = Math.max(0, 100 - counts.bad * 12 - counts.warn * 5);
  return json({ ok: true, day, score, counts, checks });
}
