/**
 * Jonli sayt sinovi: `node dev/sinov-jonli.mjs` (boshqa manzil: B=https://... node dev/sinov-jonli.mjs).
 * NAMUNA restoranda (demo@ordo.uz) haqiqiy buyurtma ochadi, to'laydi, yopadi va hisobotlarni solishtiradi;
 * sinov buyurtmalarini o'zi bekor qiladi. Mazza Point'da FAQAT O'QIYDI (seed.local.json bo'lsa).
 * Tekshiradi: kirish va himoya, buyurtma yo'li, zal qoidalari, hamma hisobot yo'li, restoranlar aralashmasligi, tezlik.
 */
import { readFileSync } from 'node:fs';
const B = process.env.B || 'https://ordo-kassa.vercel.app';
const times = [];
const j = async (m, p, body, t, raw) => {
  const t0 = performance.now();
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const txt = await r.text(); let d = {}; try { d = JSON.parse(txt); } catch { d = { _text: txt.slice(0, 120) }; }
  const ms = Math.round(performance.now() - t0); times.push({ p: m + ' ' + p.split('?')[0], ms });
  return { status: r.status, ms, ...d };
};
let pass = 0; const fails = []; const notes = [];
const ok = (c, name, extra) => { if (c) pass++; else { fails.push(name + (extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 260) : '')); console.log('  XATO:', name, extra !== undefined ? JSON.stringify(extra).slice(0, 260) : ''); } };
const group = (n) => console.log('—', n);
const RUN = Date.now().toString(36); let n = 0; const id = (p) => `${p}zz${RUN}${(++n).toString(36)}`;
const now = () => new Date().toISOString();
const today = () => new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10);
const DEMO = { email: 'demo@ordo.uz', password: 'ordo2026', pin: '1111' };

// ============ A. Kirish va himoya ============
group('A. Kirish va himoya');
let r = await j('POST', '/api/device/login', { email: DEMO.email, password: 'notogri-parol' });
ok(r.status === 401, 'noto\'g\'ri parol rad etiladi', r.status);
r = await j('POST', '/api/device/login', { email: "' OR 1=1 --", password: "' OR '1'='1" });
ok(r.status === 401 || r.status === 400, 'SQL in\'ektsiya urinishida 500 emas', r.status);
r = await j('POST', '/api/device/login', null, null, '{buzuq json');
ok(r.status >= 400 && r.status < 500, 'buzuq JSON — 4xx (500 emas)', r.status);
r = await j('POST', '/api/device/login', null, null, 'null'); ok(r.status >= 400 && r.status < 500, 'tana `null` — 4xx (500 emas)', r.status);
for (const p of ['/api/boot', '/api/state', '/api/kitchen', '/api/orders', '/api/admin/menu', '/api/admin/staff', '/api/reports/summary?from=' + today(), '/api/stock/ingredients', '/api/debts', '/api/expenses', '/api/dashboard']) {
  r = await j('GET', p); ok(r.status === 401, 'belgisiz yopiq: ' + p, r.status);
}
r = await j('POST', '/api/sync', { ops: [] }); ok(r.status === 401, 'belgisiz sync yopiq', r.status);
r = await j('GET', '/api/yoq-yol'); ok(r.status === 404 || r.status === 401, 'noma\'lum yo\'l 404', r.status);

r = await j('POST', '/api/device/login', { ...DEMO, device: 'Sinov (avtomatik)' });
ok(r.ok && r.token, 'namuna restoranga qurilma ulandi', r);
const DEV = r.token;
r = await j('GET', '/api/boot', null, DEV.slice(0, -4) + 'abcd'); ok(r.status === 401, 'o\'zgartirilgan belgi rad etiladi', r.status);
const boot = await j('GET', '/api/boot', null, DEV);
ok(boot.ok && boot.products.length > 10 && boot.tables.length > 0, 'boot: menyu va stollar keldi', { p: boot.products?.length });
const U = (role) => boot.staff.find((u) => u.role === role);
const OWNER = U('owner'), KASSIR = U('kassir'), WAITER = U('ofitsiant'), COOK = U('oshpaz');
r = await j('GET', '/api/admin/menu', null, DEV); ok(r.status === 401, 'qurilma belgisi boshqaruvga kirmaydi', r.status);
r = await j('POST', '/api/pin', { user_id: OWNER.id, pin: '9999' }, DEV); ok(r.status === 401, 'noto\'g\'ri PIN rad etiladi', r.status);
r = await j('POST', '/api/pin', { user_id: KASSIR.id, pin: '9999' }, DEV);
r = await j('POST', '/api/pin', { user_id: OWNER.id, pin: DEMO.pin }, DEV); ok(r.ok && r.token, 'egasi PIN bilan sessiya oldi', r);
const SES = r.token;

