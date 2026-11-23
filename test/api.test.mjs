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

// TEST_DATABASE_URL berilsa — haqiqiy Postgres (Neon) ustida, postgres.js drayveri bilan.
// FAQAT bo'sh sinov bazasida ishlating: sinov o'z restoranlarini yaratadi.
let db; let endDb = () => {};
if (process.env.TEST_DATABASE_URL) {
  const { openDb, ensureSchema } = await import('../src/lib/pg.js');
  const o = openDb(process.env.TEST_DATABASE_URL);
  db = o.db; endDb = () => o.sql.end({ timeout: 5 });
  await ensureSchema(db);
  const n = (await db.first('SELECT COUNT(*)::int AS n FROM companies /* tenant:global */')).n;
  if (n) { console.error(`Bazada ${n} ta restoran bor — sinov faqat BO'SH bazada ishlaydi (ishchi bazani buzmaslik uchun).`); await endDb(); process.exit(2); }
} else {
  db = makeDb(pgliteClient(new PGlite()));
  await migrate(db);
}
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
{ // tana `null` yoki buzuq JSON bo'lsa ham 500 emas
  const rawCall = async (path, raw) => (await handle(new Request('http://t' + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw }), env, db)).status;
  ok(await rawCall('/api/device/login', 'null') === 401, 'tana null — 401 (500 emas)');
  ok(await rawCall('/api/device/login', '{buzuq') === 401, 'buzuq JSON — 401 (500 emas)');
  ok(await rawCall('/api/setup', '"matn"') === 400, 'tana satr — 400 (500 emas)');
}
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
  // Moddiy hisobotdagi pul xulosasi: savdo, foyda, utilizatsiya — "Foyda" hisoboti bilan AYNAN bir xil; xodimlar olgani
  // (ish haqi rasxodi) alohida; kassadagi naqd — ochiq smenaning hozirgi holati.
  r = await sync([op('expense', { expense_id: id('e'), category: 'Ish haqi', amount: 3000, pay_from: 'kassa', shift_id: SH3 }),
    op('expense', { expense_id: id('e'), category: 'Avans (Ali)', amount: 1000, pay_from: 'kassa', shift_id: SH3 }),
    op('expense', { expense_id: id('e'), category: 'Ijara', amount: 2000, pay_from: 'kassa', shift_id: SH3 })]);
  ok(r.results.every((x) => x.ok), 'ish haqi, avans va ijara rasxodi yozildi', r.results);
  const pf = (await call('GET', `/api/reports/profit?from=${today()}&to=${today()}`, null, SES)).totals;
  let mr = await call('GET', `/api/reports/material?from=${today()}&to=${today()}`, null, SES);
  const mo = mr.money;
  ok(mo && mo.revenue === pf.revenue && mo.cost === pf.cost && mo.net === pf.net && mo.waste === pf.waste && mo.expenses === pf.expenses, 'moddiy hisobot: pul xulosasi Foyda hisoboti bilan bir xil', [mo, pf]);
  ok(mo.net === mo.revenue - mo.cost - mo.expenses - mo.waste, 'sof foyda = savdo − tannarx − rasxod − utilizatsiya', mo);
  ok(mo.staff === 4000 && mo.expenses - mo.staff >= 2000, 'xodimlar oldi: ish haqi + avans = 4 000 (ijara kirmaydi)', mo);
  ok(mo.cash === 10000 - 6000 && mo.shift_number > 0, 'kassada bor: 10 000 naqd − 6 000 rasxod = 4 000 (ochiq smena)', mo);
  ok(pf.staff === 4000, 'Foyda hisobotida ham xodimlar ulushi bor', pf.staff);
  r = await call('GET', `/api/reports/material?from=${today()}&to=${today()}`, null, DEV);
  ok(r.status === 401 || r.status === 403, 'pul xulosasi kassa qurilmasiga ochilmaydi (faqat rahbar)', r.status);
  await sync([op('shift.close', { shift_id: SH3, counted: 4000 })]);
  mr = await call('GET', `/api/reports/material?from=${today()}&to=${today()}`, null, SES);
  ok(mr.money.cash === null && mr.money.revenue === mo.revenue, 'smena yopilgach "kassada bor" bo\'sh, savdo o\'zgarmaydi', mr.money);
  mr = await call('GET', '/api/reports/material?from=2020-01-01&to=2020-01-01', null, SES);
  ok(mr.money.revenue === 0 && mr.money.net === 0 && mr.money.staff === 0, 'savdosiz davrda pul xulosasi nol', mr.money);
}

