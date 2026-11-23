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

  return json({ ok: true, from, to, days_n: len, prev: { from: pFrom, to: pTo }, cur: cur.totals, old: old.totals,
    days, prev_days, weekdays, hours, heat, categories, abc, items, gone, dead: dead.slice(0, 200), dead_n: dead.length, menu_n: prods.filter((p) => p.active).length });
}