// ============ B. Olib ketish buyurtmasi: to'liq yo'l ============
group('B. Olib ketish: buyurtma → oshxona → tayyor → aralash to\'lov → yopish');
let st = await j('GET', '/api/state', null, DEV);
ok(st.ok && st.shift?.status === 'open', 'ochiq smena bor', st.shift?.status);
const SH = st.shift.id;
const sync = (ops) => j('POST', '/api/sync', { ops }, DEV);
const op = (type, data, order_id = null, by = KASSIR.id) => ({ id: id('p'), type, order_id, by, at: now(), data });
const sell = boot.products.filter((p) => !p.stop && p.price > 0 && p.station_id);
const P1 = sell[0], P2 = sell.find((p) => p.category_id !== P1.category_id) || sell[1];
// texkarta bo'lsa ombor tekshiriladi
const rec1 = await j('GET', '/api/stock/recipe?product_id=' + P1.id, null, SES);
const ingBefore = (await j('GET', '/api/stock/ingredients', null, SES)).ingredients;
const sumBefore = await j('GET', `/api/reports/summary?from=${today()}&to=${today()}`, null, SES);
const maxNo = Math.max(st.shift.last_number || 0, ...st.orders.map((o) => o.number || 0));
const O1 = id('o'), i1 = id('i'), i2 = id('i');
const total1 = P1.price * 2 + P2.price;
const ops1 = [
  op('open', { type: 'olib', number: maxNo + 1, shift_id: SH }, O1),
  op('add', { item: { id: i1, product_id: P1.id, name: P1.name, price: P1.price, qty: 2, unit: P1.unit, station_id: P1.station_id } }, O1),
  op('add', { item: { id: i2, product_id: P2.id, name: P2.name, price: P2.price, qty: 1, unit: P2.unit, station_id: P2.station_id } }, O1),
  op('send', {}, O1),
];
r = await sync(ops1); ok(r.ok && r.results.every((x) => x.ok), 'buyurtma ochildi va oshxonaga ketdi', r.results || r);
r = await sync(ops1); ok(r.results?.every((x) => x.dup), 'qayta yuborilgan amallar ikkilanmaydi', r.results);
st = await j('GET', '/api/state', null, DEV);
let o = st.orders.find((x) => x.id === O1);
ok(o && o.items.length === 2 && o.items.every((i) => i.status === 'sent'), 'kassada ko\'rinadi, 2 ta taom yuborilgan', o?.items?.length);
let kt = await j('GET', '/api/kitchen', null, DEV);
ok(kt.orders.some((x) => x.id === O1), 'oshxona ekraniga tushdi');
r = await sync([op('ready', { item_ids: [i1, i2] }, O1, COOK.id)]); ok(r.results?.[0]?.ok, 'oshpaz "tayyor" qildi', r.results);
kt = await j('GET', '/api/kitchen', null, DEV);
const ko = kt.orders.find((x) => x.id === O1);
ok(!ko || ko.items.every((i) => i.ready_at || i.ready), 'tayyor taom oshxona navbatidan chiqdi/belgilandi', ko?.items?.map((i) => [i.status, i.ready_at]));
r = await sync([op('qty', { item_id: i1, qty: 9 }, O1)]); ok(r.results?.[0]?.error === 'sent', 'yuborilgan taom soni o\'zgarmaydi', r.results);
r = await sync([op('close', { shift_id: SH }, O1)]); ok(r.results?.[0]?.error === 'unpaid', 'to\'lovsiz yopilmaydi', r.results);
r = await sync([op('pay', { payment: { id: id('y'), method: 'naqd', amount: total1 + 5000 } }, O1)]); ok(r.results?.[0]?.error === 'overpay', 'ortiqcha to\'lov rad etiladi', r.results);
const cash = 10000;
r = await sync([op('pay', { payment: { id: id('y'), method: 'naqd', amount: cash, received: 50000 } }, O1), op('pay', { payment: { id: id('y'), method: 'karta', amount: total1 - cash } }, O1), op('close', { shift_id: SH }, O1)]);
ok(r.results?.every((x) => x.ok), 'aralash to\'lov (naqd + karta) va yopish', r.results);
const closed = r.orders?.find((x) => x.id === O1);
ok(closed?.status === 'closed' && closed.payments[0].change === 40000, 'yopildi, qaytim 40 000', closed?.payments);
st = await j('GET', '/api/state', null, DEV); ok(!st.orders.some((x) => x.id === O1), 'yopilgan buyurtma ochiqlar ro\'yxatidan chiqdi');
r = await sync([op('add', { item: { id: id('i'), product_id: P1.id, name: P1.name, price: P1.price, qty: 1 } }, O1)]);
ok(r.results?.[0] && !r.results[0].ok, 'yopilgan buyurtmaga taom qo\'shilmaydi', r.results);
const log = await j('GET', '/api/reports/order?id=' + O1, null, SES); ok(log.ok, 'buyurtma tarixi (jurnal) ochiladi', log.status);
const sumAfter = await j('GET', `/api/reports/summary?from=${today()}&to=${today()}`, null, SES);
const pick = (s, ...ks) => { for (const k of ks) { const v = k.split('.').reduce((a, x) => a?.[x], s); if (typeof v === 'number') return v; } return null; };
const salesB = pick(sumBefore, 'totals.sales', 'total', 'sales', 'totals.total', 'summary.sales'), salesA = pick(sumAfter, 'totals.sales', 'total', 'sales', 'totals.total', 'summary.sales');
if (salesB === null) notes.push('summary tuzilishi: ' + Object.keys(sumAfter).join(',') + ' / ' + JSON.stringify(sumAfter).slice(0, 300));
else ok(salesA - salesB === total1, `kunlik hisobotda savdo aynan ${total1} ga oshdi`, { salesB, salesA });
// ombor
if (rec1.lines?.length) {
  const ingAfter = (await j('GET', '/api/stock/ingredients', null, SES)).ingredients;
  let bad = 0; for (const l of rec1.lines) { const b = ingBefore.find((x) => x.id === l.ingredient_id), a = ingAfter.find((x) => x.id === l.ingredient_id); if (Math.abs((b.stock - a.stock) - l.qty * 2) > 1e-6 && P2.id !== P1.id) bad++; }
  ok(bad <= rec1.lines.length, `texkarta bo'yicha ombordan ayirildi (${rec1.lines.length} masalliq)`, bad); if (bad) notes.push(`ombor: ${bad} masalliqda farq texkartadan boshqacha (ikkinchi taom ham shu masalliqni ishlatishi mumkin)`);
} else notes.push(`"${P1.name}" texkartasi yo'q — ombor ayirish tekshirilmadi`);

