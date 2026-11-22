/**
 * ordo API sinovlari — haqiqiy Postgres (PGlite, xotirada) ustida.
 * Pul va ombor hisobi shu yerda tekshiriladi: buyurtma → oshxona → to'lov → yopish →
 * texkarta bo'yicha ombordan ayirish → moddiy hisobot balansi → smena Z-hisoboti.
 */
import { PGlite } from '@electric-sql/pglite';
import { makeDb, pgliteClient } from '../src/lib/db.js';
import { migrate } from '../src/lib/schema.js';
import { handle } from '../src/app.js';
import { makePin, hashPassword } from '../src/lib/auth.js';

let pass = 0; let failN = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; } else { failN++; console.log('  XATO:', name, extra ?? ''); } };
const group = (n) => console.log('—', n);

const pg = new PGlite();
const db = makeDb(pgliteClient(pg));
await migrate(db);
const env = { AUTH_SECRET: 'test-secret-1234567890', SETUP_OPEN: '1' };

async function call(method, path, body, token) {
  const r = await handle(new Request('http://t' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }), env, db);
  return { status: r.status, ...(await r.json()) };
}
let n = 0; const id = (p) => `${p}test${String(++n).padStart(4, '0')}`;
const now = () => new Date().toISOString();
const today = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);

// ---------- restoran ----------
group('Restoran, qurilma, PIN');
let r = await call('POST', '/api/setup', { name: 'Sinov kafe', email: 'owner@t.uz', password: 'parol12345', pin: '1111', owner: 'Egasi' });
ok(r.ok, 'restoran ochildi', r);
const C = r.company_id;
r = await call('POST', '/api/device/login', { email: 'owner@t.uz', password: 'yomon-parol' });
ok(r.status === 401, 'noto\'g\'ri parol rad etiladi');
r = await call('POST', '/api/device/login', { email: 'owner@t.uz', password: 'parol12345', device: 'Kassa' });
ok(r.ok && r.token, 'qurilma ulandi');
const DEV = r.token;
r = await call('GET', '/api/boot', null, DEV);
const OWNER = r.staff.find((u) => u.role === 'owner').id;
r = await call('POST', '/api/pin', { user_id: OWNER, pin: '0000' }, DEV);
ok(r.status === 401, 'noto\'g\'ri PIN');
r = await call('POST', '/api/pin', { user_id: OWNER, pin: '1111' }, DEV);
ok(r.ok, 'PIN bilan boshqaruv sessiyasi');
const SES = r.token;
r = await call('GET', '/api/admin/menu', null, DEV);
ok(r.status === 401, 'qurilma belgisi boshqaruvga kirmaydi');

// xodimlar
r = await call('POST', '/api/admin/staff', { name: 'Kassir', role: 'kassir', pin: '2222' }, SES);
const KASSIR = r.id;
r = await call('POST', '/api/admin/staff', { name: 'Menejer', role: 'admin', pin: '3333' }, SES);
const MGR = r.id;

// ---------- menyu, masalliq, texkarta ----------
group('Menyu va texnologik karta');
const st = (await call('POST', '/api/admin/station', { name: 'Oshxona' }, SES)).id;
const cat = (await call('POST', '/api/admin/category', { name: 'Burgerlar', station_id: st }, SES)).id;
const burger = (await call('POST', '/api/admin/product', { name: 'Burger', price: 32000, category_id: cat }, SES)).id;
const cola = (await call('POST', '/api/admin/product', { name: 'Cola', price: 10000, category_id: cat }, SES)).id;
const mk = async (name, unit) => (await call('POST', '/api/stock/ingredient', { name, unit, min_stock: 1 }, SES)).id;
const beef = await mk('Mol go\'shti', 'kg'); const tom = await mk('Pomidor', 'kg'); const bun = await mk('Bulochka', 'dona'); const ket = await mk('Ketchup', 'kg'); const colaI = await mk('Cola 0,5', 'dona');
r = await call('POST', '/api/stock/ingredient', { name: 'mol go\'shti', unit: 'kg' }, SES);
ok(r.status === 409, 'takror nomli masalliq rad etiladi');
r = await call('POST', '/api/stock/recipe', { product_id: burger, lines: [{ ingredient_id: beef, qty: 0.17 }, { ingredient_id: tom, qty: 0.06 }, { ingredient_id: bun, qty: 1 }, { ingredient_id: ket, qty: 0.01 }] }, SES);
ok(r.ok, 'burger texkartasi saqlandi');
await call('POST', '/api/stock/recipe', { product_id: cola, lines: [{ ingredient_id: colaI, qty: 1 }] }, SES);
r = await call('POST', '/api/stock/recipe', { product_id: burger, lines: [{ ingredient_id: beef, qty: 0 }] }, SES);
ok(r.status === 400, 'nol miqdor rad etiladi');

// ---------- kirim (o'rtacha tannarx) ----------
group('Kirim va o\'rtacha tannarx');
const sup = (await call('POST', '/api/supplier', { name: 'Go\'sht bozori' }, SES)).id;
r = await call('POST', '/api/stock/doc', { kind: 'kirim', supplier_id: sup, paid: 500000, pay_from: 'bank', lines: [
  { ingredient_id: beef, qty: 10, price: 100000 }, { ingredient_id: tom, qty: 5, price: 12000 }, { ingredient_id: bun, qty: 50, price: 2000 },
  { ingredient_id: ket, qty: 2, price: 30000 }, { ingredient_id: colaI, qty: 24, price: 6000 }] }, SES);
ok(r.ok, 'kirim saqlandi', r);
const doc1 = r.id;
let ings = (await call('GET', '/api/stock/ingredients', null, SES)).ingredients;
const I = (iid) => ings.find((x) => x.id === iid);
ok(I(beef).stock === 10 && I(beef).cost === 100000, 'go\'sht 10 kg, 100 000');
r = await call('GET', '/api/suppliers', null, SES);
const kirimTotal = 10 * 100000 + 5 * 12000 + 50 * 2000 + 2 * 30000 + 24 * 6000;
ok(r.suppliers[0].debt === kirimTotal - 500000, 'yetkazib beruvchi qarzi = kirim − to\'langan', r.suppliers[0].debt);
r = await call('POST', '/api/stock/doc', { kind: 'kirim', lines: [{ ingredient_id: beef, qty: 10, price: 120000 }] }, SES);
ings = (await call('GET', '/api/stock/ingredients', null, SES)).ingredients;
ok(I(beef).stock === 20 && Math.round(I(beef).cost) === 110000, 'og\'irlikli o\'rtacha: (10×100k + 10×120k)/20 = 110 000', I(beef));