// ---------- To'lov turini tuzatish ----------
group('Yopilgan chekda to\'lov turini o\'zgartirish');
{
  const SH4 = id('s'); await sync([op('shift.open', { shift_id: SH4, cash: 100000 })]);
  const O = id('o'); const PAY = id('y'); const PAY2 = id('y');
  let r = await sync([op('open', { type: 'olib', number: 1, shift_id: SH4 }, O), op('add', { item: { id: id('i'), product_id: cola, name: 'Cola', price: 10000, qty: 3, unit: 'dona', station_id: null } }, O),
    op('send', {}, O), op('pay', { payment: { id: PAY, method: 'naqd', amount: 20000 } }, O), op('pay', { payment: { id: PAY2, method: 'karta', amount: 10000 } }, O), op('close', { shift_id: SH4 }, O)]);
  ok(r.results.every((x) => x.ok), 'chek yopildi: 20 000 naqd + 10 000 karta', r.results);
  r = await call('GET', '/api/shift/report?id=' + SH4, null, DEV);
  ok(r.summary.expected_cash === 120000 && r.summary.by_method.naqd === 20000, 'oldin: kassada 120 000 bo\'lishi kerak', r.summary);
  r = await call('POST', '/api/order/pay-method', { order_id: O, payment_id: PAY, method: 'click' }, DEV);
  ok(r.status === 401 || r.status === 403, 'kassa qurilmasi (rahbar emas) o\'zgartira olmaydi', r.status);
  r = await call('POST', '/api/order/pay-method', { order_id: O, payment_id: PAY, method: 'qarz' }, SES);
  ok(r.status === 400, 'qarzga o\'tkazib bo\'lmaydi (mijoz qarzi alohida yuritiladi)', r.status);
  r = await call('POST', '/api/order/pay-method', { order_id: O, payment_id: 'yoq', method: 'karta' }, SES);
  ok(r.status === 409 && r.error === 'no_payment', 'yo\'q to\'lov — rad etiladi', r);
  r = await call('POST', '/api/order/pay-method', { order_id: O, payment_id: PAY, method: 'click' }, SES);
  ok(r.ok && r.from === 'naqd' && r.to === 'click' && !r.shift_closed, 'naqd → Click (smena ochiq)', r);
  r = await call('POST', '/api/order/pay-method', { order_id: O, payment_id: PAY, method: 'click' }, SES);
  ok(r.ok && r.already, 'takror so\'rov hech narsani o\'zgartirmaydi', r);
  r = await call('GET', '/api/shift/report?id=' + SH4, null, DEV);
  ok(r.summary.expected_cash === 100000 && r.summary.by_method.naqd === 0 && r.summary.by_method.click === 20000 && r.summary.total === 30000,
    'smena hisoboti: naqd 0, Click 20 000, kassada 100 000; savdo o\'zgarmadi', r.summary);
  r = await call('GET', `/api/reports/summary?from=${today()}&to=${today()}`, null, SES);
  const mth = Object.fromEntries(r.methods.map((x) => [x.method, x.sum]));
  ok((mth.click || 0) >= 20000, 'Savdo hisobotida to\'lov turi yangilangan', r.methods);
  r = await call('GET', '/api/reports/order?id=' + O, null, SES);
  const pm = r.ops.find((x) => x.type === 'pay_method');
  ok(pm && pm.data.from === 'naqd' && pm.data.to === 'click' && pm.user_id === OWNER && r.order.payments.find((x) => x.id === PAY).changed?.from === 'naqd',
    'buyurtma tarixida: kim, nimadan nimaga', pm);
  // smena yopilgandan keyin: Z-hisobot qayta hisoblanadi (kassada bo'lishi kerak va farq)
  await sync([op('shift.close', { shift_id: SH4, counted: 100000 })]);
  r = await call('GET', '/api/shift/report?id=' + SH4, null, DEV);
  ok(r.shift.status === 'closed' && r.summary.diff === 0, 'smena yopildi, farq 0', r.summary);
  r = await call('POST', '/api/order/pay-method', { order_id: O, payment_id: PAY2, method: 'naqd' }, SES);
  ok(r.ok && r.shift_closed, 'yopilgan smenadagi chek: karta → naqd', r);
  r = await call('GET', '/api/shift/report?id=' + SH4, null, DEV);
  ok(r.summary.expected_cash === 110000 && r.summary.diff === -10000 && r.summary.by_method.karta === 0 && r.summary.counted_cash === 100000,
    'Z-hisobot to\'g\'rilandi: kassada 110 000 bo\'lishi kerak edi, farq −10 000', r.summary);
  const shs = await call('GET', '/api/reports/shifts', null, SES);
  ok(shs.shifts.find((x) => x.id === SH4)?.expected_cash === 110000, 'smenalar ro\'yxatida ham yangilangan', shs.shifts.find((x) => x.id === SH4));
  // qarzga yozilgan to'lovga tegilmaydi; ochiq buyurtmada ham yo'q
  const O2 = id('o'); const P3 = id('y'); const SH5 = id('s'); await sync([op('shift.open', { shift_id: SH5, cash: 0 })]);
  r = await sync([op('open', { type: 'olib', number: 1, shift_id: SH5 }, O2), op('add', { item: { id: id('i'), product_id: cola, name: 'Cola', price: 10000, qty: 1, unit: 'dona', station_id: null } }, O2)]);
  r = await call('POST', '/api/order/pay-method', { order_id: O2, payment_id: P3, method: 'karta' }, SES);
  ok(r.status === 409 && r.error === 'not_closed', 'ochiq buyurtmada o\'zgartirilmaydi', r);
  r = await call('POST', '/api/order/pay-method', { order_id: 'yoq-buyurtma', payment_id: P3, method: 'karta' }, SES);
  ok(r.status === 404, 'yo\'q buyurtma — 404', r.status);
  await sync([op('void', { reason: 'sinov', shift_id: SH5 }, O2)]);
  r = await sync([op('shift.close', { shift_id: SH5, counted: 0 })]);
  ok(r.results[0].ok, 'sinov smenasi yopildi (keyingi sinovlarga ochiq smena qolmaydi)', r.results[0]);
}