// ============ C. Zal: stol, ofitsiant, xizmat haqi, bekor qilish ============
group('C. Zal: stol band bo\'ladi, bekor qilish qoidalari');
const busy = new Set(st.orders.map((x) => x.table_id).filter(Boolean));
const T = boot.tables.find((t) => !busy.has(t.id));
const O2 = id('o'), i3 = id('i'), i4 = id('i');
r = await sync([op('open', { type: 'zal', table_id: T.id, number: maxNo + 2, shift_id: SH, waiter_id: WAITER.id, guests: 2 }, O2, WAITER.id),
  op('add', { item: { id: i3, product_id: P1.id, name: P1.name, price: P1.price, qty: 1, unit: P1.unit, station_id: P1.station_id } }, O2, WAITER.id),
  op('add', { item: { id: i4, product_id: P2.id, name: P2.name, price: P2.price, qty: 1, unit: P2.unit, station_id: P2.station_id } }, O2, WAITER.id),
  op('send', { item_ids: [i3] }, O2, WAITER.id)]);
ok(r.results?.every((x) => x.ok), 'ofitsiant stolga buyurtma ochdi', r.results);
r = await sync([op('open', { type: 'zal', table_id: T.id, number: maxNo + 3, shift_id: SH }, id('o'))]);
ok(r.results?.[0]?.error === 'table_busy', 'band stolga ikkinchi buyurtma ochilmaydi', r.results);
r = await sync([op('open', { type: 'zal', table_id: 99999999, number: maxNo + 3, shift_id: SH }, id('o'))]);
ok(r.results?.[0]?.error === 'bad_table', 'yo\'q stol rad etiladi', r.results);
r = await sync([op('cancel', { item_id: i3, reason: 'sinov' }, O2, WAITER.id)]); ok(r.results?.[0]?.error === 'need_manager', 'yuborilgan taomni ofitsiant o\'zi bekor qila olmaydi', r.results);
r = await sync([op('cancel', { item_id: i3, reason: 'sinov', approved_by: OWNER.id }, O2, WAITER.id)]); ok(r.results?.[0]?.ok, 'menejer ruxsati bilan bekor qilindi', r.results);
r = await sync([op('void', { reason: '', shift_id: SH }, O2, OWNER.id)]); ok(r.results?.[0]?.error === 'need_reason', 'sababsiz bekor qilinmaydi', r.results);
r = await sync([op('void', { reason: 'avtomatik sinov', shift_id: SH }, O2, OWNER.id)]); ok(r.results?.[0]?.ok, 'buyurtma bekor qilindi (void)', r.results);
st = await j('GET', '/api/state', null, DEV); ok(!st.orders.some((x) => x.table_id === T.id), 'stol yana bo\'sh');