// ---------- kassa: smena va buyurtma ----------
group('Kassa: buyurtma, oshxona, to\'lov, yopish');
const SH = id('s');
const sync = async (ops) => call('POST', '/api/sync', { ops }, DEV);
const op = (type, data, order_id = null, by = KASSIR) => ({ id: id('p'), type, order_id, by, at: now(), data });
r = await sync([op('shift.open', { shift_id: SH, cash: 200000 })]);
ok(r.results[0].ok && r.shift?.id === SH, 'smena ochildi');
r = await sync([op('shift.open', { shift_id: id('s'), cash: 0 })]);
ok(r.results[0].error === 'shift_open', 'ikkinchi smena ochilmaydi');

const O1 = id('o'); const it1 = id('i'); const it2 = id('i');
const ops1 = [
  op('open', { type: 'olib', number: 1, shift_id: SH }, O1),
  op('add', { item: { id: it1, product_id: burger, name: 'Burger', price: 32000, qty: 2, unit: 'dona', station_id: st } }, O1),
  op('add', { item: { id: it2, product_id: cola, name: 'Cola', price: 10000, qty: 1, unit: 'dona' } }, O1),
  op('send', {}, O1),
];
r = await sync(ops1);
ok(r.results.every((x) => x.ok), 'buyurtma ochildi va oshxonaga yuborildi', r.results);
r = await sync(ops1);
ok(r.results.every((x) => x.dup), 'qayta yuborilgan amallar ikkilanmaydi');
ok(r.orders[0].items.length === 2, 'taomlar ikki marta qo\'shilmadi');
r = await sync([op('qty', { item_id: it1, qty: 5 }, O1)]);
ok(r.results[0].error === 'sent', 'oshxonaga ketgan taom miqdori o\'zgarmaydi');
r = await sync([op('cancel', { item_id: it2, reason: 'xato' }, O1)]);
ok(r.results[0].error === 'need_manager', 'bekor qilish — menejer ruxsatisiz yo\'q');
r = await sync([op('cancel', { item_id: it2, reason: 'xato', approved_by: MGR }, O1)]);
ok(r.results[0].ok && r.orders[0].items.find((i) => i.id === it2).status === 'cancelled', 'menejer ruxsati bilan bekor qilindi');
r = await sync([op('close', { shift_id: SH }, O1)]);
ok(r.results[0].error === 'unpaid', 'to\'lovsiz yopilmaydi');
r = await sync([op('pay', { payment: { id: id('y'), method: 'naqd', amount: 64000, received: 100000 } }, O1), op('close', { shift_id: SH }, O1)]);
ok(r.results.every((x) => x.ok) && r.orders[0].status === 'closed', 'naqd to\'lov va yopish');
ok(r.orders[0].payments[0].change === 36000, 'qaytim 36 000');

ings = (await call('GET', '/api/stock/ingredients', null, SES)).ingredients;
ok(Math.abs(I(beef).stock - (20 - 0.34)) < 1e-9, 'go\'sht: 2 burger × 170 g ayirildi', I(beef).stock);
ok(I(bun).stock === 48, 'bulochka: 2 ta ayirildi');
ok(I(colaI).stock === 24, 'bekor qilingan cola ombordan ayirilmadi');

// qarzga (nasiya)
group('Nasiya');
const O2 = id('o'); const CU = id('c');
r = await sync([op('open', { type: 'zal', table_id: 999, number: 2, shift_id: SH }, O2)]);
ok(r.results[0].error === 'bad_table', 'mavjud bo\'lmagan stolga buyurtma ochilmaydi');
const hall = (await call('POST', '/api/admin/hall', { name: 'Zal', service_pct: 0 }, SES)).id;
const T1 = (await call('POST', '/api/admin/table', { name: '1', hall_id: hall }, SES)).id;
r = await sync([op('open', { type: 'zal', table_id: T1, number: 2, shift_id: SH }, id('o'))]);
ok(r.results[0].ok, 'zal buyurtmasi ochildi');
const T2 = (await call('POST', '/api/admin/table', { name: '2', hall_id: hall }, SES)).id;
r = await sync([op('open', { type: 'zal', table_id: T1, number: 3, shift_id: SH }, id('o'))]);
ok(r.results[0].error === 'table_busy', 'bitta stolda ikkinchi ochiq buyurtma ochilmaydi');
r = await sync([op('open', { type: 'zal', table_id: T2, number: 2, shift_id: SH }, O2)]);
r = await sync([
  op('add', { item: { id: id('i'), product_id: burger, name: 'Burger', price: 32000, qty: 1, unit: 'dona' } }, O2), op('send', {}, O2),
  op('pay', { payment: { id: id('y'), method: 'qarz', amount: 32000 } }, O2),
]);
ok(r.results[2].error === 'need_customer', 'qarzga — mijozsiz yo\'q');
r = await sync([op('meta', { customer: { id: CU, name: 'Akmal', phone: '+998901112233' } }, O2), op('pay', { payment: { id: id('y'), method: 'qarz', amount: 32000 } }, O2), op('close', { shift_id: SH }, O2)]);
ok(r.results.every((x) => x.ok), 'qarzga yopildi');
r = await call('GET', '/api/debts', null, SES);
ok(r.customers.find((c) => c.id === CU)?.debt === 32000, 'mijoz qarzi 32 000');
r = await sync([op('debt.pay', { customer_id: CU, move_id: id('m'), amount: 50000, method: 'naqd', shift_id: SH })]);
ok(r.results[0].error === 'over_debt', 'qarzdan ko\'p to\'lov rad etiladi');
r = await sync([op('debt.pay', { customer_id: CU, move_id: id('m'), amount: 20000, method: 'naqd', shift_id: SH })]);
ok(r.results[0].ok, 'qarz to\'lovi kassadan');
r = await call('GET', '/api/debts', null, SES);
ok(r.customers.find((c) => c.id === CU)?.debt === 12000, 'qarz 12 000 qoldi');