// ---------- Analitika ----------
group('Analitika: oldingi davr bilan solishtirish, ABC, hafta kuni va soat');
{
  const day = today(); const yest = new Date(Date.parse(day) - 86400e3).toISOString().slice(0, 10);
  const sumOf = (rows, k) => rows.reduce((a, x) => a + x[k], 0);
  let a = await call('GET', `/api/reports/analytics?from=${day}&to=${day}`, null, SES);
  const p = await call('GET', `/api/reports/profit?from=${day}&to=${day}`, null, SES);
  ok(a.status === 200 && a.days_n === 1 && a.prev.from === yest && a.prev.to === yest, 'bir kunlik davr — kechagi kun bilan solishtiriladi', a.prev);
  ok(a.cur.revenue === p.totals.revenue && a.cur.gross === p.totals.gross && a.cur.net === p.totals.net && a.cur.orders === p.totals.orders, 'pul raqamlari Foyda hisoboti bilan bir xil', [a.cur, p.totals]);
  ok(a.cur.avg_check === Math.round(a.cur.revenue / a.cur.orders), 'o\'rtacha chek = savdo ÷ buyurtma');
  ok(a.old.revenue === 0 && a.old.orders === 0, 'kecha savdo yo\'q');
  ok(a.days.length === 1 && a.days[0].sum === a.cur.revenue && a.prev_days.length === 1 && a.prev_days[0].sum === 0, 'kunlar qatori: bo\'sh kun ham bor');
  ok(a.weekdays.length === 7 && sumOf(a.weekdays, 'sum') === a.cur.revenue && sumOf(a.weekdays, 'n') === a.cur.orders, 'hafta kunlari yig\'indisi savdoga teng');
  ok(sumOf(a.heat, 'sum') === a.cur.revenue && sumOf(a.hours, 'n') === a.cur.orders, 'kun × soat kesimi yig\'indisi savdoga teng');
  const itemsRev = sumOf(a.items, 'revenue');
  ok(a.items.length > 0 && itemsRev === p.totals.items_revenue, 'taomlar savdosi Foyda hisobotidagi bilan teng', [itemsRev, p.totals.items_revenue]);
  ok(a.abc.A.n + a.abc.B.n + a.abc.C.n === a.items.length && a.abc.A.revenue + a.abc.B.revenue + a.abc.C.revenue === itemsRev, 'ABC: har taom bitta sinfda');
  ok(a.items[0].cls === 'A' && a.items.every((x, i) => !i || a.items[i - 1].revenue >= x.revenue), 'eng ko\'p sotilgan taom — A, ro\'yxat savdo bo\'yicha');
  ok(sumOf(a.categories, 'revenue') === itemsRev && sumOf(a.categories, 'profit') === sumOf(a.items, 'profit'), 'toifalar yig\'indisi taomlarnikiga teng');
  ok(a.items.every((x) => x.prev_revenue === 0), 'oldingi davrda sotilmagan');

  const dead = (await call('POST', '/api/admin/product', { name: 'Sotilmaydigan taom', price: 77000, category_id: cat }, SES)).id;
  a = await call('GET', `/api/reports/analytics?from=${day}&to=${day}`, null, SES);
  const dr = a.dead.find((x) => x.id === dead);
  ok(dr && dr.last_sold === null && dr.price === 77000 && a.dead_n >= 1, 'sotilmagan taom ro\'yxatda', dr);
  ok(!a.dead.some((x) => a.items.some((i) => i.product_id === x.id)), 'sotilgan taom "sotilmagan"lar ichida yo\'q');

  // Bitta buyurtmani kechagi kunga suramiz — oldingi davr va "pasaygan" ro'yxati
  const one = await db.first("SELECT o.id, o.total::float8 AS total FROM orders o WHERE o.company_id = (SELECT company_id FROM users WHERE id = ?) AND o.status = 'closed' ORDER BY o.closed_at LIMIT 1", OWNER);
  await db.run("UPDATE orders SET closed_at = closed_at - interval '1 day' WHERE id = ? /* tenant:global */", one.id);
  await db.run("UPDATE order_items SET closed_at = closed_at - interval '1 day' WHERE order_id = ? /* tenant:global */", one.id);
  const b = await call('GET', `/api/reports/analytics?from=${day}&to=${day}`, null, SES);
  ok(b.old.orders >= 1 && b.old.revenue >= one.total && b.cur.revenue + b.old.revenue >= p.totals.revenue, 'kechaga surilgan buyurtma oldingi davrda', [b.old, one]);
  ok(b.items.some((x) => x.prev_revenue > 0) || b.gone.length > 0, 'taomda oldingi davr savdosi ko\'rinadi');
  const w = await call('GET', `/api/reports/analytics?from=${yest}&to=${day}`, null, SES);
  ok(w.days_n === 2 && w.days.length === 2 && w.cur.revenue === b.cur.revenue + b.old.revenue && sumOf(w.weekdays, 'days') === 2, 'ikki kunlik davr ikkalasini qo\'shadi', w.cur);
  await db.run("UPDATE orders SET closed_at = closed_at + interval '1 day' WHERE id = ? /* tenant:global */", one.id);
  await db.run("UPDATE order_items SET closed_at = closed_at + interval '1 day' WHERE order_id = ? /* tenant:global */", one.id);

  let r = await call('GET', `/api/reports/analytics?from=${day}&to=${yest}`, null, SES);
  ok(r.status === 400, 'teskari sana — 400', r.status);
  r = await call('GET', '/api/reports/analytics?from=2020-01-01&to=2026-01-01', null, SES);
  ok(r.status === 400, '400 kundan uzun davr — 400', r.status);
  r = await call('GET', `/api/reports/analytics?from=${day}&to=${day}`, null, DEV);
  ok(r.status === 401 || r.status === 403, 'qurilma belgisi bilan (rahbar emas) ochilmaydi', r.status);
}