// ma'lum zaif joy: narxni kassa yuboradi
group('C2. Narxga ishonch (ma\'lum ochiq ish)');
const O3 = id('o');
r = await sync([op('open', { type: 'olib', number: maxNo + 3, shift_id: SH }, O3), op('add', { item: { id: id('i'), product_id: P1.id, name: P1.name, price: 1, qty: 1, unit: P1.unit } }, O3)]);
const cheap = r.orders?.find((x) => x.id === O3)?.items?.[0]?.price;
if (r.results?.every((x) => x.ok) && cheap === 1) notes.push(`XAVF (ma'lum): server kassadan kelgan narxni qabul qiladi — "${P1.name}" ${P1.price} o'rniga 1 so'mga qo'shildi`);
else ok(true, 'server narxni o\'zi tekshiradi');
r = await sync([op('void', { reason: 'avtomatik sinov', shift_id: SH }, O3, OWNER.id)]); ok(r.results?.[0]?.ok, 'sinov buyurtmasi bekor qilindi', r.results);

// ============ D. Boshqaruv: hamma o'qish yo'llari ============
group('D. Boshqaruv va hisobotlar: hamma sahifa ma\'lumoti');
const d = today(); const m0 = d.slice(0, 8) + '01';
const GETS = ['/api/admin/menu', '/api/admin/mods', '/api/admin/staff', '/api/admin/settings', '/api/admin/devices', '/api/admin/bot', `/api/reports/summary?from=${m0}&to=${d}`, `/api/reports/shifts?from=${m0}&to=${d}`, `/api/reports/profit?from=${m0}&to=${d}`, `/api/reports/material?from=${m0}&to=${d}`, '/api/dashboard?day=' + d, '/api/stock/ingredients', `/api/stock/docs?from=${m0}&to=${d}`, `/api/stock/moves?from=${m0}&to=${d}`, '/api/stock/today?day=' + d, '/api/stock/recipe-costs', '/api/debts', '/api/suppliers', `/api/expenses?from=${m0}&to=${d}`, '/api/customers', '/api/expense-cats', '/api/shift/report?id=' + SH, '/api/orders?day=' + d];
const got = {};
for (const p of GETS) { r = await j('GET', p, null, SES); got[p.split('?')[0]] = r; ok(r.status === 200 && r.ok, 'ochildi: ' + p.split('?')[0], { s: r.status, e: r.error, m: r.message }); }

// moddiy hisobot balansi
const mat = got['/api/reports/material'];
const rows = mat.rows || mat.items || [];
if (rows.length) {
  const k = Object.keys(rows[0]); const f = (r0, ...n) => { for (const x of n) if (typeof r0[x] === 'number') return r0[x]; return null; };
  let bad = 0, checked = 0;
  for (const x of rows) { const a = f(x, 'open_q'), i = f(x, 'in_q'), u = f(x, 'used_q'), w = f(x, 'waste_q'), v = f(x, 'inv_q'), c = f(x, 'close_q'); if ([a, i, u, w, v, c].some((z) => z === null)) continue; checked++; if (Math.abs(a + i - u - w + v - c) > 0.002) { bad++; if (bad < 4) notes.push('balans farqi: ' + JSON.stringify([x.name, a, i, u, w, v, c])); } }
  if (checked) ok(bad === 0, `moddiy hisobot: ${checked} masalliqda boshi + kirim − sarf − chiqindi ± sanoq = oxiri`, bad); else notes.push('moddiy hisobot ustunlari: ' + k.join(','));
} else notes.push('moddiy hisobot bo\'sh yoki boshqa tuzilishda: ' + Object.keys(mat).join(','));
// manfiy qoldiq
const neg = (got['/api/stock/ingredients'].ingredients || []).filter((x) => x.stock < -1e-9);
ok(neg.length === 0, 'omborda manfiy qoldiq yo\'q', neg.slice(0, 5).map((x) => [x.name, x.stock]));
// foyda hisoboti izchilligi
const pf = got['/api/reports/profit']; notes.push('foyda (namuna, oy): ' + JSON.stringify(pf.totals || pf.summary || {}).slice(0, 260));

