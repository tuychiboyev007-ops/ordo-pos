/**
 * AI yordamchi — rahbar restorani haqida savol beradi, javob kassadagi jonli ma'lumotdan olinadi.
 *
 * Ikki rejim:
 *   ai  — Claude (Anthropic API) vositalar bilan: model kerakli hisobotni o'zi chaqiradi va javobni o'zbekcha yozadi.
 *         Kalit serverda — `ANTHROPIC_API_KEY` (Vercel muhiti; kodga ham, bazaga ham yozilmaydi).
 *   tez — kalit yo'q yoki AI javob bermadi: savoldagi so'zlarga qarab tayyor hisobotdan qisqa javob (modelsiz).
 *
 * Vositalar FAQAT O'QIYDI: mavjud hisobot yo'llarini shu rahbar sessiyasi bilan chaqiradi (raqamlar panel bilan aynan
 * bir xil, restoran chegarasi o'sha yo'llarda). AI hech narsani o'zgartira olmaydi.
 */
import { json, fail, body, isDay } from '../lib/http.js';
import * as R from './reports.js';
import * as W from './stock.js';
import * as P from './money.js';
import * as M from './admin.js';

export const AI_MODEL = 'claude-opus-5-5';
const MAX_STEPS = 6; // bitta savolga model necha marta vosita so'rashi mumkin
const BUDGET_MS = 45000; // Vercel funksiyasi 60 soniyada uziladi — undan oldin javob qaytsin
const DAILY = 100; // restoran boshiga kunlik savol chegarasi (ORDO_AI_DAILY bilan o'zgaradi)
const PAY = { naqd: 'Naqd', karta: 'Karta', click: 'Click', payme: 'Payme', uzum: 'Uzum', qarz: 'Nasiya' };
const TYPE = { zal: 'Zal', olib: 'Olib ketish', yetkazish: 'Yetkazish', bot: 'Bot' };
const DOW = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];

// ---------- sana (Toshkent, UTC+5) ----------
const localDay = (ms = Date.now()) => new Date(ms + 5 * 3600e3).toISOString().slice(0, 10);
const shiftDay = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dowOf = (day) => new Date(day + 'T00:00:00Z').getUTCDay();

/** Vosita parametrlari: sana noto'g'ri yoki bo'sh bo'lsa — bugun; oraliq bir yildan oshmaydi. */
function range(input, def = 'today') {
  const today = localDay();
  let from = isDay(input?.from) ? input.from : null; let to = isDay(input?.to) ? input.to : null;
  if (!from && !to) { to = today; from = def === 'month' ? today.slice(0, 8) + '01' : today; }
  from = from || to; to = to || from;
  if (to < from) [from, to] = [to, from];
  if (Date.parse(to) - Date.parse(from) > 366 * 864e5) from = shiftDay(to, -366);
  return { from, to };
}

/** Mavjud GET yo'lini shu sessiya bilan chaqirish. */
async function route(fn, qs, c) {
  const res = await fn(new Request('http://ordo.local/ai?' + new URLSearchParams(qs || {})), c.env, c.db, c.auth);
  const d = await res.json();
  if (!res.ok || d.ok === false) throw new Error(d.message || d.error || 'ma\'lumot olinmadi');
  return d;
}
const top = (arr, n) => (arr || []).slice(0, n);
const has = (s, q) => !q || String(s || '').toLowerCase().includes(String(q).toLowerCase().trim());