// ---------- Zagotovka ----------
group('Zagotovka (yarim tayyor): tarkib, tayyorlash, sotuvda ayirish');
{
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const stocks = async () => Object.fromEntries((await call('GET', '/api/stock/ingredients', null, SES)).ingredients.map((x) => [x.id, x]));
  const qiyma = await mk('Qiyma Z', 'kg'); const piyoz = await mk('Piyoz Z', 'kg'); const non = await mk('Bulka Z', 'dona');
  let r = await call('POST', '/api/stock/doc', { kind: 'kirim', lines: [{ ingredient_id: qiyma, qty: 10, price: 80000 }, { ingredient_id: piyoz, qty: 5, price: 4000 }, { ingredient_id: non, qty: 100, price: 1500 }] }, SES);
  ok(r.ok, 'masalliqlar kirim qilindi', r);

  r = await call('POST', '/api/stock/prep', { name: 'Kotlet Z', unit: 'dona', yield: 10, lines: [] }, SES);
  ok(r.status === 400 && r.error === 'empty', 'tarkibsiz zagotovka rad etiladi', r);
  r = await call('POST', '/api/stock/prep', { name: 'Kotlet Z', unit: 'dona', yield: 0, lines: [{ ingredient_id: qiyma, qty: 1 }] }, SES);
  ok(r.status === 400 && r.error === 'bad_yield', 'chiqishi 0 — rad etiladi', r);
  r = await call('POST', '/api/stock/prep', { name: 'Kotlet Z', unit: 'dona', yield: 10, lines: [{ ingredient_id: qiyma, qty: 1 }, { ingredient_id: piyoz, qty: 0.1 }] }, SES);
  ok(r.ok && r.id, 'zagotovka saqlandi: 1 kg qiyma + 100 g piyoz → 10 dona kotlet', r);
  const kot = r.id;
  r = await call('POST', '/api/stock/prep', { name: 'kotlet z', unit: 'dona', yield: 1, lines: [{ ingredient_id: qiyma, qty: 1 }] }, SES);
  ok(r.status === 409, 'takror nom rad etiladi', r.status);
  r = await call('POST', '/api/stock/prep', { name: 'Sous Z', unit: 'kg', yield: 1, lines: [{ ingredient_id: kot, qty: 1 }] }, SES);
  ok(r.status === 400 && r.error === 'nested', 'zagotovka ichiga zagotovka qo\'yilmaydi', r);
  r = await call('POST', '/api/stock/prep', { id: qiyma, name: 'Qiyma Z', unit: 'kg', yield: 1, lines: [{ ingredient_id: piyoz, qty: 1 }] }, SES);
  ok(r.status === 400 && r.error === 'nested', 'boshqa zagotovka tarkibidagi masalliq zagotovkaga aylanmaydi', r);
  r = await call('POST', '/api/stock/prep', { name: 'X', unit: 'kg', yield: 1, lines: [{ ingredient_id: qiyma, qty: 1 }] }, DEV);
  ok(r.status === 401 || r.status === 403, 'faqat rahbar', r.status);

  r = await call('GET', '/api/stock/preps', null, SES);
  let pz = r.preps.find((x) => x.id === kot);
  ok(pz && pz.yield === 10 && pz.lines.length === 2 && pz.batch_cost === 80400 && pz.cost === 8040 && pz.stock === 0, 'ro\'yxat: tarkib va 1 dona tannarxi (80 400 ÷ 10 = 8 040)', pz);
  let S0 = await stocks();
  ok(S0[kot].prep === true && Math.round(S0[kot].cost) === 8040 && S0[qiyma].prep === false, 'masalliqlar ro\'yxatida zagotovka belgisi va hisoblangan narxi', S0[kot]);

  const zb = (await call('POST', '/api/admin/product', { name: 'Burger Z', price: 30000, category_id: cat }, SES)).id;
  r = await call('POST', '/api/stock/recipe', { product_id: zb, lines: [{ ingredient_id: kot, qty: 1 }, { ingredient_id: non, qty: 1 }] }, SES);
  ok(r.ok, 'taom texkartasiga zagotovka qo\'yildi');
  r = await call('GET', '/api/stock/recipe-costs', null, SES);
  ok(r.costs[zb]?.cost === 9540 && r.costs[zb].src === 'texkarta', 'taom tannarxi: kotlet 8 040 + bulka 1 500 = 9 540 (hali tayyorlanmagan bo\'lsa ham)', r.costs[zb]);
  r = await call('GET', '/api/stock/recipe?product_id=' + zb, null, SES);
  ok(r.cost === 9540, 'texkarta oynasida ham shu tannarx', r.cost);

  const SHZ = id('s'); await sync([op('shift.open', { shift_id: SHZ, cash: 0 })]);
  const sell = async (q) => { const O = id('o'); const rr = await sync([op('open', { type: 'olib', number: 1, shift_id: SHZ }, O), op('add', { item: { id: id('i'), product_id: zb, name: 'Burger Z', price: 30000, qty: q, unit: 'dona', station_id: null } }, O),
    op('send', {}, O), op('pay', { payment: { id: id('y'), method: 'naqd', amount: 30000 * q } }, O), op('close', { shift_id: SHZ }, O)]); return rr.results.every((x) => x.ok); };

  // 1) Tayyori yo'q — tarkibidagi masalliqlar ayiriladi
  ok(await sell(2), '2 ta burger sotildi (kotlet tayyorlanmagan)');
  let S1 = await stocks();
  ok(near(S1[qiyma].stock, 9.8) && near(S1[piyoz].stock, 4.98) && S1[non].stock === 98 && S1[kot].stock === 0, 'tayyor kotlet yo\'q — qiyma 200 g, piyoz 20 g, bulka 2 dona ayirildi', [S1[qiyma].stock, S1[piyoz].stock, S1[non].stock, S1[kot].stock]);

  // 2) Tayyorlash: 20 dona
  r = await call('POST', '/api/stock/doc', { kind: 'tayyorlash', lines: [{ ingredient_id: qiyma, qty: 1 }] }, SES);
  ok(r.status === 400 && r.error === 'not_prep', 'oddiy masalliqni "tayyorlab" bo\'lmaydi', r);
  r = await call('POST', '/api/stock/doc', { kind: 'tayyorlash', lines: [{ ingredient_id: kot, qty: 20 }] }, SES);
  ok(r.ok, '20 dona kotlet tayyorlandi', r);
  const pdoc = r.id;
  S1 = await stocks();
  ok(near(S1[qiyma].stock, 7.8) && near(S1[piyoz].stock, 4.78) && S1[kot].stock === 20, 'qiyma 2 kg, piyoz 200 g chiqdi; kotlet 20 dona kirdi', [S1[qiyma].stock, S1[piyoz].stock, S1[kot].stock]);
  r = await call('GET', '/api/stock/doc?id=' + pdoc, null, SES);
  ok(r.doc.kind === 'tayyorlash' && r.doc.total === 160800 && r.moves.length === 3, 'hujjat: 3 ta harakat, tannarxi 160 800', [r.doc.total, r.moves.length]);
  pz = (await call('GET', '/api/stock/preps', null, SES)).preps.find((x) => x.id === kot);
  ok(pz.stock === 20 && pz.cost === 8040, 'zagotovka: 20 dona, 8 040 dan');

  // 3) Tayyori bor — o'shandan olinadi
  ok(await sell(3), '3 ta burger sotildi (kotlet tayyor)');
  S1 = await stocks();
  ok(S1[kot].stock === 17 && near(S1[qiyma].stock, 7.8) && S1[non].stock === 95, 'tayyor kotletdan 3 dona ayirildi, qiymaga tegilmadi', [S1[kot].stock, S1[qiyma].stock]);

  // 4) Utilizatsiya: 18 dona — 17 tasi tayyoridan, 1 tasi masalliqdan
  r = await call('POST', '/api/stock/doc', { kind: 'utilizatsiya', reason: 'buzildi', lines: [{ ingredient_id: kot, qty: 18 }] }, SES);
  ok(r.ok, 'kotlet utilizatsiya qilindi', r);
  S1 = await stocks();
  ok(S1[kot].stock === 0 && near(S1[qiyma].stock, 7.7) && near(S1[piyoz].stock, 4.77), 'utilizatsiya: tayyori tugadi, yetmagani tarkibidan (qiyma 100 g)', [S1[kot].stock, S1[qiyma].stock, S1[piyoz].stock]);

  // 5) Aralash: 2 dona tayyor + 3 ta burger → 2 tasi tayyoridan, 1 tasi masalliqdan
  await call('POST', '/api/stock/doc', { kind: 'tayyorlash', lines: [{ ingredient_id: kot, qty: 2 }] }, SES);
  ok(await sell(3), '3 ta burger sotildi (kotlet 2 dona tayyor)');
  S1 = await stocks();
  ok(S1[kot].stock === 0 && near(S1[qiyma].stock, 7.4) && near(S1[piyoz].stock, 4.74), 'tayyori yetmasa — qolgani masalliqdan: manfiyga tushmaydi', [S1[kot].stock, S1[qiyma].stock, S1[piyoz].stock]);

  // 6) Tayyorlash hujjatini bekor qilish
  r = await call('POST', '/api/stock/doc', { kind: 'tayyorlash', lines: [{ ingredient_id: kot, qty: 10 }] }, SES);
  await call('POST', '/api/stock/doc/cancel', { id: r.id }, SES);
  S1 = await stocks();
  ok(S1[kot].stock === 0 && near(S1[qiyma].stock, 7.4) && near(S1[piyoz].stock, 4.74), 'bekor qilingan tayyorlash: masalliq qaytdi, kotlet chiqdi', [S1[kot].stock, S1[qiyma].stock]);

  // 7) Moddiy hisobot balanslanadi
  r = await call('GET', `/api/reports/material?from=${today()}&to=${today()}`, null, SES);
  const mq = r.rows.find((x) => x.id === qiyma); const mk_ = r.rows.find((x) => x.id === kot);
  ok(mq && near(mq.open_q + mq.in_q - mq.used_q - mq.waste_q + mq.inv_q, mq.close_q) && near(mq.close_q, 7.4), 'moddiy hisobot: qiyma qatori balansda', mq);
  ok(mk_ && near(mk_.open_q + mk_.in_q - mk_.used_q - mk_.waste_q + mk_.inv_q, mk_.close_q) && mk_.in_q === 32, 'moddiy hisobot: kotlet — tayyorlangani kirim ustunida (20 + 2 + 10)', mk_);
  ok(near(mq.used_q, 0.2 + 2 + 0.2 + 0.1 + 1), 'qiyma sarfi: sotuv + zagotovkaga ketgani', mq.used_q);

  // 8) Tarkibni o'zgartirish, oddiy masalliqqa qaytarish, masalliqni o'chirish
  r = await call('POST', '/api/stock/prep', { id: kot, name: 'Kotlet Z', unit: 'dona', yield: 20, lines: [{ ingredient_id: qiyma, qty: 1 }] }, SES);
  pz = (await call('GET', '/api/stock/preps', null, SES)).preps.find((x) => x.id === kot);
  ok(r.ok && pz.lines.length === 1 && pz.yield === 20 && pz.cost === 4000, 'tarkib tahrirlandi: 1 kg qiyma → 20 dona (4 000 dan)', pz);
  r = await call('POST', '/api/stock/prep/unset', { id: kot }, SES);
  S1 = await stocks();
  ok(r.ok && S1[kot].prep === false && !(await call('GET', '/api/stock/preps', null, SES)).preps.some((x) => x.id === kot), 'oddiy masalliqqa qaytarildi');
  r = await call('GET', '/api/stock/recipe?product_id=' + zb, null, SES);
  ok(r.lines.some((l) => l.ingredient_id === kot), 'texkartadagi o\'rni saqlandi');
  r = await call('POST', '/api/stock/prep', { id: kot, name: 'Kotlet Z', unit: 'dona', yield: 10, lines: [{ ingredient_id: qiyma, qty: 1 }, { ingredient_id: piyoz, qty: 0.1 }] }, SES);
  ok(r.ok && r.id === kot, 'mavjud masalliq zagotovkaga aylantirildi');
  await call('POST', '/api/stock/ingredient/remove', { id: piyoz }, SES);
  pz = (await call('GET', '/api/stock/preps', null, SES)).preps.find((x) => x.id === kot);
  ok(pz.lines.length === 1 && pz.lines[0].ingredient_id === qiyma, 'o\'chirilgan masalliq tarkibdan ham chiqadi', pz.lines);
  r = await sync([op('shift.close', { shift_id: SHZ, counted: 0 })]);
  ok(r.results[0].ok, 'sinov smenasi yopildi', r.results[0]);
}