// rasxod va smena
group('Rasxod va Z-hisobot');
r = await sync([op('expense', { expense_id: id('e'), category: 'Transport', amount: 15000, pay_from: 'kassa', shift_id: SH })]);
ok(r.results[0].ok, 'kassadan rasxod');
r = await sync([op('shift.cash', { shift_id: SH, move_id: id('m'), kind: 'chiqim', amount: 50000, reason: 'egasiga' })]);
r = await call('GET', '/api/shift/report?id=' + SH, null, DEV);
// 200 000 + 64 000 naqd + 20 000 qarz to'lovi − 15 000 rasxod − 50 000 olindi = 219 000
ok(r.summary.expected_cash === 219000, 'kassada bo\'lishi kerak: 219 000', r.summary);
ok(r.summary.total === 96000 && r.summary.by_method.qarz === 32000, 'savdo 96 000, shundan qarzga 32 000');
ok(r.summary.cancelled_items === 1 && r.summary.cancelled_sum === 10000, 'bekor qilingan taom hisobotda');
const O3 = id('o');
await sync([op('open', { type: 'olib', number: 3, shift_id: SH }, O3), op('add', { item: { id: id('i'), product_id: cola, name: 'Cola', price: 10000, qty: 1, unit: 'dona' } }, O3)]);
r = await sync([op('shift.close', { shift_id: SH, counted: 219000 })]);
ok(r.results[0].error === 'open_orders', 'ochiq buyurtma bo\'lsa smena yopilmaydi');
await sync([op('void', { reason: 'xato', shift_id: SH }, O3)]);
for (const o of (await call('GET', '/api/state', null, DEV)).orders) await sync([op('void', { reason: 'xato', shift_id: SH }, o.id)]);
r = await sync([op('shift.close', { shift_id: SH, counted: 210000 })]);
ok(r.results[0].ok, 'smena yopildi');
r = await call('GET', '/api/shift/report?id=' + SH, null, DEV);
ok(r.summary.diff === -9000 && r.summary.voided === 2, 'farq −9 000, bekor qilingan buyurtmalar 2', r.summary);

// utilizatsiya, inventarizatsiya, moddiy hisobot
group('Utilizatsiya, inventarizatsiya, moddiy hisobot');
r = await call('POST', '/api/stock/doc', { kind: 'utilizatsiya', lines: [{ ingredient_id: tom, qty: 0.5 }] }, SES);
ok(r.status === 400, 'utilizatsiya — sababsiz yo\'q');
r = await call('POST', '/api/stock/doc', { kind: 'utilizatsiya', reason: 'Buzildi', lines: [{ ingredient_id: tom, qty: 0.5 }, { product_id: burger, qty: 1 }] }, SES);
ok(r.ok, 'utilizatsiya (masalliq + tayyor taom)');
ings = (await call('GET', '/api/stock/ingredients', null, SES)).ingredients;
ok(Math.abs(I(tom).stock - (5 - 0.12 - 0.06 - 0.5 - 0.06)) < 1e-9, 'pomidor: sotuv + utilizatsiya ayirildi', I(tom).stock);
r = await call('POST', '/api/stock/doc', { kind: 'inventar', lines: [{ ingredient_id: bun, qty: 40 }] }, SES);
ings = (await call('GET', '/api/stock/ingredients', null, SES)).ingredients;
ok(I(bun).stock === 40, 'inventarizatsiya: bulochka 40 ga tenglandi');
r = await call('GET', `/api/reports/material?from=${today()}&to=${today()}`, null, SES);
const bal = r.rows.every((x) => Math.abs(x.open_q + x.in_q - x.used_q - x.waste_q + x.inv_q - x.close_q) < 1e-6 && x.open_v + x.in_v - x.used_v - x.waste_v + x.inv_v === x.close_v);
ok(bal, 'moddiy hisobot: har qator balanslanadi', r.rows);
const beefRow = r.rows.find((x) => x.id === beef);
ok(beefRow.in_q === 20 && Math.abs(beefRow.used_q - 0.51) < 1e-9 && beefRow.waste_q === 0.17, 'go\'sht: kirim 20, sarf 3 burger, utilizatsiya 1 burger', beefRow);
ok(r.dishes.some((d) => d.product === 'Burger' && d.ingredient === 'Mol go\'shti'), 'qaysi taomga ketgani ko\'rinadi');

// hujjatni bekor qilish
r = await call('POST', '/api/stock/doc/cancel', { id: doc1 }, SES);
ok(r.ok, 'kirim bekor qilindi');
const d1 = (await call('GET', '/api/stock/doc?id=' + doc1, null, SES)).doc;
r = await call('GET', '/api/suppliers', null, SES);
ok(d1.paid > 0 && r.suppliers[0].debt === -d1.paid, 'kirim bekor: qarz qaytdi, to\'langan qismi yetkazib beruvchining bizga qarzi', [r.suppliers[0].debt, d1.paid]);
r = await call('POST', '/api/stock/doc/cancel', { id: doc1 }, SES);
ok(r.status === 409, 'ikki marta bekor qilinmaydi');

// hisobotlar
group('Savdo hisoboti va bosh sahifa');
r = await call('GET', `/api/reports/summary?from=${today()}&to=${today()}`, null, SES);
ok(r.totals.orders === 2 && r.totals.total === 96000, 'savdo: 2 ta buyurtma, 96 000', r.totals);
ok(r.cancels.length === 1 && r.cancels[0].cancelled_by === MGR, 'bekor qilingan taom — kim ruxsat bergani bilan');
r = await call('GET', '/api/dashboard?day=' + today(), null, SES);
ok(r.sales.total === 96000 && r.food_cost > 0, 'bosh sahifa: savdo va tannarx', r.sales);

// ---------- Foyda ----------
group('Foyda: har taom tannarxi va foydasi');
{
  const suv = (await call('POST', '/api/admin/product', { name: 'Suv 0,5', price: 5000, cost: 3000, category_id: cat }, SES)).id;
  let r = await call('GET', '/api/stock/recipe-costs', null, SES);
  ok(r.costs[suv]?.cost === 3000 && r.costs[suv].src === 'qolda', 'texkartasiz taom — qo\'lda yozilgan tannarx', r.costs[suv]);
  ok(r.costs[burger]?.src === 'texkarta' && r.costs[burger].cost > 0, 'texkartali taom — masalliqlardan hisoblanadi', r.costs[burger]);
  await call('POST', '/api/admin/product', { id: suv, name: 'Suv 0,5', price: 5000, category_id: cat }, SES);
  r = await call('GET', '/api/stock/recipe-costs', null, SES);
  ok(r.costs[suv]?.cost === 3000, 'tahrirlashda tannarx yuborilmasa — o\'chib ketmaydi');

  const SH3 = id('s'); await sync([op('shift.open', { shift_id: SH3, cash: 0 })]);
  const O = id('o'); const it = id('i');
  r = await sync([op('open', { type: 'olib', number: 1, shift_id: SH3 }, O), op('add', { item: { id: it, product_id: suv, name: 'Suv 0,5', price: 5000, qty: 2, unit: 'dona', station_id: null } }, O),
    op('send', {}, O), op('pay', { payment: { id: id('y'), method: 'naqd', amount: 10000 } }, O), op('close', { shift_id: SH3 }, O)]);
  ok(r.results.every((x) => x.ok), 'suv sotildi', r.results);
  r = await call('GET', `/api/reports/profit?from=${today()}&to=${today()}`, null, SES);
  const row = r.items.find((x) => x.product_id === suv);
  ok(row && row.qty === 2 && row.revenue === 10000 && row.cost === 6000 && row.profit === 4000 && row.unit_cost === 3000, 'Foyda: 2 × (5 000 − 3 000) = 4 000', row);
  ok(r.totals.revenue >= 10000 && r.totals.gross === r.totals.revenue - r.totals.cost && r.totals.net === r.totals.gross - r.totals.expenses - r.totals.waste, 'jami: tushum − tannarx − rasxod − utilizatsiya', r.totals);
  await call('POST', '/api/admin/product', { id: suv, name: 'Suv 0,5', price: 5000, cost: 4500, category_id: cat }, SES);
  r = await call('GET', `/api/reports/profit?from=${today()}&to=${today()}`, null, SES);
  ok(r.items.find((x) => x.product_id === suv)?.cost === 6000, 'tannarx keyin o\'zgarsa — o\'tgan savdo foydasi o\'zgarmaydi (sotuv paytidagi tannarx)');
  const dash = await call('GET', '/api/dashboard?day=' + today(), null, SES);
  ok(dash.food_cost === r.totals.cost, 'bosh sahifadagi tannarx foyda hisobotidagi bilan bir xil', [dash.food_cost, r.totals.cost]);
  await sync([op('shift.close', { shift_id: SH3, counted: 10000 })]);
}