// ---------- vositalar ----------
const DAYS = { from: { type: 'string', description: 'Start day, YYYY-MM-DD (Tashkent date). Omit for today.' }, to: { type: 'string', description: 'End day inclusive, YYYY-MM-DD. Omit to use the same day as `from`.' } };
export const TOOLS = [
  { name: 'sales_report', description: 'Sales and profit for a period, with the previous period of the same length for comparison: revenue, number of checks, average check, guests, food cost, gross and net profit, expenses, breakdown by payment method / order type / category / waiter / weekday / hour, best and worst selling menu items, items that stopped selling, and the month-end forecast. Use this for any question about sales, revenue, profit, popular dishes or staff performance.',
    input_schema: { type: 'object', properties: DAYS } },
  { name: 'today', description: 'Live snapshot of one day (default today): sales so far, open (unpaid) orders, payment methods, top dishes, low stock, customer and supplier debts, cancellations. Cheaper than sales_report when the question is only about today right now.',
    input_schema: { type: 'object', properties: { day: { type: 'string', description: 'YYYY-MM-DD, default today' } } } },
  { name: 'stock', description: 'Warehouse: stock elements (ingredients, semi-finished «zagotovka», marinated «marinovka», ready goods) with quantity on hand, minimum level, average cost per unit and value. Filter to find what is running out, negative balances or elements without a price.',
    input_schema: { type: 'object', properties: { filter: { type: 'string', enum: ['low', 'negative', 'no_price', 'all'], description: 'low = at or below minimum (default), negative = balance below zero, no_price = cost unknown, all = everything' }, query: { type: 'string', description: 'Optional part of the element name' } } } },
  { name: 'stock_movement', description: 'Material report for a period: for each stock element how much came in, how much was used by sales, written off as waste, corrected by inventory, and the closing balance — in units and in money.',
    input_schema: { type: 'object', properties: { ...DAYS, query: { type: 'string', description: 'Optional part of the element name' } } } },
  { name: 'menu', description: 'Menu items: selling price, cost per portion (from the recipe card), food-cost percent, profit per portion, category, whether the item is on stop. Use to answer price, margin and recipe-cost questions.',
    input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Optional part of the dish or category name' } } } },
  { name: 'expenses', description: 'Expenses (rent, salaries, utilities, market…) for a period: total, by category, and the latest entries.',
    input_schema: { type: 'object', properties: DAYS } },
  { name: 'debts', description: 'Money owed: customers who owe the restaurant (nasiya) and suppliers the restaurant owes.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'shifts', description: 'Cash shifts in a period: when opened and closed, by whom, sales, expected cash in the drawer, counted cash and the difference (shortage or surplus).',
    input_schema: { type: 'object', properties: DAYS } },
  { name: 'cancellations', description: 'Loss control for a period: cancelled dishes, voided checks and discounts — how many, how much, the reasons and who approved.',
    input_schema: { type: 'object', properties: DAYS } },
  { name: 'diagnostics', description: 'Health check of the restaurant data: a 0–100 score and a list of problems (negative stock, dishes without a recipe card or cost, high food cost, unpaid debts, cash differences, etc.) with where to fix each one.',
    input_schema: { type: 'object', properties: {} } },
];

const names = async (c) => Object.fromEntries((await c.db.all('SELECT id, name FROM users WHERE company_id = ?', c.auth.c)).map((u) => [u.id, u.name]));

const RUN = {
  async sales_report(i, c) {
    const { from, to } = range(i);
    const d = await route(R.analytics, { from, to }, c);
    const item = (x) => ({ name: x.name, category: x.category, qty: x.qty, revenue: x.revenue, profit: x.profit, margin_pct: x.margin, abc: x.cls, prev_revenue: x.prev_revenue });
    const sold = d.items.filter((x) => x.qty > 0);
    return { period: { from: d.from, to: d.to, days: d.days_n }, previous_period: d.prev, currency: 'so\'m',
      totals: d.cur, previous_totals: d.old,
      by_payment: d.methods.map((m) => ({ method: PAY[m.method] || m.method, checks: m.n, sum: m.sum, share_pct: m.share })),
      by_type: d.types.map((t) => ({ type: TYPE[t.type] || t.type, checks: t.n, sum: t.sum, avg_check: t.avg, share_pct: t.share, prev_sum: t.prev })),
      categories: d.categories.map((x) => ({ name: x.name, qty: x.qty, revenue: x.revenue, profit: x.profit, share_pct: x.share, margin_pct: x.margin })),
      top_items: top(sold, 12).map(item), weakest_items: sold.length > 12 ? sold.slice(-6).reverse().map(item) : [],
      items_sold_count: sold.length, menu_size: d.menu_n,
      stopped_selling: top(d.gone, 10).map((x) => ({ name: x.name, prev_revenue: x.prev_revenue })), never_sold_in_period: { count: d.dead_n, names: top(d.dead, 15).map((x) => x.name) },
      waiters: d.waiters.map((w) => ({ name: w.name, role: w.role, checks: w.orders, sum: w.sum, avg_check: w.avg, share_pct: w.share, prev_sum: w.prev, cancelled_items: w.cancel_n, cancelled_sum: w.cancel_sum })),
      weekdays: d.weekdays.map((w) => ({ day: DOW[w.dow], avg_per_day: w.avg, checks: w.n })),
      busiest_hours: [...d.hours].sort((a, b) => b.sum - a.sum).slice(0, 5).map((h) => ({ hour: `${String(h.h).padStart(2, '0')}:00`, checks: h.n, sum: h.sum })),
      by_day: d.days.length <= 31 ? d.days.map((x) => ({ day: x.day, checks: x.n, sum: x.sum })) : undefined,
      per_guest: d.extra.per_guest, items_per_check: d.extra.items_per_check, avg_table_minutes: d.extra.sit_min, month_forecast: d.forecast };
  },
  async today(i, c) {
    const day = isDay(i?.day) ? i.day : localDay();
    const d = await route(P.dashboard, { day }, c);
    return { day: d.day, currency: 'so\'m', sales: d.sales, open_orders: d.open, by_payment: d.methods.map((m) => ({ method: PAY[m.method] || m.method, sum: m.sum })),
      top_items: d.top, food_cost: d.food_cost, expenses: d.expenses, waste: d.waste, profit: d.profit,
      low_stock: d.low.map((x) => ({ name: x.name, stock: x.stock, min: x.min_stock, unit: x.unit })), customer_debts: { total: d.debts.v, customers: d.debts.n }, supplier_debt: d.supplier_debt, cancellations: { count: d.cancels.n, sum: d.cancels.v } };
  },
  async stock(i, c) {
    const f = ['low', 'negative', 'no_price', 'all'].includes(i?.filter) ? i.filter : (i?.query ? 'all' : 'low');
    const all = (await route(W.ingredients, {}, c)).ingredients;
    const rows = all.filter((x) => has(x.name, i?.query) && (f === 'all' || (f === 'low' && x.low) || (f === 'negative' && x.stock < 0) || (f === 'no_price' && !(x.cost > 0))));
    return { filter: f, total_elements: all.length, matched: rows.length, stock_value: all.reduce((s, x) => s + Math.max(0, x.value), 0),
      negative_count: all.filter((x) => x.stock < 0).length, low_count: all.filter((x) => x.low).length, no_price_count: all.filter((x) => !(x.cost > 0)).length,
      elements: top(rows.sort((a, b) => a.stock - a.min_stock - (b.stock - b.min_stock)), 80).map((x) => ({ name: x.name, group: x.grp || '', unit: x.unit, stock: x.stock, min: x.min_stock, cost_per_unit: Math.round(x.cost), value: x.value,
        kind: x.prep ? (x.prep_kind === 'marinovka' ? 'marinovka' : 'zagotovka') : 'element', used_in_dishes: x.dishes })),
      truncated: rows.length > 80 ? rows.length - 80 : 0 };
  },
  async stock_movement(i, c) {
    const { from, to } = range(i, 'month');
    const d = await route(W.material, { from, to }, c);
    const rows = d.rows.filter((x) => has(x.name, i?.query) && (x.in_q || x.used_q || x.waste_q || x.inv_q || i?.query)).sort((a, b) => b.used_v - a.used_v);
    return { period: { from: d.from, to: d.to }, totals_money: d.totals,
      elements: top(rows, 50).map((x) => ({ name: x.name, unit: x.unit, opening: x.open_q, came_in: x.in_q, came_in_sum: x.in_v, used_by_sales: x.used_q, used_sum: x.used_v, waste: x.waste_q, waste_sum: x.waste_v, inventory_correction: x.inv_q, closing: x.close_q })),
      truncated: rows.length > 50 ? rows.length - 50 : 0 };
  },
  async menu(i, c) {
    const d = await route(M.menu, {}, c); const costs = (await route(W.recipeCosts, {}, c)).costs;
    const cat = Object.fromEntries(d.categories.map((x) => [x.id, x.name]));
    const rows = d.products.filter((p) => has(p.name, i?.query) || has(cat[p.category_id], i?.query));
    return { menu_size: d.products.length, matched: rows.length, without_cost: d.products.filter((p) => !costs[p.id]?.cost).length,
      items: top(rows, 80).map((p) => { const cs = costs[p.id]?.cost || 0; return { name: p.name, category: cat[p.category_id] || '', price: p.price, cost: cs || null, food_cost_pct: cs && p.price ? Math.round((cs / p.price) * 1000) / 10 : null,
        profit_per_portion: cs ? p.price - cs : null, recipe_lines: costs[p.id]?.lines || 0, on_stop: !!p.stop, ready_goods_stock: p.goods_id ? p.goods_stock : undefined }; }),
      truncated: rows.length > 80 ? rows.length - 80 : 0 };
  },
  async expenses(i, c) {
    const { from, to } = range(i, 'month');
    const d = await route(P.expenses, { from, to }, c);
    return { period: { from, to }, total: d.total, count: d.count, by_category: d.by_category,
      latest: top(d.expenses, 20).map((x) => ({ at: x.at, category: x.category, amount: x.amount, note: x.note || '', paid_from: x.pay_from, by: x.user_name })) };
  },
  async debts(i, c) {
    const cu = await route(P.debts, {}, c); const su = await route(P.suppliers, {}, c);
    const owe = cu.customers.filter((x) => x.debt > 0); const we = su.suppliers.filter((x) => x.debt > 0);
    return { customers_owe_us: { total: cu.total, count: owe.length, list: top(owe, 30).map((x) => ({ name: x.name, phone: x.phone || '', debt: x.debt, last_debt_at: x.last_debt, last_payment_at: x.last_pay })) },
      we_owe_suppliers: { total: su.total, count: we.length, list: top(we, 30).map((x) => ({ name: x.name, phone: x.phone || '', debt: x.debt, last_delivery_at: x.last_in })) } };
  },
  async shifts(i, c) {
    const { from, to } = range(i);
    const d = await route(R.shifts, { from, to }, c); const U = await names(c);
    return { period: { from, to }, shifts: top(d.shifts, 40).map((s) => ({ number: s.number, status: s.status === 'open' ? 'ochiq' : 'yopilgan', opened_at: s.opened_at, closed_at: s.closed_at, opened_by: U[s.opened_by] || '', closed_by: U[s.closed_by] || '',
      opening_cash: s.opening_cash, sales: s.summary?.total ?? null, checks: s.summary?.orders ?? null, expected_cash: s.expected_cash, counted_cash: s.counted_cash,
      difference: s.counted_cash != null && s.expected_cash != null ? s.counted_cash - s.expected_cash : null })) };
  },
  async cancellations(i, c) {
    const { from, to } = range(i);
    const d = await route(R.summary, { from, to }, c); const U = d.users || {};
    const sumOf = (a) => a.reduce((s, x) => s + (x.sum ?? x.total ?? 0), 0);
    return { period: { from, to }, sales_total: d.totals.total,
      cancelled_items: { count: d.cancels.length, sum: sumOf(d.cancels), list: top(d.cancels, 20).map((x) => ({ dish: x.name, qty: x.qty, sum: x.sum, reason: x.reason || '', approved_by: U[x.cancelled_by] || '', check: x.number })) },
      voided_checks: { count: d.voids.length, sum: sumOf(d.voids), list: top(d.voids, 15).map((x) => ({ check: x.number, total: x.total, reason: x.reason || '', by: U[x.by] || '' })) },
      discounts: { count: d.discounts.length, sum: sumOf(d.discounts), total_from_summary: d.totals.discount, list: top(d.discounts, 15).map((x) => ({ check: x.number, sum: x.sum, reason: x.reason || '', by: U[x.by] || '' })) } };
  },
  async diagnostics(i, c) {
    const d = await route(R.diagnostics, {}, c);
    return { score: d.score, counts: d.counts, problems: d.checks.filter((x) => x.level === 'bad' || x.level === 'warn').map((x) => ({ level: x.level === 'bad' ? 'jiddiy' : 'ogohlantirish', area: x.group, title: x.title, detail: x.detail, fix_in_panel_page: x.page })),
      fine: d.checks.filter((x) => x.level === 'ok').map((x) => x.title) };
  },
};

export async function runTool(name, input, c) {
  if (!Object.hasOwn(RUN, name)) throw new Error('Bunday vosita yo\'q: ' + name);
  return RUN[name](input && typeof input === 'object' ? input : {}, c);
}

// ---------- AI (Claude) ----------
const SYSTEM = `You are «ordo yordamchi», the assistant built into the back office of ordo — a point-of-sale system for restaurants and cafés in Uzbekistan. You talk with the owner or manager of one restaurant and answer questions about that restaurant's sales, profit, warehouse, menu, expenses, debts and cash shifts.

How you work
- The tools read live data from this restaurant's POS database. Every number you state must come from a tool result in this conversation. If the tools do not have what was asked, say so plainly instead of estimating.
- The tools are read-only. You cannot change prices, stock, orders or settings. When the user wants something changed, tell them where in the panel to do it.
- Dates are Tashkent time. Resolve "bugun", "kecha", "shu hafta" (Monday to today), "o'tgan hafta", "shu oy", "o'tgan oy" from the current date given below, and pass explicit YYYY-MM-DD days to the tools.
- Money is in Uzbek so'm. Write amounts with a space as the thousands separator and no decimals (1 250 000 so'm).

How you answer
- Reply in Uzbek, Latin script, in a warm and businesslike tone — unless the user writes in Russian or English, then answer in that language.
- Lead with the answer itself (the number or the name), then add only what helps a busy owner decide: a comparison with the previous period, the main cause, or one concrete next step. A few short lines is usually enough.
- Formatting is limited: plain text, **bold** for key figures, and simple "- " lists. No tables, no headings, no code blocks.
- When the data shows a problem the user did not ask about but should know (negative stock, dishes without a cost, an unusually high food-cost percent, a cash shortage), mention it in one line.
- If a question has nothing to do with running the restaurant, say briefly that you help with this restaurant's POS data.

Panel map (use these names when pointing somewhere)
- Hisobotlar: Umumiy hisobot, Foyda, Savdo analitikasi, Diagnostika, Buyurtmalar (cheklar), Savdo, Smenalar, Moddiy hisobot
- Ombor: Elementlar (qoldiq va narx; «Hammasini to'g'rilash»), Zagotovkalar, Marinovka, Kirim, Utilizatsiya, Inventarizatsiya, Bugungi harakat
- Menyu: Menyu (taom, narx, texnologik karta), Qo'shimchalar, Toifalar va sexlar
- Pul: Rasxod, Nasiya, Yetkazib beruvchilar
- Sozlamalar: Restoran, bot, parol; Xodimlar; Zal va stollar`;

const textOf = (res) => (res.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();

/**
 * Vosita sikli. `client` — Anthropic SDK mijozi (sinovda soxta). Javob: { text, tools, tin, tout }.
 * Server tomoni rad etishdagi zaxira (`fallbacks: "default"`) yoqilgan: model xavfsizlik sababli rad etsa, API o'zi boshqa modelda qayta uradi.
 */
export async function runAgent(client, { model, system, messages, ctx, deadline }) {
  const msgs = [...messages]; const used = []; let tin = 0; let tout = 0;
  for (let step = 0; step < MAX_STEPS; step++) {
    const left = deadline - Date.now();
    if (left < 4000) break;
    const res = await client.beta.messages.create({
      model, max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
      output_config: { effort: 'low' },
      system, tools: TOOLS, messages: msgs,
    }, { timeout: left });
    const u = res.usage || {};
    tin += (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0); tout += u.output_tokens || 0;
    if (res.stop_reason === 'refusal') return { text: 'Bu savolga javob bera olmayman. Restoraningiz savdosi, ombori yoki puli haqida so\'rang.', tools: used, tin, tout };
    if (res.stop_reason === 'pause_turn') { msgs.push({ role: 'assistant', content: res.content }); continue; }
    if (res.stop_reason !== 'tool_use') {
      const text = textOf(res);
      return { text: (text || 'Javob bo\'sh keldi — savolni boshqacha yozib ko\'ring.') + (res.stop_reason === 'max_tokens' ? '\n\n(Javob juda uzun bo\'lgani uchun shu yerda kesildi.)' : ''), tools: used, tin, tout };
    }
    // Javobdagi hamma bloklar (o'ylash bloklari ham) o'zgarishsiz qaytariladi — aks holda keyingi so'rov rad etiladi.
    msgs.push({ role: 'assistant', content: res.content });
    const results = [];
    for (const blk of res.content.filter((b) => b.type === 'tool_use')) {
      try { results.push({ type: 'tool_result', tool_use_id: blk.id, content: JSON.stringify(await runTool(blk.name, blk.input, ctx)) }); used.push(blk.name); }
      catch (e) { results.push({ type: 'tool_result', tool_use_id: blk.id, content: 'Xato: ' + (e?.message || 'ma\'lumot olinmadi'), is_error: true }); }
    }
    msgs.push({ role: 'user', content: results });
  }
  return { text: 'Javob tayyorlashga ulgurmadim — savolni qisqaroq yoki aniqroq yozib ko\'ring.', tools: used, tin, tout, timeout: true };
}

async function makeClient(key) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  return { client: new Anthropic({ apiKey: key, maxRetries: 1 }), Anthropic };
}

/** SDK xatosi → foydalanuvchiga tushunarli sabab (aniq sinflar bo'yicha, matnga qarab emas). */
function aiError(e, Anthropic) {
  if (Anthropic) {
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'AI kaliti noto\'g\'ri yoki o\'chirilgan — server sozlamasidagi ANTHROPIC_API_KEY ni tekshiring';
    if (e instanceof Anthropic.RateLimitError) return 'AI hozir band (so\'rovlar chegarasi) — birozdan keyin urinib ko\'ring';
    if (e instanceof Anthropic.APIConnectionError) return 'AI xizmatiga ulanib bo\'lmadi';
    if (e instanceof Anthropic.BadRequestError) return 'AI so\'rovni qabul qilmadi' + (/credit|billing|balance/i.test(e.message || '') ? ' — Anthropic hisobida mablag\' tugagan bo\'lishi mumkin' : '');
    if (e instanceof Anthropic.APIError) return `AI xizmati xato berdi (${e.status || '—'})`;
  }
  return 'AI javob bermadi';
}

// ---------- tezkor javob (modelsiz) ----------
const som = (v) => `${Math.round(Number(v) || 0).toLocaleString('ru-RU').replace(/ |,/g, ' ')} so'm`;
const num = (v) => String(Math.round((Number(v) || 0) * 1000) / 1000).replace('.', ',');
const dm = (day) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;
const span = (p) => (p.from === p.to ? dm(p.from) : `${dm(p.from)} – ${dm(p.to)}`);
const diff = (a, b) => (b > 0 ? ` (oldingi davrga nisbatan ${a >= b ? '+' : '−'}${Math.abs(Math.round(((a - b) / b) * 100))}%)` : '');

/** Savoldagi davr: bugun (standart), kecha, shu/o'tgan hafta, shu/o'tgan oy, «N kun». */
export function periodOf(text, def = 'today') {
  const t = String(text || '').toLowerCase().replace(/[‘’ʻʼ`]/g, '\''); const today = localDay();
  const past = /o'tgan|otgan|oldingi/.test(t);
  const nd = t.match(/(\d{1,3})\s*kun/);
  if (nd) return { from: shiftDay(today, -(Math.min(366, Math.max(1, Number(nd[1]))) - 1)), to: today, label: `so'nggi ${nd[1]} kun` };
  if (/kecha/.test(t)) { const y = shiftDay(today, -1); return { from: y, to: y, label: 'kecha' }; }
  if (/hafta/.test(t)) {
    const mon = shiftDay(today, -((dowOf(today) + 6) % 7));
    return past ? { from: shiftDay(mon, -7), to: shiftDay(mon, -1), label: 'o\'tgan hafta' } : { from: mon, to: today, label: 'shu hafta' };
  }
  if (/\boy\b|oyda|oylik|oyning/.test(t)) {
    const first = today.slice(0, 8) + '01';
    if (!past) return { from: first, to: today, label: 'shu oy' };
    const last = shiftDay(first, -1); return { from: last.slice(0, 8) + '01', to: last, label: 'o\'tgan oy' };
  }
  if (/bugun|hozir/.test(t) || def === 'today') return { from: today, to: today, label: 'bugun' };
  return { from: today.slice(0, 8) + '01', to: today, label: 'shu oy' };
}

/** Kalitsiz rejim: savoldagi so'zlarga qarab bitta hisobotdan qisqa javob. */
export async function quick(question, c) {
  const t = String(question || '').toLowerCase().replace(/[‘’ʻʼ`]/g, '\'');
  const L = []; const tools = [];
  const use = async (name, input) => { tools.push(name); return runTool(name, input, c); };
  if (/diagnost|muammo|tekshir|nimani tuzat/.test(t)) {
    const d = await use('diagnostics', {});
    L.push(`**Diagnostika: ${d.score} ball** — jiddiy ${d.counts.bad}, ogohlantirish ${d.counts.warn}.`);
    for (const p of d.problems.slice(0, 8)) L.push(`- ${p.level === 'jiddiy' ? '**' + p.title + '**' : p.title}${p.detail ? ' — ' + p.detail : ''}`);
    if (!d.problems.length) L.push('Muammo topilmadi.');
  } else if (/qarz|nasiya/.test(t)) {
    const d = await use('debts', {});
    L.push(`**Mijozlar bizga qarz: ${som(d.customers_owe_us.total)}** (${d.customers_owe_us.count} ta mijoz).`);
    for (const x of d.customers_owe_us.list.slice(0, 6)) L.push(`- ${x.name} — ${som(x.debt)}`);
    L.push(`**Biz yetkazib beruvchilarga qarzmiz: ${som(d.we_owe_suppliers.total)}** (${d.we_owe_suppliers.count} ta).`);
    for (const x of d.we_owe_suppliers.list.slice(0, 6)) L.push(`- ${x.name} — ${som(x.debt)}`);
  } else if (/tugay|tugab|tugad|kam qol|qoldi[qg]|ombor|zaxira|manfiy/.test(t)) {
    const neg = /manfiy/.test(t); const d = await use('stock', { filter: neg ? 'negative' : 'low' });
    L.push(`**${neg ? 'Manfiy qoldiq' : 'Kam qolgan'}: ${d.matched} ta element** (jami ${d.total_elements} ta, ombor qiymati ${som(d.stock_value)}).`);
    for (const x of d.elements.slice(0, 12)) L.push(`- ${x.name} — ${num(x.stock)} ${x.unit}${x.min ? ` (eng kami ${num(x.min)})` : ''}`);
    if (!d.matched) L.push(neg ? 'Manfiy qoldiq yo\'q.' : 'Hammasi yetarli — eng kam qoldiqdan past element yo\'q.');
    if (!neg && d.negative_count) L.push(`Diqqat: ${d.negative_count} ta elementning qoldig'i manfiy — Ombor → Elementlar → «Hammasini to'g'rilash».`);
  } else if (/rasxod|xarajat|chiqim/.test(t)) {
    const p = periodOf(t, 'month'); const d = await use('expenses', p);
    L.push(`**Rasxod (${p.label}, ${span(p)}): ${som(d.total)}** — ${d.count} ta yozuv.`);
    for (const x of d.by_category.slice(0, 8)) L.push(`- ${x.category} — ${som(x.sum)}`);
  } else if (/smena|kamomad|ortiqcha|kassada/.test(t)) {
    const p = periodOf(t); const d = await use('shifts', p);
    L.push(`**Smenalar (${p.label}): ${d.shifts.length} ta.**`);
    for (const s of d.shifts.slice(0, 8)) L.push(`- №${s.number} ${s.status}${s.sales != null ? ` — savdo ${som(s.sales)}` : ''}${s.difference ? ` — farq ${s.difference > 0 ? '+' : '−'}${som(Math.abs(s.difference))}` : ''}`);
  } else if (/bekor|chegirma/.test(t)) {
    const p = periodOf(t); const d = await use('cancellations', p);
    L.push(`**${p.label[0].toUpperCase() + p.label.slice(1)} (${span(p)}):** bekor qilingan taomlar ${d.cancelled_items.count} ta — ${som(d.cancelled_items.sum)}; bekor cheklar ${d.voided_checks.count} ta — ${som(d.voided_checks.sum)}; chegirmalar ${d.discounts.count} ta — ${som(d.discounts.sum)}.`);
    for (const x of d.cancelled_items.list.slice(0, 6)) L.push(`- ${x.dish} × ${num(x.qty)} — ${x.reason || 'sababsiz'}${x.approved_by ? ` (${x.approved_by})` : ''}`);
  } else {
    const p = periodOf(t); const d = await use('sales_report', p); const c0 = d.totals; const o = d.previous_totals;
    const head = `${p.label[0].toUpperCase() + p.label.slice(1)} (${span(p)})`;
    if (/ofitsiant|xodim|kassir|kim ko'p/.test(t)) {
      L.push(`**${head} — xodimlar bo'yicha savdo:**`);
      for (const w of d.waiters.slice(0, 8)) L.push(`- ${w.name} — ${som(w.sum)} (${w.checks} ta chek, o'rtacha ${som(w.avg_check)})`);
      if (!d.waiters.length) L.push('Bu davrda savdo yo\'q.');
    } else if (/sotilma|kam sotil|o'lik|yomon sotil/.test(t)) {
      L.push(`**${head}: ${d.never_sold_in_period.count} ta taom umuman sotilmagan** (menyuda ${d.menu_size} ta).`);
      if (d.never_sold_in_period.names.length) L.push(d.never_sold_in_period.names.join(', '));
      for (const x of d.weakest_items) L.push(`- kam sotilgan: ${x.name} — ${num(x.qty)} ta, ${som(x.revenue)}`);
    } else if (/eng ko'p|top|xit|ko'p sotil|yaxshi sotil|foydali|mashhur/.test(t)) {
      const byProfit = /foyda/.test(t); const list = byProfit ? [...d.top_items].sort((a, b) => b.profit - a.profit) : d.top_items;
      L.push(`**${head} — ${byProfit ? 'eng foydali' : 'eng ko\'p sotilgan'} taomlar:**`);
      list.slice(0, 8).forEach((x, n) => L.push(`- ${n + 1}. ${x.name} — ${num(x.qty)} ta, ${som(x.revenue)}${x.profit ? `, foyda ${som(x.profit)}` : ''}`));
      if (!list.length) L.push('Bu davrda savdo yo\'q.');
    } else {
      L.push(`**${head}: savdo ${som(c0.revenue)}**${diff(c0.revenue, o.revenue)} — ${c0.orders} ta chek, o'rtacha chek ${som(c0.avg_check)}.`);
      L.push(`Tannarx ${som(c0.cost)}, yalpi foyda **${som(c0.gross)}**, rasxod ${som(c0.expenses)}, sof foyda **${som(c0.net)}**.`);
      if (d.by_payment.length) L.push('To\'lov: ' + d.by_payment.map((m) => `${m.method} ${som(m.sum)}`).join(', ') + '.');
      if (d.top_items.length) L.push('Eng ko\'p sotilgan: ' + d.top_items.slice(0, 3).map((x) => `${x.name} (${num(x.qty)})`).join(', ') + '.');
      if (c0.no_cost) L.push(`Diqqat: ${c0.no_cost} ta taomning tannarxi noma'lum — foyda to'liq emas (Menyu → taom → Texnologik karta).`);
    }
  }
  return { text: L.join('\n'), tools };
}

// ---------- yo'llar ----------
const limitOf = (env) => { const n = Number(env.ORDO_AI_DAILY); return Number.isFinite(n) && n > 0 ? Math.round(n) : DAILY; };
const ready = (env) => !!(env.ANTHROPIC_API_KEY || env.AI_CLIENT);

export async function status(req, env, db, auth) {
  const used = await db.first('SELECT n FROM ai_usage WHERE company_id = ? AND day = ?', auth.c, localDay());
  return json({ ok: true, ready: ready(env), model: ready(env) ? env.ORDO_AI_MODEL || AI_MODEL : null, limit: limitOf(env), used: used?.n || 0, owner: auth.r === 'owner' });
}

/** Suhbat tarixi brauzerda turadi; server har safar oxirgi xabarlarni oladi va tozalaydi. */
function cleanMessages(list) {
  const out = [];
  for (const m of Array.isArray(list) ? list.slice(-12) : []) {
    const role = m?.role === 'assistant' ? 'assistant' : m?.role === 'user' ? 'user' : null;
    const content = typeof m?.content === 'string' ? m.content.trim().slice(0, 4000) : '';
    if (role && content) out.push({ role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift(); // birinchi xabar foydalanuvchiniki bo'lishi shart
  return out;
}

export async function chat(req, env, db, auth) {
  const b = await body(req);
  const messages = cleanMessages(b.messages);
  if (!messages.length || messages[messages.length - 1].role !== 'user') return fail(400, 'empty', 'Savolingizni yozing');
  const question = messages[messages.length - 1].content;
  const ctx = { env, db, auth };
  if (!ready(env)) { const q = await quick(question, ctx); return json({ ok: true, mode: 'tez', reply: q.text, tools: q.tools }); }

  const day = localDay(); const lim = limitOf(env);
  const used = (await db.first('SELECT n FROM ai_usage WHERE company_id = ? AND day = ?', auth.c, day))?.n || 0;
  if (used >= lim) return fail(429, 'ai_limit', `Bugungi AI savollar chegarasi tugadi (${lim} ta). Ertaga yana ishlaydi.`);

  const co = await db.first('SELECT name FROM companies WHERE id = ? /* tenant:global */', auth.c);
  const me = await db.first('SELECT name, role FROM users WHERE company_id = ? AND id = ?', auth.c, auth.u);
  // Barqaror qism keshlanadi; sana va restoran nomi undan KEYIN — kesh har kuni buzilmasin.
  const system = [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `Current date (Tashkent): ${day}, ${DOW[dowOf(day)]}. Restaurant: ${co?.name || ''}. You are talking with ${me?.name || 'the manager'} (${me?.role === 'owner' ? 'owner' : 'manager'}).` }];

  let Anthropic = null; let client = env.AI_CLIENT || null; let out;
  try {
    if (!client) ({ client, Anthropic } = await makeClient(env.ANTHROPIC_API_KEY));
    out = await runAgent(client, { model: env.ORDO_AI_MODEL || AI_MODEL, system, messages, ctx, deadline: Date.now() + BUDGET_MS });
  } catch (e) {
    console.error('ai', e?.status || '', e?.message || e);
    // AI ishlamasa foydalanuvchi javobsiz qolmaydi: tayyor hisobotdan tezkor javob va sababi.
    const q = await quick(question, ctx);
    return json({ ok: true, mode: 'tez', reply: q.text, tools: q.tools, note: aiError(e, Anthropic) });
  }
  await db.run(`INSERT INTO ai_usage (company_id, day, n, tokens_in, tokens_out) VALUES (?, ?, 1, ?, ?)
    ON CONFLICT (company_id, day) DO UPDATE SET n = ai_usage.n + 1, tokens_in = ai_usage.tokens_in + EXCLUDED.tokens_in, tokens_out = ai_usage.tokens_out + EXCLUDED.tokens_out`, auth.c, day, out.tin, out.tout);
  return json({ ok: true, mode: 'ai', reply: out.text, tools: out.tools, left: Math.max(0, lim - used - 1) });
}