// ---------- Tayyor (dona) tovar ----------
group('Tayyor tovar: menyuga qo\'shilganda omborda o\'zi hisoblanadi');
{
  const ingOf = async (iid) => (await call('GET', '/api/stock/ingredients', null, SES)).ingredients.find((x) => x.id === iid);
  const menuOf = async (pid) => (await call('GET', '/api/admin/menu', null, SES)).products.find((x) => x.id === pid);
  let r = await call('POST', '/api/admin/product', { name: 'Fanta 0,5 T', price: 9000, category_id: cat, goods: true }, SES);
  ok(r.ok && r.goods_id, 'tayyor tovar saqlandi — ombor masallig\'i o\'zi ochildi', r);
  const fanta = r.id; const fi = r.goods_id;
  let ing = await ingOf(fi);
  ok(ing && ing.name === 'Fanta 0,5 T' && ing.unit === 'dona' && ing.stock === 0 && ing.grp === 'Tayyor tovar', 'omborda: shu nom, dona', ing);
  r = await call('GET', '/api/stock/recipe?product_id=' + fanta, null, SES);
  ok(r.lines.length === 1 && r.lines[0].ingredient_id === fi && r.lines[0].qty === 1, 'texkarta o\'zi yozildi: 1 dona');
  await call('POST', '/api/stock/doc', { kind: 'kirim', lines: [{ ingredient_id: fi, qty: 24, price: 5500 }] }, SES);
  let mp = await menuOf(fanta);
  ok(mp.goods_id === fi && mp.goods_stock === 24, 'menyuda qoldig\'i ko\'rinadi', mp);
  r = await call('GET', '/api/stock/recipe-costs', null, SES);
  ok(r.costs[fanta]?.cost === 5500, 'tannarx kirim narxidan (5 500)', r.costs[fanta]);

  const SHG = id('s'); await sync([op('shift.open', { shift_id: SHG, cash: 0 })]);
  const O = id('o');
  r = await sync([op('open', { type: 'olib', number: 1, shift_id: SHG }, O), op('add', { item: { id: id('i'), product_id: fanta, name: 'Fanta 0,5 T', price: 9000, qty: 3, unit: 'dona', station_id: null } }, O),
    op('send', {}, O), op('pay', { payment: { id: id('y'), method: 'naqd', amount: 27000 } }, O), op('close', { shift_id: SHG }, O)]);
  ok(r.results.every((x) => x.ok), '3 dona sotildi', r.results);
  ok((await ingOf(fi)).stock === 21, 'ombordan 3 dona ayirildi', (await ingOf(fi)).stock);

  // nomi o'zgarsa ombordagi nomi ham; goods yuborilmasa bog'lanish o'zgarmaydi
  r = await call('POST', '/api/admin/product', { id: fanta, name: 'Fanta 0,5 litr T', price: 9500, category_id: cat, goods: true }, SES);
  ok(r.ok && r.goods_id === fi && (await ingOf(fi)).name === 'Fanta 0,5 litr T', 'nom o\'zgarsa ombordagi nomi ham o\'zgaradi');
  r = await call('POST', '/api/admin/product', { id: fanta, name: 'Fanta 0,5 litr T', price: 9500, category_id: cat }, SES);
  ok(r.ok && (await menuOf(fanta)).goods_id === fi, 'goods yuborilmasa — bog\'lanish joyida');
  ok((await call('GET', '/api/stock/ingredients', null, SES)).ingredients.filter((x) => /^Fanta 0,5/.test(x.name)).length === 1, 'qayta saqlash ikkinchi masalliq ochmaydi');

  // mavjud masalliqqa bog'lanadi (yangi ochilmaydi); o'lchovi boshqa va harakati bor bo'lsa — rad
  const kt = await mk('Kotlet T', 'dona');
  await call('POST', '/api/stock/doc', { kind: 'kirim', lines: [{ ingredient_id: kt, qty: 40, price: 6000 }] }, SES);
  r = await call('POST', '/api/admin/product', { name: 'kotlet t', price: 12000, category_id: cat, goods: true }, SES);
  ok(r.ok && r.goods_id === kt, 'shu nomli masalliq bor — o\'shanga bog\'landi', r);
  const before = (await call('GET', '/api/admin/menu', null, SES)).products.length;
  r = await call('POST', '/api/admin/product', { name: 'Mol go\'shti', price: 150000, unit: 'dona', category_id: cat, goods: true }, SES);
  ok(r.status === 409 && r.error === 'unit_mismatch', 'omborda kg bilan yuritiladigan narsa donalab sotilmaydi', r);
  ok((await call('GET', '/api/admin/menu', null, SES)).products.length === before, 'rad etilganda taom yaratilmaydi');

  // tayyor tovarlikdan chiqarish; boshqa texkarta yozilsa ham chiqadi; masalliq o'chirilsa bog'lanish uziladi
  r = await call('POST', '/api/stock/recipe', { product_id: fanta, lines: [{ ingredient_id: fi, qty: 2 }] }, SES);
  ok(r.ok && (await menuOf(fanta)).goods_id === null, 'boshqa texkarta yozilsa — oddiy taom');
  r = await call('POST', '/api/admin/product', { id: fanta, name: 'Fanta 0,5 litr T', price: 9500, category_id: cat, goods: true }, SES);
  ok(r.goods_id === fi && (await call('GET', '/api/stock/recipe?product_id=' + fanta, null, SES)).lines[0].qty === 1, 'qayta tayyor tovar: texkarta yana 1 dona');
  r = await call('POST', '/api/admin/product', { id: fanta, name: 'Fanta 0,5 litr T', price: 9500, category_id: cat, goods: false }, SES);
  ok(r.ok && r.goods_id === null && (await menuOf(fanta)).goods_id === null && (await ingOf(fi)).stock === 21, 'belgi olib tashlandi — masalliq va qoldiq joyida');
  await call('POST', '/api/admin/product', { id: fanta, name: 'Fanta 0,5 litr T', price: 9500, category_id: cat, goods: true }, SES);
  await call('POST', '/api/stock/ingredient/remove', { id: fi }, SES);
  ok((await menuOf(fanta)).goods_id === null, 'masalliq o\'chirilsa bog\'lanish uziladi');
  r = await sync([op('shift.close', { shift_id: SHG, counted: 0 })]);
  ok(r.results[0].ok, 'sinov smenasi yopildi', r.results[0]);
}