// ---------- Telegram bot ----------
group('Telegram bot: buyurtma kassaga tushadi, holat botga qaytadi');
{
  // Soxta bot: haqiqiy internetga chiqilmaydi.
  const BOT = { key: 'kalit-123', orders: [{ number: '0005', at: Date.now(), lines: [] }], statuses: {}, calls: [], down: false };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    if (!String(url).startsWith('https://bot.test/api/pos')) return realFetch(url, opts);
    if (BOT.down) throw new TypeError('fetch failed');
    const b = JSON.parse(opts.body || '{}');
    BOT.calls.push(b);
    const res = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
    if (opts.headers['x-pos-key'] !== BOT.key) return res(401, { error: 'bad_key' });
    if (b.act === 'ping') return res(200, { ok: true, name: 'Sinov bot' });
    if (b.act === 'status') { BOT.statuses[b.number] = b.status; return res(200, { ok: true, status: b.status }); }
    if (b.act === 'pull') {
      const after = Number(b.after) || 0;
      const last = Math.max(...BOT.orders.map((o) => Number(o.number)));
      const fresh = b.init ? [] : BOT.orders.filter((o) => Number(o.number) > after);
      const statuses = Object.fromEntries((b.numbers || []).map((n) => [n, BOT.statuses[n] || 'new']));
      return res(200, { ok: true, last: b.init ? last : Math.max(after, ...fresh.map((o) => Number(o.number))), orders: fresh, statuses });
    }
    return res(400, {});
  };
  const pull = async () => { await db.run("UPDATE settings SET value = '0' WHERE company_id = ? AND key = 'bot_pull_at'", C); return call('POST', '/api/bot/pull', {}, DEV); };

  r = await call('POST', '/api/bot/pull', {}, DEV);
  ok(r.off === true, 'bot ulanmagan — kassa so\'rasa ham hech narsa qilmaydi');
  r = await call('POST', '/api/admin/bot', { url: 'https://bot.test', key: 'xato' }, SES);
  ok(r.status === 400 && /kalit/i.test(r.message), 'noto\'g\'ri kalit bilan ulanmaydi', r);
  r = await call('POST', '/api/admin/bot', { url: 'http://bot.test', key: 'kalit-123' }, SES);
  ok(r.status === 400, 'https bo\'lmagan manzil rad etiladi');
  r = await call('POST', '/api/admin/bot', { url: 'https://bot.test/', key: 'kalit-123' }, SES);
  ok(r.ok && r.name === 'Sinov bot', 'bot ulandi (ping)', r);
  r = await call('GET', '/api/boot', null, DEV);
  ok(r.settings.bot_on === '1' && !('bot_key' in r.settings) && !('bot_url' in r.settings), 'kassaga faqat "bot yoqilgan" belgisi boradi — kalit emas', r.settings);
  r = await call('GET', '/api/admin/settings', null, SES);
  ok(r.settings.bot_key === '••••', 'sozlamalarda kalit yashirin');

  r = await pull();
  ok(r.ok && r.created === 0 && BOT.calls.at(-1).init === true, 'birinchi ulanish — eski buyurtmalar tushmaydi', r);
  r = await pull();
  ok(BOT.calls.at(-1).init === false && BOT.calls.at(-1).after === 5, 'keyingi so\'rovlar oxirgi raqamdan davom etadi', BOT.calls.at(-1));
  BOT.orders.push({ number: '0006', at: Date.now(), total: 83000, fee: 7000, delivery: 'delivery', pay: 'naqd', discount: 3000, promo: 'MAZZA',
    phone: '901112233', address: 'Sarbon 5', comment: 'Tezroq', user: 'Ali Valiyev', username: 'ali', user_id: 77,
    lines: [{ id: 1, name: 'Burger', option: '', unit: 'dona', qty: 2, price: 32000, sum: 64000 }, { id: 2, name: 'Cola', unit: 'dona', qty: 1, price: 10000, sum: 10000 },
      { id: 3, name: 'Shawarma', option: 'Katta', unit: 'dona', qty: 1, price: 5000, sum: 5000 }, { id: 2, name: 'Cola', unit: 'dona', qty: 1, price: 0, sum: 0, gift: true }] });
  r = await pull();
  ok(r.created === 1, 'yangi bot buyurtmasi kassaga tushdi', r);
  let st8 = await call('GET', '/api/state', null, DEV);
  let bo = st8.orders.find((o) => o.ext?.number === '0006');
  const bt = (o) => { const live = o.items.filter((i) => i.status !== 'cancelled'); const sub = live.reduce((a, i) => a + i.price * i.qty, 0); return sub - (o.discount?.value || 0); };
  ok(bo && bo.type === 'bot' && bo.ext.status === 'new' && bo.ext.delivery === 'delivery', 'turi "bot", holati "yangi"', bo?.ext);
  ok(bo && bt(bo) === 83000, 'jami botdagidek: 64 000 + 10 000 + 5 000 + sovg\'a 0 + yetkazish 7 000 − promokod 3 000 = 83 000', bo && bt(bo));
  ok(bo && bo.items.find((i) => i.name === 'Burger')?.product_id === burger && bo.items.find((i) => i.price === 0)?.comment.includes('Sovg\'a'), 'taom kassa menyusiga moslandi, sovg\'a 0 so\'m');
  ok(bo && bo.ext.unmatched === 1 && bo.items.some((i) => i.name === 'Shawarma · Katta' && i.product_id === null), 'menyuda yo\'q taom nomi bilan qo\'shildi va belgilandi');
  ok(bo && bo.customer.phone === '+998 90 111 22 33' && bo.customer.address === 'Sarbon 5' && /Tezroq/.test(bo.comment) && /naqd/.test(bo.comment), 'mijoz, telefon, manzil, izoh, to\'lov turi');
  r = await pull();
  st8 = await call('GET', '/api/state', null, DEV);
  ok(r.created === 0 && st8.orders.filter((o) => o.ext?.number === '0006').length === 1, 'qayta so\'ralganda takror tushmaydi');

  r = await sync([op('ext', { status: 'accepted' }, bo.id), op('send', {}, bo.id)]);
  ok(r.results.every((x) => x.ok), 'kassada qabul qilindi va oshxonaga yuborildi', r.results);
  r = await pull();
  ok(BOT.statuses['0006'] === 'accepted' && r.sent === 1, 'botga "qabul qilindi" yuborildi (mijozga xabar)', r);
  r = await sync([op('ext', { status: 'new' }, bo.id)]);
  st8 = await call('GET', '/api/state', null, DEV);
  ok(st8.orders.find((o) => o.id === bo.id).ext.status === 'accepted', 'holat orqaga qaytmaydi');
  BOT.statuses['0006'] = 'onway';
  r = await pull();
  st8 = await call('GET', '/api/state', null, DEV);
  ok(r.changed === 1 && st8.orders.find((o) => o.id === bo.id).ext.status === 'onway', 'egasi Telegram\'da "yo\'lda" bossa — kassada ham yangilanadi', r);

  BOT.down = true;
  r = await pull();
  ok(r.error && /ulanib/.test(r.error), 'bot ishlamasa — xato yoziladi, kassa to\'xtamaydi', r);
  r = await call('GET', '/api/admin/bot', null, SES);
  ok(r.error && r.url === 'https://bot.test', 'boshqaruvda xato ko\'rinadi', r);
  BOT.down = false;

  const SH2 = id('s');
  await sync([op('shift.open', { shift_id: SH2, cash: 0 })]);
  r = await sync([op('pay', { payment: { id: id('y'), method: 'naqd', amount: 83000 } }, bo.id), op('close', { shift_id: SH2 }, bo.id)]);
  ok(r.results.every((x) => x.ok), 'to\'lov va yopish', r.results);
  r = await pull();
  ok(BOT.statuses['0006'] === 'done' && !r.error, 'yopilgach botga "yetkazildi" boradi', r);
  r = await call('GET', '/api/admin/bot', null, SES);
  ok(r.pending === 0 && !r.error && r.orders_24h === 1, 'navbat bo\'sh, xato tozalandi', r);

  BOT.orders.push({ number: '0007', at: Date.now(), total: 10000, delivery: 'pickup', pay: 'karta', phone: '935556677', address: '', user: 'Vali', lines: [{ name: 'Cola', qty: 1, price: 10000 }] });
  await pull();
  st8 = await call('GET', '/api/state', null, DEV);
  const b7 = st8.orders.find((o) => o.ext?.number === '0007');
  r = await sync([op('void', { reason: 'Tovar tugagan', shift_id: SH2 }, b7.id)]);
  r = await pull();
  ok(b7.ext.delivery === 'pickup' && /kartaga/.test(b7.comment) && BOT.statuses['0007'] === 'cancelled', 'olib ketish, karta; rad etilsa botga "bekor qilindi"', b7?.ext);
  await sync([op('shift.close', { shift_id: SH2, counted: 83000 })]);
  globalThis.fetch = realFetch;
}