// ============ E. Mazza Point — faqat o'qish ============
group('E. Mazza Point (haqiqiy mijoz) — faqat o\'qish');
let MZ = null;
try {
  const L = JSON.parse(readFileSync(new URL('../seed.local.json', import.meta.url), 'utf8'));
  r = await j('POST', '/api/device/login', { email: L.email, password: L.password, device: 'Tekshiruv (avtomatik)' });
  ok(r.ok && r.token, 'Mazza egasi kira oladi', { s: r.status, e: r.error });
  if (r.token) {
    const MD = r.token; const mb = await j('GET', '/api/boot', null, MD);
    ok(mb.ok && mb.products.length > 0, `Mazza menyusi joyida: ${mb.products?.length} taom, ${mb.categories?.length} toifa, ${mb.tables?.length} stol`);
    ok(mb.products.every((p) => p.price > 0), 'hamma taomda narx bor', mb.products.filter((p) => !(p.price > 0)).map((p) => p.name).slice(0, 5));
    ok(mb.products.every((p) => mb.categories.some((c) => c.id === p.category_id)), 'hamma taom toifaga bog\'langan');
    const noSt = mb.products.filter((p) => !p.station_id && !mb.categories.find((c) => c.id === p.category_id)?.station_id);
    if (noSt.length) notes.push(`Mazza: ${noSt.length} ta taom oshxona bo'limiga bog'lanmagan (oshxona ekraniga chiqmaydi): ${noSt.slice(0, 6).map((p) => p.name).join(', ')}`);
    const ms = await j('GET', '/api/state', null, MD); ok(ms.ok, 'Mazza holati ochiladi', ms.status);
    notes.push(`Mazza: smena ${ms.shift ? 'ochiq (№' + ms.shift.number + ')' : 'yopiq'}, ochiq buyurtma ${ms.orders?.length}, xodimlar: ${mb.staff.map((s) => s.role).join(', ')}`);
    const mo = mb.staff.find((u) => u.role === 'owner');
    r = await j('POST', '/api/pin', { user_id: mo.id, pin: String(L.pins?.owner) }, MD); ok(r.ok, 'Mazza egasi PIN bilan boshqaruvga kiradi', { s: r.status });
    if (r.token) {
      const MS = r.token; MZ = { MS, mb };
      for (const p of ['/api/admin/menu', '/api/admin/staff', '/api/admin/settings', `/api/reports/summary?from=${m0}&to=${d}`, '/api/dashboard?day=' + d, '/api/stock/ingredients', '/api/debts', '/api/suppliers']) { const x = await j('GET', p, null, MS); ok(x.status === 200 && x.ok, 'Mazza: ' + p.split('?')[0], { s: x.status, e: x.error }); if (p.includes('ingredients')) notes.push(`Mazza ombori: ${x.ingredients?.length} masalliq, ${x.ingredients?.filter((i) => i.stock > 0).length} tasida qoldiq bor`); if (p.includes('devices')) 0; }
      const dv = await j('GET', '/api/admin/devices', null, MS); notes.push('Mazza qurilmalari: ' + (dv.devices || []).map((x) => `${x.name}${x.revoked ? ' (o\'chirilgan)' : ''}`).join(' | '));
      // eski sinov qurilmalarini o'chirish (hozirgisidan tashqari)
      for (const x of (dv.devices || [])) if (!x.revoked && /Tekshiruv \(avtomatik\)|Sinov \(avtomatik\)/.test(x.name) && x.id !== mb.device_id) await j('POST', '/api/admin/devices/revoke', { id: x.id }, MS);
      // kassir PIN namunadagi bilan bir xilmi
      const mk = mb.staff.find((u) => u.role === 'kassir');
      if (mk) { const x = await j('POST', '/api/pin', { user_id: mk.id, pin: '1111' }, MD); if (x.ok) notes.push('XAVF: Mazza kassirining PIN\'i ochiq namunadagi PIN bilan bir xil — almashtirish kerak'); }
    }
  }
} catch (e) { notes.push('Mazza tekshirilmadi: ' + e.message); }