// ---------- Element kartasi ----------
group('Element kartasi: qayerda ishlatiladi, oxirgi kirim');
{
  let r = await call('GET', '/api/stock/ingredient?id=' + beef, null, SES);
  ok(r.ok && r.ingredient.id === beef && r.ingredient.unit === 'kg' && r.ingredient.moves > 0 && r.ingredient.value === Math.round(Math.max(0, r.ingredient.stock) * r.ingredient.cost), 'karta: qoldiq, narx, qiymat', r.ingredient);
  ok(r.dishes.some((d) => d.id === burger && d.qty === 0.17), 'qaysi taomda va qancha ishlatilishi', r.dishes);
  ok(r.last_in && r.last_in.price === 120000 && r.last_in.qty === 10, 'oxirgi kirim narxi va miqdori', r.last_in);
  r = await call('GET', '/api/stock/ingredient?id=' + bun, null, SES);
  ok(r.ok && r.goods === null && Array.isArray(r.preps), 'tayyor tovar emas — goods bo\'sh');
  const gp = await call('POST', '/api/admin/product', { name: 'Suv Karta T', price: 4000, category_id: cat, goods: true }, SES);
  r = await call('GET', '/api/stock/ingredient?id=' + gp.goods_id, null, SES);
  ok(r.goods?.id === gp.id && r.goods.price === 4000 && r.last_in === null && r.ingredient.moves === 0, 'tayyor tovar: menyudagi taomi ko\'rinadi, kirim hali yo\'q', r);
  r = await call('GET', '/api/stock/ingredient?id=999999', null, SES);
  ok(r.status === 404, 'yo\'q element — 404', r.status);
  r = await call('GET', '/api/stock/ingredient?id=' + beef, null, DEV);
  ok(r.status === 401 || r.status === 403, 'faqat rahbar', r.status);
}