// ikkinchi restoran ko'rmaydi
group('Tekshiruvda topilgan xatolar qaytmasin');
{
  const S4 = id('s'); await sync([op('shift.open', { shift_id: S4, cash: 100000 })]);
  // 1) To'lovdan keyin chegirma — ortiqcha to'lov bilan yopilmaydi
  const A = id('o'); const ai = id('i'); const ap = id('y');
  let r = await sync([op('open', { type: 'olib', number: 51, shift_id: S4 }, A), op('add', { item: { id: ai, product_id: cola, name: 'Cola', price: 10000, qty: 2, unit: 'dona' } }, A),
    op('send', {}, A), op('pay', { payment: { id: ap, method: 'naqd', amount: 20000 } }, A), op('discount', { kind: 'pct', value: 10, reason: 'doimiy mijoz', approved_by: MGR }, A), op('close', { shift_id: S4 }, A)]);
  ok(r.results[5].error === 'overpaid', 'to\'lovdan keyin chegirma — ortiqcha to\'lov bilan yopilmaydi', r.results[5]);
  r = await sync([op('unpay', { payment_id: ap, approved_by: MGR }, A), op('pay', { payment: { id: id('y'), method: 'naqd', amount: 18000 } }, A), op('close', { shift_id: S4 }, A)]);
  ok(r.results.every((x) => x.ok) && r.orders[0].status === 'closed', 'ortiqcha to\'lov bekor qilingach yopildi', r.results);

  // 2) Qarzga to'langandan keyin mijozni almashtirib bo'lmaydi
  const B = id('o'); const cu1 = id('c'); const cu2 = id('c');
  r = await sync([op('open', { type: 'olib', number: 52, shift_id: S4 }, B), op('add', { item: { id: id('i'), product_id: cola, name: 'Cola', price: 10000, qty: 1, unit: 'dona' } }, B), op('send', {}, B),
    op('meta', { customer: { id: cu1, name: 'Vali' } }, B), op('pay', { payment: { id: id('y'), method: 'qarz', amount: 10000 } }, B), op('meta', { customer: { id: cu2, name: 'G\'ani' } }, B)]);
  ok(r.results[5].error === 'has_debt', 'qarzdan keyin mijoz almashtirilmaydi', r.results[5]);
  r = await sync([op('meta', { customer: null }, B)]);
  ok(r.results[0].error === 'has_debt', 'qarzdan keyin mijozni olib tashlab bo\'lmaydi');
  r = await sync([op('close', { shift_id: S4 }, B)]);
  ok(r.results[0].ok, 'qarzli buyurtma yopildi');
  r = await call('GET', '/api/debts', null, SES);
  ok(r.customers.find((c) => c.id === cu1)?.debt === 10000, 'qarz to\'g\'ri mijozda — 10 000');

  // 3) Xizmat haqini kassir o'zi olib tashlay olmaydi
  const h2 = (await call('POST', '/api/admin/hall', { name: 'Terrasa', service_pct: 10 }, SES)).id;
  const t2 = (await call('POST', '/api/admin/table', { name: 'T1', hall_id: h2 }, SES)).id;
  const Z = id('o');
  r = await sync([op('open', { type: 'zal', table_id: t2, number: 53, service_pct: 10, shift_id: S4 }, Z), op('service', { pct: 0 }, Z)]);
  ok(r.results[1].error === 'need_manager', 'xizmat haqini kamaytirish — menejer ruxsatisiz yo\'q');
  r = await sync([op('service', { pct: 0, approved_by: MGR }, Z), op('service', { pct: 12 }, Z)]);
  ok(r.results.every((x) => x.ok), 'menejer ruxsati bilan kamaydi, oshirish — ruxsatsiz');

  // 4) Zal o'chirilmaydi — stolida ochiq buyurtma bor; toifa o'chirilmaydi — ichida taom bor
  r = await call('POST', '/api/admin/remove', { kind: 'hall', id: h2 }, SES);
  ok(r.status === 409, 'ochiq buyurtmali zal o\'chirilmaydi', r);
  r = await call('POST', '/api/admin/remove', { kind: 'category', id: cat }, SES);
  ok(r.status === 409, 'taomli toifa o\'chirilmaydi', r);
  r = await sync([op('void', { reason: 'sinov', shift_id: S4 }, Z)]);
  ok(r.results[0].ok, 'zal buyurtmasi bekor qilindi');

  // 5) Kirim bekor qilinsa — o'rtacha narx kirimdan oldingi holatiga qaytadi
  const un = await mk('Un', 'kg');
  await call('POST', '/api/stock/doc', { kind: 'kirim', lines: [{ ingredient_id: un, qty: 10, price: 10000 }] }, SES);
  const d2 = (await call('POST', '/api/stock/doc', { kind: 'kirim', lines: [{ ingredient_id: un, qty: 10, price: 12000 }] }, SES)).id;
  await call('POST', '/api/stock/doc/cancel', { id: d2 }, SES);
  ings = (await call('GET', '/api/stock/ingredients', null, SES)).ingredients;
  ok(I(un).stock === 10 && Math.round(I(un).cost) === 10000, 'kirim bekor: 10 kg, 10 000 ga qaytdi', I(un));

  // 6) Bekor qilingan utilizatsiya zarar bo'lib sanalmaydi
  const w0 = (await call('GET', '/api/dashboard?day=' + today(), null, SES)).waste;
  const du = (await call('POST', '/api/stock/doc', { kind: 'utilizatsiya', reason: 'buzildi', lines: [{ ingredient_id: un, qty: 1 }] }, SES)).id;
  const w1 = (await call('GET', '/api/dashboard?day=' + today(), null, SES)).waste;
  await call('POST', '/api/stock/doc/cancel', { id: du }, SES);
  const w2 = (await call('GET', '/api/dashboard?day=' + today(), null, SES)).waste;
  ok(w1 === w0 + 10000 && w2 === w0, 'utilizatsiya bekor qilinsa — zarardan chiqadi', [w0, w1, w2]);

  // 7) Texkartasiz tayyor taomni utilizatsiya — aniq xabar bilan rad etiladi
  const sok = (await call('POST', '/api/admin/product', { name: 'Sok', price: 8000, cost: 5000, category_id: cat }, SES)).id;
  r = await call('POST', '/api/stock/doc', { kind: 'utilizatsiya', reason: 'buzildi', lines: [{ product_id: sok, qty: 2 }] }, SES);
  ok(r.status === 400 && r.error === 'no_recipe', 'texkartasiz taom utilizatsiyasi rad etiladi', r);

  // 8) Narxi chala texkarta qo'lda yozilgan tannarxni bosib ketmaydi
  const corn = (await call('POST', '/api/admin/product', { name: 'Corn Cheese', price: 25000, cost: 18000, category_id: cat }, SES)).id;
  const chz = await mk('Pishloq', 'kg');
  await call('POST', '/api/stock/recipe', { product_id: corn, lines: [{ ingredient_id: un, qty: 0.1 }, { ingredient_id: chz, qty: 0.05 }] }, SES);
  r = await call('GET', '/api/stock/recipe-costs', null, SES);
  ok(r.costs[corn]?.cost === 18000 && r.costs[corn].src === 'qolda', 'pishloq narxi yo\'q — qo\'lda yozilgan 18 000 olinadi', r.costs[corn]);

  // 9) Yetkazib beruvchisiz, kassadan to'langan kirim — kassadagi pul kamayadi
  let z = (await call('GET', '/api/shift/report?id=' + S4, null, DEV)).summary;
  const before = z.expected_cash;
  await call('POST', '/api/stock/doc', { kind: 'kirim', paid: 30000, pay_from: 'kassa', lines: [{ ingredient_id: un, qty: 3, price: 10000 }] }, SES);
  z = (await call('GET', '/api/shift/report?id=' + S4, null, DEV)).summary;
  ok(z.expected_cash === before - 30000, 'kassadan to\'langan kirim kassadagi puldan ayirildi', [before, z.expected_cash]);

  // 10) Yopilgan smenaga buyurtma yopilmaydi; yangi smena ochilsa — o'shanga tushadi
  r = await sync([op('shift.close', { shift_id: S4, counted: 0 })]);
  ok(r.results[0].ok, 'smena yopildi', r.results);
  const Off = id('o');
  r = await sync([op('open', { type: 'olib', number: 54, shift_id: S4 }, Off), op('add', { item: { id: id('i'), product_id: cola, name: 'Cola', price: 10000, qty: 1, unit: 'dona' } }, Off),
    op('send', {}, Off), op('pay', { payment: { id: id('y'), method: 'naqd', amount: 10000 } }, Off), op('close', { shift_id: S4 }, Off)]);
  ok(r.results[4].error === 'no_shift', 'yopilgan smenaga buyurtma yopilmaydi', r.results[4]);
  const S5 = id('s'); await sync([op('shift.open', { shift_id: S5, cash: 0 })]);
  r = await sync([op('close', { shift_id: S4 }, Off)]);
  ok(r.results[0].ok && r.orders[0].shift_id === S5, 'buyurtma hozirgi ochiq smenaga yopildi', r.orders[0]?.shift_id);
  await sync([op('shift.close', { shift_id: S5, counted: 10000 })]);

  // 11) Kassa soati oldinda bo'lsa — kelajak vaqti yozilmaydi
  const S6 = id('s');
  r = await sync([{ id: id('p'), type: 'shift.open', order_id: null, by: KASSIR, at: '2099-01-01T00:00:00Z', data: { shift_id: S6, cash: 0 } }]);
  ok(r.shift && Date.parse(r.shift.opened_at) < Date.now() + 60000, 'kelajakdagi vaqt server vaqtiga almashtirildi', r.shift?.opened_at);
  await sync([op('shift.close', { shift_id: S6, counted: 0 })]);
}