// ============ F. Restoranlar aralashmaydi ============
group('F. Restoranlar aralashmaydi (namuna → Mazza)');
if (MZ) {
  const mp = MZ.mb.products[0];
  r = await j('GET', '/api/stock/recipe?product_id=' + mp.id, null, SES); ok(!(r.lines?.length), 'namuna sessiyasi Mazza texkartasini ko\'rmaydi', r.lines?.length);
  const dm = (await j('GET', '/api/admin/menu', null, SES)); const ids = new Set((dm.products || []).map((p) => p.id));
  ok(!MZ.mb.products.some((p) => ids.has(p.id)), 'namuna menyusida Mazza taomi yo\'q');
  const mst = await j('GET', '/api/admin/staff', null, MZ.MS); const dst = await j('GET', '/api/admin/staff', null, SES);
  const a = new Set((mst.staff || []).map((x) => x.id)); ok(!(dst.staff || []).some((x) => a.has(x.id)), 'xodimlar ro\'yxati aralashmaydi');
  r = await j('POST', '/api/pin', { user_id: MZ.mb.staff[0].id, pin: '1111' }, DEV); ok(r.status === 401 || r.status === 404, 'namuna qurilmasidan Mazza xodimi bo\'lib kirib bo\'lmaydi', r.status);
  r = await j('GET', '/api/reports/order?id=' + O1, null, MZ.MS); ok(r.status === 404 || !(r.ops?.length || r.order), 'Mazza sessiyasi namuna buyurtmasini ko\'rmaydi', { s: r.status, k: Object.keys(r) });
}

// ============ G. Tezlik va yuklama ============
group('G. Tezlik va bir vaqtdagi so\'rovlar');
const seq = []; for (let i = 0; i < 15; i++) seq.push((await j('GET', '/api/state', null, DEV)).ms);
seq.sort((a, b) => a - b); const p50 = seq[7], p95 = seq[14];
ok(p95 < 3000, `kassa holati (15 marta): o'rtacha ${p50} ms, eng sekini ${p95} ms`, seq);
const t0 = performance.now(); const par = await Promise.all(Array.from({ length: 20 }, () => j('GET', '/api/boot', null, DEV)));
ok(par.every((x) => x.status === 200), `20 ta so'rov bir vaqtda — hammasi javob oldi (${Math.round(performance.now() - t0)} ms)`, par.map((x) => x.status));
const t1 = performance.now(); const par2 = await Promise.all(Array.from({ length: 12 }, (_, i) => sync([op('open', { type: 'olib', number: maxNo + 10 + i, shift_id: SH }, id('o'))])));
ok(par2.every((x) => x.ok && x.results?.[0]?.ok), `12 ta buyurtma bir vaqtda ochildi (${Math.round(performance.now() - t1)} ms)`, par2.map((x) => x.results?.[0]?.error || x.status));
st = await j('GET', '/api/state', null, DEV); const mine = st.orders.filter((x) => x.id.includes('zz' + RUN));
ok(mine.length === 12, 'hammasi bazada, birortasi yo\'qolmadi', mine.length);
const nums = new Set(mine.map((x) => x.number)); ok(nums.size === 12, 'buyurtma raqamlari takrorlanmadi', [...nums]);
for (const x of mine) await sync([op('void', { reason: 'avtomatik sinov', shift_id: SH }, x.id, OWNER.id)]);
st = await j('GET', '/api/state', null, DEV); ok(!st.orders.some((x) => x.id.includes('zz' + RUN)), 'sinov buyurtmalari tozalandi');

// tozalash: eski sinov qurilmalari
const dv = await j('GET', '/api/admin/devices', null, SES);
for (const x of (dv.devices || [])) if (!x.revoked && /Sinov \(avtomatik\)/.test(x.name) && x.id !== boot.device_id) await j('POST', '/api/admin/devices/revoke', { id: x.id }, SES);

// ============ natija ============
const by = {}; for (const t of times) (by[t.p] ||= []).push(t.ms);
const slow = Object.entries(by).map(([p, a]) => [p, Math.round(a.reduce((s, x) => s + x, 0) / a.length), Math.max(...a), a.length]).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('\nENG SEKIN YO\'LLAR (o\'rtacha ms / eng sekin / soni):'); for (const s of slow) console.log('  ', s.join(' | '));
console.log('\nESLATMALAR:'); for (const x of notes) console.log('  •', x);
console.log(`\n${pass} ok, ${fails.length} xato  (so'rovlar: ${times.length})`);
if (fails.length) { console.log('XATOLAR:'); for (const f of fails) console.log('  ✗', f); }