// ---------- Savdo analitikasi va diagnostika ----------
group('Savdo analitikasi (xodim, tur, to\'lov, bashorat) va diagnostika');
{
  const day = today(); const sumOf = (rows, k) => rows.reduce((a, x) => a + x[k], 0);
  const a = await call('GET', `/api/reports/analytics?from=${day}&to=${day}`, null, SES);
  ok(a.waiters.length > 0 && sumOf(a.waiters, 'sum') === a.cur.revenue && sumOf(a.waiters, 'orders') === a.cur.orders, 'xodimlar kesimi: yig\'indisi savdoga teng', [sumOf(a.waiters, 'sum'), a.cur.revenue]);
  ok(a.waiters.every((w, i) => !i || a.waiters[i - 1].sum >= w.sum) && a.waiters[0].name && a.waiters[0].avg === Math.round(a.waiters[0].sum / a.waiters[0].orders), 'xodimlar savdo bo\'yicha tartibda, o\'rtacha chek bilan');
  ok(sumOf(a.types, 'sum') === a.cur.revenue && sumOf(a.types, 'n') === a.cur.orders, 'buyurtma turlari yig\'indisi savdoga teng');
  ok(a.methods.length > 0 && Math.abs(sumOf(a.methods, 'share') - 100) < 0.5, 'to\'lov turlari ulushi 100%', a.methods);
  ok(a.extra && a.extra.items_per_check > 0 && a.extra.per_guest >= 0 && Array.isArray(a.halls) && Array.isArray(a.tables), 'qo\'shimcha ko\'rsatkichlar: chekdagi taom soni, zal va stollar', a.extra);
  ok(a.forecast && a.forecast.month === day.slice(0, 7) && a.forecast.so_far >= a.cur.revenue && a.forecast.days_left >= 0 && a.forecast.days_left <= 30, 'oy bashorati: shu oy savdosi va qolgan kunlar', a.forecast);
  ok(a.forecast.has_basis ? a.forecast.projected >= a.forecast.so_far : a.forecast.projected === null, 'bashorat hozirgi savdodan kam bo\'lmaydi (asos bo\'lmasa — bo\'sh)', a.forecast);

  let d = await call('GET', '/api/reports/diagnostics', null, SES);
  ok(d.ok && d.checks.length >= 8 && d.score >= 0 && d.score <= 100, 'diagnostika: tekshiruvlar va ball', [d.checks.length, d.score]);
  ok(d.counts.bad + d.counts.warn + d.counts.ok + d.counts.info === d.checks.length && d.score === Math.max(0, 100 - d.counts.bad * 12 - d.counts.warn * 5), 'ball = 100 − 12 × muammo − 5 × ogohlantirish', d.counts);
  ok(d.checks.every((x) => x.group && x.key && x.title && x.detail && ['bad', 'warn', 'ok', 'info'].includes(x.level)), 'har tekshiruvda guruh, daraja, sarlavha va izoh bor');
  ok(['trend', 'cancels', 'discounts', 'dish_cost', 'bot'].every((k) => d.checks.some((x) => x.key === k)), 'asosiy tekshiruvlar joyida', d.checks.map((x) => x.key));
  ok(!JSON.stringify(d.checks).match(/undefined|NaN|null so'm/), 'matnlarda undefined/NaN yo\'q');

  const z = (await call('POST', '/api/admin/product', { name: 'Zarar T', price: 1000, cost: 5000, category_id: cat }, SES)).id;
  const ni = await mk('Manfiy T', 'dona');
  await call('POST', '/api/stock/doc', { kind: 'utilizatsiya', reason: 'sinov', lines: [{ ingredient_id: ni, qty: 2 }] }, SES);
  const d2 = await call('GET', '/api/reports/diagnostics', null, SES);
  const loss = d2.checks.find((x) => x.key === 'loss'); const neg = d2.checks.find((x) => x.key === 'negative');
  ok(loss && loss.level === 'bad' && /Zarar T/.test(loss.detail) && loss.page === 'menu', 'zararga sotilayotgan taom topiladi', loss);
  ok(neg && neg.level === 'bad' && /Manfiy T/.test(neg.detail), 'manfiy qoldiqli element topiladi', neg);
  ok(d2.score <= d.score, 'muammo qo\'shilsa ball oshmaydi', [d.score, d2.score]);
  await call('POST', '/api/admin/remove', { kind: 'product', id: z }, SES);
  await call('POST', '/api/stock/doc', { kind: 'inventar', lines: [{ ingredient_id: ni, qty: 0 }] }, SES);
  const d3 = await call('GET', '/api/reports/diagnostics', null, SES);
  ok(!/Zarar T/.test(JSON.stringify(d3.checks)) && !/Manfiy T/.test(d3.checks.find((x) => x.key === 'negative')?.detail || ''), 'tuzatilgach ro\'yxatdan chiqadi');
  const inv = d3.checks.find((x) => x.key === 'inventory');
  ok(inv && inv.level === 'ok', 'inventarizatsiya qilingach — joyida', inv);
  const r = await call('GET', '/api/reports/diagnostics', null, DEV);
  ok(r.status === 401 || r.status === 403, 'faqat rahbar', r.status);
}

// ---------- Boshlang'ich qoldiq ----------
group('Boshlang\'ich qoldiq: bir oynada qoldiq va narxni to\'g\'rilash');
{
  const ingOf = async (iid) => (await call('GET', '/api/stock/ingredients', null, SES)).ingredients.find((x) => x.id === iid);
  const a1 = await mk('Bosh A', 'kg'); const a2 = await mk('Bosh B', 'dona'); const a3 = await mk('Bosh C', 'kg'); const a4 = await mk('Bosh D', 'dona');
  // A: manfiy qoldiq (kirimsiz chiqim), narxi yo'q; B: eski noto'g'ri narxda qoldiq bor
  await call('POST', '/api/stock/doc', { kind: 'utilizatsiya', reason: 'sinov', lines: [{ ingredient_id: a1, qty: 0.2 }] }, SES);
  await call('POST', '/api/stock/doc', { kind: 'kirim', lines: [{ ingredient_id: a2, qty: 10, price: 999 }, { ingredient_id: a3, qty: 4, price: 20000 }] }, SES);
  ok((await ingOf(a1)).stock === -0.2 && (await ingOf(a1)).cost === 0, 'boshida: A manfiy va narxsiz');
  let r = await call('POST', '/api/stock/opening', { lines: [] }, SES);
  ok(r.status === 400 && r.error === 'empty', 'bo\'sh ro\'yxat rad etiladi', r);
  r = await call('POST', '/api/stock/opening', { lines: [{ ingredient_id: a1, qty: -1 }] }, SES);
  ok(r.status === 400 && r.error === 'bad_qty', 'manfiy miqdor rad etiladi', r);
  r = await call('POST', '/api/stock/opening', { lines: [{ ingredient_id: a1, qty: 5, price: 0 }] }, SES);
  ok(r.status === 400 && r.error === 'bad_price', 'nol narx rad etiladi', r);
  r = await call('POST', '/api/stock/opening', { lines: [{ ingredient_id: a1, qty: 5, price: 80000 }, { ingredient_id: a2, qty: 30, price: 1500 }, { ingredient_id: a3, qty: 6 }, { ingredient_id: a4, price: 700 }, { ingredient_id: bun }] }, SES);
  ok(r.ok && r.changed === 4 && r.total === 5 * 80000 + 30 * 1500 && r.in_doc && r.inv_doc, 'saqlandi: 4 ta element (bo\'sh satr o\'tkazib yuborildi)', r);
  let x = await ingOf(a1); ok(x.stock === 5 && x.cost === 80000, 'A: manfiydan 5 kg ga, narxi aynan 80 000', x);
  x = await ingOf(a2); ok(x.stock === 30 && x.cost === 1500, 'B: 30 dona, eski noto\'g\'ri narx aralashmadi (1 500)', x);
  x = await ingOf(a3); ok(x.stock === 6 && x.cost === 20000, 'C: faqat miqdor — narx o\'zgarmadi', x);
  x = await ingOf(a4); ok(x.stock === 0 && x.cost === 700, 'D: faqat narx — qoldiq 0, narxi yozildi', x);
  const d = await call('GET', '/api/stock/doc?id=' + r.in_doc, null, SES);
  ok(d.doc.kind === 'kirim' && d.doc.total === r.total && d.doc.paid === r.total && d.moves.length === 2, 'kirim hujjati: qarz bo\'lib ko\'rinmaydi', d.doc);
  const m = await call('GET', `/api/reports/material?from=${today()}&to=${today()}`, null, SES);
  const row = m.rows.find((q) => q.id === a1);
  ok(row && Math.abs(row.open_q + row.in_q - row.used_q - row.waste_q + row.inv_q - row.close_q) < 1e-6 && row.close_q === 5 && row.close_v === 400000, 'moddiy hisobot balansda, oxirgi qiymat 400 000', row);
  r = await call('POST', '/api/stock/opening', { lines: [{ ingredient_id: a1, qty: 5, price: 80000 }] }, DEV);
  ok(r.status === 401 || r.status === 403, 'faqat rahbar', r.status);
  for (const i of [a1, a2, a3, a4]) await call('POST', '/api/stock/ingredient/remove', { id: i }, SES);
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
await endDb();
process.exit(failN ? 1 : 0);