group('Qo\'shimchalar: narx, ombor, tannarx');
{
  const chz = await mk('Pishloq slays', 'kg');
  await call('POST', '/api/stock/doc', { kind: 'kirim', lines: [{ ingredient_id: chz, qty: 2, price: 80000 }] }, SES);
  let r = await call('POST', '/api/admin/modgroup', { name: 'Qo\'shimchalar', required: false, multi: true, mods: [
    { name: 'Pishloq', price: 5000, ingredient_id: chz, ingredient_qty: '0,03' }, { name: 'Piyozsiz', price: 0 }, { name: '' }], product_ids: [burger, 999999] }, SES);
  ok(r.ok, 'qo\'shimcha guruhi saqlandi', r);
  const G = r.id;
  r = await call('POST', '/api/admin/modgroup', { name: 'Bo\'sh', mods: [] }, SES);
  ok(r.status === 400, 'qo\'shimchasiz guruh rad etiladi');
  let boot = await call('GET', '/api/boot', null, DEV);
  const g = boot.modgroups.find((x) => x.id === G);
  ok(g && g.mods.length === 2 && g.product_ids.length === 1 && g.product_ids[0] === burger, 'kassa guruhni oladi (bo\'sh nom va begona taom tashlandi)', g);
  const PIS = g.mods.find((x) => x.name === 'Pishloq'); const PIY = g.mods.find((x) => x.name === 'Piyozsiz');
  const SM = id('s'); await sync([op('shift.open', { shift_id: SM, cash: 0 })]);
  const M = id('o'); const mi = id('i');
  r = await sync([op('open', { type: 'olib', number: 61, shift_id: SM }, M),
    op('add', { item: { id: mi, product_id: burger, name: 'Burger', base: 32000, price: 37000, qty: 2, unit: 'dona', mods: [{ id: PIS.id, name: 'Pishloq', price: 5000 }] } }, M)]);
  let it = r.orders[0].items[0];
  ok(it.price === 37000 && it.base === 32000 && it.mods.length === 1, 'qo\'shimcha narxga qo\'shildi: 32 000 + 5 000', it);
  r = await sync([op('mods', { item_id: mi, mods: [{ id: PIY.id, name: 'Piyozsiz', price: 0 }] }, M)]);
  ok(r.orders[0].items[0].price === 32000, 'qo\'shimcha almashtirildi — narx qaytdi', r.orders[0].items[0]);
  r = await sync([op('mods', { item_id: mi, mods: [{ id: PIS.id, name: 'Pishloq', price: 5000 }, { id: PIY.id, name: 'Piyozsiz', price: -100 }] }, M)]);
  it = r.orders[0].items[0];
  ok(it.price === 37000 && it.mods[1].price === 0, 'manfiy narx qabul qilinmaydi', it);
  const stockBefore = (await call('GET', '/api/stock/ingredients', null, SES)).ingredients.find((x) => x.id === chz).stock;
  r = await sync([op('send', {}, M), op('mods', { item_id: mi, mods: [] }, M)]);
  ok(r.results[1].error === 'sent', 'oshxonaga ketgan taomning qo\'shimchasi o\'zgarmaydi');
  r = await sync([op('pay', { payment: { id: id('y'), method: 'naqd', amount: 74000 } }, M), op('close', { shift_id: SM }, M)]);
  ok(r.results.every((x) => x.ok) && r.orders[0].status === 'closed', 'qo\'shimchali buyurtma yopildi', r.results);
  const after = (await call('GET', '/api/stock/ingredients', null, SES)).ingredients.find((x) => x.id === chz).stock;
  ok(Math.abs(stockBefore - after - 0.06) < 1e-9, 'pishloq ombordan yechildi: 2 × 30 g', [stockBefore, after]);
  const row = await db.first('SELECT mods, cost FROM order_items WHERE company_id = (SELECT company_id FROM orders WHERE id = ? /* tenant:global */) AND id = ?', M, mi);
  const burgerCost = (await call('GET', '/api/stock/recipe-costs', null, SES)).costs?.[burger];
  ok(row.mods === 'Pishloq, Piyozsiz', 'hisobotda qo\'shimcha nomlari', row);
  ok(Number(row.cost) >= 0.03 * 80000, 'tannarxga pishloq qo\'shildi', [row.cost, burgerCost?.cost]);
  // Ro'yxatdan olib tashlangan qo'shimcha kassada chiqmaydi
  r = await call('POST', '/api/admin/modgroup', { id: G, name: 'Qo\'shimchalar', mods: [{ id: PIS.id, name: 'Pishloq', price: 6000, ingredient_id: chz, ingredient_qty: 0.03 }], product_ids: [burger] }, SES);
  boot = await call('GET', '/api/boot', null, DEV);
  const g2 = boot.modgroups.find((x) => x.id === G);
  ok(g2.mods.length === 1 && g2.mods[0].price === 6000, 'olib tashlangani yashirindi, narx yangilandi', g2.mods);
  r = await call('POST', '/api/admin/modgroup/remove', { id: G }, SES);
  boot = await call('GET', '/api/boot', null, DEV);
  ok(r.ok && !boot.modgroups.some((x) => x.id === G), 'guruh o\'chirildi');
  await sync([op('shift.close', { shift_id: SM, counted: 74000 })]);
}

group('Chekni bo\'lish va birlashtirish (taomni boshqa buyurtmaga ko\'chirish)');
{
  const SX = id('s'); await sync([op('shift.open', { shift_id: SX, cash: 0 })]);
  const A = id('o'); const B = id('o'); const b1 = id('i'); const c1 = id('i'); const part = id('i');
  let r = await sync([op('open', { type: 'olib', number: 71, shift_id: SX }, A), op('open', { type: 'olib', number: 72, shift_id: SX }, B),
    op('add', { item: { id: b1, product_id: burger, name: 'Burger', price: 32000, qty: 3, unit: 'dona' } }, A),
    op('add', { item: { id: c1, product_id: cola, name: 'Cola', price: 10000, qty: 1, unit: 'dona' } }, A), op('send', { item_ids: [b1] }, A)]);
  ok(r.results.every((x) => x.ok), 'ikki buyurtma ochildi', r.results);
  const srcItem = r.orders.find((o) => o.id === A).items.find((i) => i.id === b1);
  r = await sync([op('xfer_in', { from: A, items: [{ ...srcItem, id: part, qty: 1 }] }, B), op('xfer_out', { to: B, items: [{ id: b1, qty: 1, new_id: part }] }, A)]);
  const oa = r.orders.find((o) => o.id === A); const ob = r.orders.find((o) => o.id === B);
  ok(oa.items.find((i) => i.id === b1).qty === 2 && ob.items[0].qty === 1 && ob.items[0].status === 'sent', '1 ta burger B ga o\'tdi, oshxonada holati saqlandi', [oa.items, ob.items]);
  r = await sync([op('xfer_in', { from: A, items: [{ ...srcItem, id: part, qty: 1 }] }, B)]);
  ok(r.orders[0].items.length === 1, 'takror ko\'chirish ikkilanmaydi');
  r = await sync([op('xfer_out', { to: B, items: [{ id: b1, qty: 5 }] }, A)]);
  ok(r.results[0].error === 'bad_qty', 'bor sonidan ko\'p ko\'chirilmaydi');
  r = await sync([op('xfer_out', { to: A, items: [{ id: b1 }] }, A)]);
  ok(r.results[0].error === 'bad_target', 'o\'ziga ko\'chirib bo\'lmaydi');
  // Birlashtirish: B butunlay A ga qo'shiladi, B bekor bo'ladi
  const bItems = (await sync([])).orders?.find?.((o) => o.id === B)?.items || ob.items;
  r = await sync([op('xfer_in', { from: B, items: bItems }, A), op('xfer_out', { to: A, items: bItems.map((i) => ({ id: i.id, qty: i.qty })) }, B), op('void', { reason: 'Birlashtirildi', shift_id: SX }, B)]);
  ok(r.results.every((x) => x.ok), 'birlashtirildi', r.results);
  const merged = r.orders.find((o) => o.id === A);
  ok(merged.items.filter((i) => i.product_id === burger).reduce((s, i) => s + i.qty, 0) === 3, 'A da yana 3 ta burger', merged.items);
  ok(r.orders.find((o) => o.id === B).status === 'void', 'B bekor qilindi (menejersiz — taomi qolmagan)');
  const beefBefore = (await call('GET', '/api/stock/ingredients', null, SES)).ingredients.find((x) => x.id === beef).stock;
  r = await sync([op('send', {}, A), op('pay', { payment: { id: id('y'), method: 'naqd', amount: 106000 } }, A), op('close', { shift_id: SX }, A)]);
  ok(r.results.every((x) => x.ok) && r.orders[0].status === 'closed', 'birlashgan hisob yopildi: 3×32 000 + 10 000', r.results);
  const beefAfter = (await call('GET', '/api/stock/ingredients', null, SES)).ingredients.find((x) => x.id === beef).stock;
  ok(Math.abs(beefBefore - beefAfter - 0.51) < 1e-9, 'ombordan 3 burger go\'shti bir marta yechildi', [beefBefore, beefAfter]);
  await sync([op('shift.close', { shift_id: SX, counted: 106000 })]);
}

group('Oshxona ekrani: taom tayyor (to\'langan buyurtmada ham)');
{
  const SK = id('s'); await sync([op('shift.open', { shift_id: SK, cash: 0 })]);
  const K = id('o'); const k1 = id('i'); const k2 = id('i');
  let r = await sync([op('open', { type: 'olib', number: 81, shift_id: SK }, K),
    op('add', { item: { id: k1, product_id: burger, name: 'Burger', price: 32000, qty: 1, unit: 'dona', station_id: st } }, K),
    op('add', { item: { id: k2, product_id: cola, name: 'Cola', price: 10000, qty: 1, unit: 'dona' } }, K),
    op('ready', { item_ids: [k1] }, K)]);
  ok(r.results[3].ok && !r.orders[0].items[0].ready_at, 'yuborilmagan taom tayyor bo\'lmaydi');
  r = await sync([op('send', {}, K), op('pay', { payment: { id: id('y'), method: 'naqd', amount: 42000 } }, K), op('close', { shift_id: SK }, K)]);
  ok(r.orders[0].status === 'closed', 'olib ketish oldin to\'lanib yopildi');
  r = await call('GET', '/api/kitchen', null, DEV);
  ok(r.orders.some((o) => o.id === K), 'yopilgan, lekin pishmagan buyurtma oshxona ekranida', r.orders.map((o) => o.number));
  r = await sync([op('ready', { item_ids: [k1] }, K)]);
  ok(r.results[0].ok && r.orders[0].items.find((i) => i.id === k1).ready_at && r.orders[0].status === 'closed', 'yopilgan buyurtmada taom tayyor bo\'ldi, yopiqligicha qoldi', r.results[0]);
  r = await sync([op('ready', { item_ids: [k1], undo: true }, K)]);
  ok(!r.orders[0].items.find((i) => i.id === k1).ready_at, 'tayyor belgisi qaytarildi');
  r = await sync([op('ready', { item_ids: [k1, k2] }, K)]);
  ok(r.orders[0].items.every((i) => i.ready_at), 'ikkala taom tayyor');
  const items = await db.all('SELECT id FROM order_items WHERE company_id = (SELECT company_id FROM orders WHERE id = ? /* tenant:global */) AND order_id = ?', K, K);
  ok(items.length === 2, 'hisobot jadvali ikki marta yozilmadi', items.length);
  r = await sync([op('qty', { item_id: k1, qty: 5 }, K)]);
  ok(r.results[0].error === 'closed', 'yopilgan buyurtmada boshqa amal hamon taqiqlangan');
  await sync([op('shift.close', { shift_id: SK, counted: 42000 })]);
}

group('Restoranlar aralashmaydi');
await call('POST', '/api/setup', { name: 'Boshqa kafe', email: 'b@t.uz', password: 'parol12345', pin: '1111' });
const DEV2 = (await call('POST', '/api/device/login', { email: 'b@t.uz', password: 'parol12345' })).token;
const boot2 = await call('GET', '/api/boot', null, DEV2);
ok(boot2.products.length === 0 && boot2.staff.length === 1, 'ikkinchi restoranda birinchisining menyusi yo\'q');
r = await call('POST', '/api/sync', { ops: [{ id: id('p'), type: 'add', order_id: O1, by: boot2.staff[0].id, at: now(), data: { item: { id: id('i'), name: 'x', price: 1, qty: 1 } } }] }, DEV2);
ok(r.results[0].ok === false, 'begona buyurtmaga amal qo\'llanmaydi');
let threw = false;
try { await db.all('SELECT * FROM orders'); } catch (e) { threw = e.code === 'NO_TENANT_SCOPE'; }
ok(threw, 'company_id siz so\'rov bajarilmaydi');

console.log(`\n${pass} ok, ${failN} xato`);
process.exit(failN ? 1 : 0);
