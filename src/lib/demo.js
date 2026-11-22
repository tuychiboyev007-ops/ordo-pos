/**
 * Namunaviy restoran: menyu va texnologik kartalar, masalliqlar, yetkazib beruvchilar,
 * zal va stollar, xodimlar, 14 kunlik savdo tarixi (kunlik kirim, sotuvdan avtomatik
 * ayirish, rasxod, nasiya), bugungi ochiq smena va band stollar.
 * Buyurtmalar yadro (core.applyOp) va server qoidasi (finalizeOrder) orqali yasaladi —
 * demo raqamlari haqiqiy ish bilan aynan bir xil yo'ldan o'tadi.
 */
import { applyOp, shiftSummary, localDay, totals } from '../../public/js/core.js';
import { hashPassword, makePin } from './auth.js';
import { saveOrder, finalizeOrder, shiftMoves } from '../routes/sync.js';
import { moveStock } from './stock.js';

const STATIONS = ['Oshxona', 'Mangal', 'Bar'];
const HALLS = [['Asosiy zal', 12, 10], ['Terrasa', 8, 10], ['VIP xonalar', 4, 15]];

// [nomi, birlik, narx (1 birlik), guruh, eng kam qoldiq]
const INGS = [
  ['Qo\'y go\'shti', 'kg', 120000, 'Go\'sht', 10], ['Mol go\'shti', 'kg', 105000, 'Go\'sht', 10], ['Tovuq go\'shti', 'kg', 42000, 'Go\'sht', 5],
  ['Jigar', 'kg', 60000, 'Go\'sht', 2], ['Dumba', 'kg', 55000, 'Go\'sht', 2],
  ['Guruch (devzira)', 'kg', 28000, 'Quruq mahsulot', 10], ['Un', 'kg', 7000, 'Quruq mahsulot', 10], ['Shakar', 'kg', 12000, 'Quruq mahsulot', 3],
  ['Ziravorlar', 'kg', 60000, 'Quruq mahsulot', 0.5], ['Ko\'k choy', 'kg', 90000, 'Quruq mahsulot', 0.5], ['Qora choy', 'kg', 95000, 'Quruq mahsulot', 0.5],
  ['Qahva doni', 'kg', 260000, 'Quruq mahsulot', 0.5],
  ['Sabzi', 'kg', 6000, 'Sabzavot', 10], ['Piyoz', 'kg', 5000, 'Sabzavot', 10], ['Pomidor', 'kg', 14000, 'Sabzavot', 5], ['Bodring', 'kg', 12000, 'Sabzavot', 3],
  ['Kartoshka', 'kg', 5000, 'Sabzavot', 10], ['Ko\'katlar', 'kg', 20000, 'Sabzavot', 0.5], ['Limon', 'kg', 25000, 'Sabzavot', 1], ['Meva (kompot)', 'kg', 15000, 'Sabzavot', 3],
  ['Paxta yog\'i', 'l', 22000, 'Sut va yog\'', 5], ['Qatiq', 'l', 14000, 'Sut va yog\'', 3], ['Sut', 'l', 12000, 'Sut va yog\'', 3], ['Suzma', 'kg', 30000, 'Sut va yog\'', 2],
  ['Pishloq', 'kg', 80000, 'Sut va yog\'', 1], ['Tuxum', 'dona', 1300, 'Sut va yog\'', 30],
  ['Mayonez', 'kg', 32000, 'Souslar', 1], ['Ketchup', 'kg', 28000, 'Souslar', 1],
  ['Burger bulochkasi', 'dona', 2500, 'Non', 20], ['Lavash noni', 'dona', 2000, 'Non', 20], ['Patir non', 'dona', 5000, 'Non', 10], ['Obi non', 'dona', 3000, 'Non', 10],
  ['Coca-Cola 0,5 l', 'dona', 6500, 'Ichimlik', 24], ['Fanta 0,5 l', 'dona', 6500, 'Ichimlik', 24], ['Suv 0,5 l', 'dona', 2500, 'Ichimlik', 24],
  ['Napoleon (porsiya)', 'dona', 11000, 'Shirinlik', 5], ['Medovik (porsiya)', 'dona', 11000, 'Shirinlik', 5], ['Chak-chak', 'kg', 70000, 'Shirinlik', 1], ['Muzqaymoq', 'kg', 45000, 'Shirinlik', 1],
];
// Ingredientlar bo'yicha qaysi yetkazib beruvchidan keladi
const SUPPLIERS = [['Go\'sht bozori — Anvar aka', '+998 90 111 22 33', ['Go\'sht']], ['Sabzavot savdo', '+998 91 222 33 44', ['Sabzavot', 'Sut va yog\'', 'Non']],
  ['Ulgurji oziq-ovqat', '+998 93 333 44 55', ['Quruq mahsulot', 'Souslar', 'Shirinlik']], ['Ichimliklar distribyutori', '+998 94 444 55 66', ['Ichimlik']]];

const MENU = [
  ['Kaboblar', '#b83a2e', 'Mangal', [
    ['Qo\'y go\'shtli kabob', 28000, 'dona', null, [['Qo\'y go\'shti', 0.17], ['Dumba', 0.03], ['Piyoz', 0.05], ['Ziravorlar', 0.003]]],
    ['Mol go\'shtli kabob', 25000, 'dona', null, [['Mol go\'shti', 0.17], ['Piyoz', 0.05], ['Ziravorlar', 0.003]]],
    ['Jaz kabob', 30000, 'dona', null, [['Qo\'y go\'shti', 0.2], ['Piyoz', 0.05], ['Ziravorlar', 0.003]]],
    ['Lula kabob', 24000, 'dona', null, [['Qo\'y go\'shti', 0.12], ['Mol go\'shti', 0.06], ['Dumba', 0.03], ['Piyoz', 0.04], ['Ziravorlar', 0.004]]],
    ['Tovuq kabob', 20000, 'dona', null, [['Tovuq go\'shti', 0.2], ['Piyoz', 0.04], ['Qatiq', 0.03], ['Ziravorlar', 0.003]]],
    ['Jigar kabob', 18000, 'dona', null, [['Jigar', 0.18], ['Dumba', 0.03], ['Piyoz', 0.04]]],
    ['Qiyma kabob', 22000, 'dona', null, [['Mol go\'shti', 0.18], ['Piyoz', 0.05], ['Ziravorlar', 0.003]]],
    ['Kabob assorti (kg)', 260000, 'kg', null, [['Qo\'y go\'shti', 0.5], ['Mol go\'shti', 0.3], ['Tovuq go\'shti', 0.25], ['Piyoz', 0.2], ['Ziravorlar', 0.01]]]]],
  ['Milliy taomlar', '#c97a16', 'Oshxona', [
    ['To\'y oshi', 45000, 'dona', null, [['Guruch (devzira)', 0.15], ['Mol go\'shti', 0.08], ['Sabzi', 0.15], ['Piyoz', 0.03], ['Paxta yog\'i', 0.04], ['Ziravorlar', 0.003]]],
    ['Lag\'mon', 38000, 'dona', null, [['Un', 0.15], ['Mol go\'shti', 0.08], ['Pomidor', 0.05], ['Sabzi', 0.03], ['Piyoz', 0.03], ['Paxta yog\'i', 0.02]]],
    ['Manti (5 dona)', 35000, 'dona', null, [['Un', 0.12], ['Qo\'y go\'shti', 0.15], ['Dumba', 0.03], ['Piyoz', 0.1]]],
    ['Dimlama', 42000, 'dona', null, [['Mol go\'shti', 0.15], ['Kartoshka', 0.15], ['Sabzi', 0.08], ['Piyoz', 0.05], ['Pomidor', 0.06]]],
    ['Qozon kabob', 65000, 'dona', null, [['Qo\'y go\'shti', 0.3], ['Kartoshka', 0.25], ['Paxta yog\'i', 0.04], ['Piyoz', 0.05]]],
    ['Norin', 40000, 'dona', null, [['Un', 0.1], ['Mol go\'shti', 0.12], ['Piyoz', 0.03]]],
    ['Chuchvara', 30000, 'dona', null, [['Un', 0.1], ['Mol go\'shti', 0.1], ['Piyoz', 0.03]]],
    ['Qovurma lag\'mon', 42000, 'dona', null, [['Un', 0.15], ['Mol go\'shti', 0.1], ['Pomidor', 0.05], ['Paxta yog\'i', 0.03]]]]],
  ['Fast-fud', '#d0562b', 'Oshxona', [
    ['Burger', 32000, 'dona', null, [['Burger bulochkasi', 1], ['Mol go\'shti', 0.17], ['Pomidor', 0.06], ['Bodring', 0.03], ['Ketchup', 0.01], ['Mayonez', 0.01]]],
    ['Chizburger', 36000, 'dona', null, [['Burger bulochkasi', 1], ['Mol go\'shti', 0.17], ['Pishloq', 0.03], ['Pomidor', 0.06], ['Bodring', 0.03], ['Ketchup', 0.01], ['Mayonez', 0.01]]],
    ['Lavash', 30000, 'dona', null, [['Lavash noni', 1], ['Tovuq go\'shti', 0.15], ['Pomidor', 0.05], ['Bodring', 0.04], ['Mayonez', 0.015], ['Ketchup', 0.01]]],
    ['Fri kartoshka', 15000, 'dona', null, [['Kartoshka', 0.2], ['Paxta yog\'i', 0.03]]]]],
  ['Sho\'rvalar', '#9c6a1f', 'Oshxona', [
    ['Sho\'rva', 32000, 'dona', null, [['Qo\'y go\'shti', 0.15], ['Kartoshka', 0.12], ['Sabzi', 0.05], ['Piyoz', 0.03], ['Pomidor', 0.03]]],
    ['Mastava', 30000, 'dona', null, [['Guruch (devzira)', 0.05], ['Mol go\'shti', 0.08], ['Kartoshka', 0.08], ['Sabzi', 0.04], ['Pomidor', 0.03], ['Qatiq', 0.03]]],
    ['Moshxo\'rda', 28000, 'dona', null, [['Guruch (devzira)', 0.05], ['Mol go\'shti', 0.06], ['Kartoshka', 0.05], ['Qatiq', 0.03]]]]],
  ['Salatlar', '#2f8f4e', 'Oshxona', [
    ['Achchiq-chuchuk', 15000, 'dona', null, [['Pomidor', 0.15], ['Piyoz', 0.05], ['Ko\'katlar', 0.005]]],
    ['Olivye', 22000, 'dona', null, [['Kartoshka', 0.08], ['Tuxum', 1], ['Mayonez', 0.04], ['Bodring', 0.04], ['Mol go\'shti', 0.04]]],
    ['Sezar', 32000, 'dona', null, [['Tovuq go\'shti', 0.1], ['Pomidor', 0.05], ['Mayonez', 0.03], ['Tuxum', 1], ['Pishloq', 0.02]]],
    ['Grek salati', 30000, 'dona', null, [['Pomidor', 0.1], ['Bodring', 0.1], ['Pishloq', 0.04], ['Paxta yog\'i', 0.01]]],
    ['Suzma', 12000, 'dona', null, [['Suzma', 0.15], ['Ko\'katlar', 0.005]]]]],
  ['Somsa va non', '#8a5a3b', 'Oshxona', [
    ['Tandir somsa', 12000, 'dona', null, [['Un', 0.07], ['Qo\'y go\'shti', 0.07], ['Dumba', 0.02], ['Piyoz', 0.05]]],
    ['Go\'shtli somsa', 10000, 'dona', null, [['Un', 0.06], ['Mol go\'shti', 0.05], ['Piyoz', 0.04]]],
    ['Patir non', 8000, 'dona', null, [['Patir non', 1]]], ['Obi non', 5000, 'dona', null, [['Obi non', 1]]]]],
  ['Ichimliklar', '#2b6cb0', 'Bar', [
    ['Coca-Cola 0,5 l', 9000, 'dona', '5449000000996', [['Coca-Cola 0,5 l', 1]]], ['Fanta 0,5 l', 9000, 'dona', '5449000011527', [['Fanta 0,5 l', 1]]],
    ['Suv 0,5 l', 4000, 'dona', '4780000000017', [['Suv 0,5 l', 1]]], ['Kompot (1 l)', 18000, 'dona', null, [['Meva (kompot)', 0.2], ['Shakar', 0.05]]],
    ['Ayron', 8000, 'dona', null, [['Qatiq', 0.25]]], ['Limonad (1 l)', 25000, 'dona', null, [['Limon', 0.15], ['Shakar', 0.08]]]]],
  ['Choy va qahva', '#6b3fa0', 'Bar', [
    ['Ko\'k choy', 6000, 'dona', null, [['Ko\'k choy', 0.008]]], ['Qora choy', 6000, 'dona', null, [['Qora choy', 0.008]]],
    ['Limonli choy', 10000, 'dona', null, [['Qora choy', 0.006], ['Limon', 0.03], ['Shakar', 0.01]]],
    ['Amerikano', 18000, 'dona', null, [['Qahva doni', 0.018]]], ['Kapuchino', 24000, 'dona', null, [['Qahva doni', 0.018], ['Sut', 0.15]]]]],
  ['Shirinliklar', '#c2416b', 'Bar', [
    ['Napoleon', 22000, 'dona', null, [['Napoleon (porsiya)', 1]]], ['Medovik', 22000, 'dona', null, [['Medovik (porsiya)', 1]]],
    ['Chak-chak', 15000, 'dona', null, [['Chak-chak', 0.12]]], ['Muzqaymoq', 15000, 'dona', null, [['Muzqaymoq', 0.15]]]]],
];
const STAFF = [
  ['Aziz Rahimov', 'owner', '1111', '#14213d'], ['Dilshod Karimov', 'admin', '2222', '#3b5b92'],
  ['Madina Yusupova', 'kassir', '3333', '#e4572e'], ['Javohir Aliyev', 'ofitsiant', '4444', '#2f8f4e'],
  ['Sardor Toshev', 'ofitsiant', '5555', '#c97a16'], ['Kamola Ergasheva', 'ofitsiant', '6666', '#6b3fa0'],
  ['Bahodir Usmonov', 'oshpaz', '7777', '#8a5a3b'],
];
const EXP = [['Kommunal', 'Svet, gaz', 0.35], ['Xo\'jalik mollari', 'Salfetka, idish yuvish vositasi', 0.5], ['Transport', 'Bozorga borish', 0.6], ['Boshqa', 'Mayda xarajat', 0.3]];

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

export const DEMO_LOGIN = { email: 'demo@ordo.uz', password: 'ordo2026' };

export async function seedDemo(db) {
  const co = await db.first('INSERT INTO companies (name) VALUES (?) RETURNING id', 'Milliy taomlar — namuna');
  const c = co.id;
  const set = { name: 'Milliy taomlar', address: 'Namuna ko\'chasi, 1', phone: '+998 90 000 00 00', paper: '80', service_pct: '10',
    receipt_footer: 'Yoqimli ishtaha! Yana kutib qolamiz.', receipt_header: 'Milliy taomlar restorani' };
  for (const [k, v] of Object.entries(set)) await db.run('INSERT INTO settings (company_id, key, value) VALUES (?, ?, ?)', c, k, v);

  const station = {};
  for (const [i, s] of STATIONS.entries()) station[s] = (await db.first('INSERT INTO stations (company_id, name, sort) VALUES (?, ?, ?) RETURNING id', c, s, i)).id;
  const tables = [];
  for (const [hi, [name, count, pct]] of HALLS.entries()) {
    const h = (await db.first('INSERT INTO halls (company_id, name, sort, service_pct) VALUES (?, ?, ?, ?) RETURNING id', c, name, hi, pct)).id;
    for (let i = 1; i <= count; i++) {
      const label = hi === 2 ? `VIP ${i}` : hi === 1 ? `T${i}` : String(i);
      tables.push({ id: (await db.first('INSERT INTO tables (company_id, hall_id, name, seats, sort) VALUES (?, ?, ?, ?, ?) RETURNING id', c, h, label, hi === 2 ? 10 : (i % 3 ? 4 : 6), i)).id, hall: h, pct });
    }
  }
  const ing = {};
  for (const [name, unit, price, grp, min] of INGS) {
    ing[name] = { id: (await db.first('INSERT INTO ingredients (company_id, name, unit, min_stock, grp) VALUES (?, ?, ?, ?, ?) RETURNING id', c, name, unit, min, grp)).id, price, grp, unit };
  }
  const sup = {};
  for (const [name, phone, grps] of SUPPLIERS) {
    const id = (await db.first('INSERT INTO suppliers (company_id, name, phone) VALUES (?, ?, ?) RETURNING id', c, name, phone)).id;
    for (const g of grps) sup[g] = id;
  }
  const products = [];
  for (const [ci, [cat, color, st, items]] of MENU.entries()) {
    const cid = (await db.first('INSERT INTO categories (company_id, name, color, station_id, sort) VALUES (?, ?, ?, ?, ?) RETURNING id', c, cat, color, station[st], ci)).id;
    for (const [pi, [name, price, unit, barcode, recipe]] of items.entries()) {
      const p = await db.first(`INSERT INTO products (company_id, category_id, name, price, unit, station_id, barcode, sort)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, c, cid, name, price, unit, station[st], barcode, pi);
      for (const [iname, q] of recipe) await db.run('INSERT INTO recipes (company_id, product_id, ingredient_id, qty) VALUES (?, ?, ?, ?)', c, p.id, ing[iname].id, q);
      products.push({ id: p.id, name, price, unit, station_id: station[st], cat });
    }
  }
  const users = new Map(); const staff = {};
  for (const [name, role, pin, color] of STAFF) {
    const p = await makePin(pin);
    const pw = role === 'owner' ? await hashPassword(DEMO_LOGIN.password) : null;
    const u = await db.first(`INSERT INTO users (company_id, name, role, email, password_hash, pin_salt, pin_hash, color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, c, name, role, role === 'owner' ? DEMO_LOGIN.email : null, pw, p.pin_salt, p.pin_hash, color);
    users.set(u.id, { id: u.id, role, active: true });
    (staff[role] ||= []).push(u.id);
  }
  const customers = [['cdemo00001', 'Akmal (ofis)', '+998 90 123 45 67'], ['cdemo00002', 'Nodira opa', '+998 91 765 43 21'], ['cdemo00003', 'Rustam aka', '+998 93 555 66 77']];
  for (const [id, name, phone] of customers) await db.run('INSERT INTO customers (company_id, id, name, phone) VALUES (?, ?, ?, ?)', c, id, name, phone);

  const ctx = { users };
  const R = rng(20261122);
  const pick = (a) => a[Math.floor(R() * a.length)];
  let seq = 0;
  const uid = (p) => `${p}${(++seq).toString(36).padStart(6, '0')}`;
  const weights = (p) => (['Kaboblar', 'Milliy taomlar'].includes(p.cat) ? 4 : ['Ichimliklar', 'Choy va qahva'].includes(p.cat) ? 5 : p.cat === 'Fast-fud' ? 3 : 2);
  const pool = products.flatMap((p) => Array(weights(p)).fill(p));
  const cashier = staff.kassir[0]; const manager = staff.admin[0]; const owner = staff.owner[0];
  const iso = (ms) => new Date(ms).toISOString();

  function makeOrder(shift, openAt, closeAt, { open = false, number }) {
    const type = R() < 0.72 ? 'zal' : R() < 0.75 ? 'olib' : 'yetkazish';
    const t = type === 'zal' ? pick(tables) : null;
    const waiter = type === 'zal' ? pick(staff.ofitsiant) : cashier;
    const id = uid('o');
    let o = applyOp(null, { id: uid('p'), type: 'open', order_id: id, by: waiter, at: iso(openAt),
      data: { type, table_id: t?.id, guests: type === 'zal' ? 1 + Math.floor(R() * 5) : 0, waiter_id: waiter, service_pct: t?.pct || 0, number, shift_id: shift,
        customer: type === 'yetkazish' ? { name: pick(['Akmal', 'Nodira', 'Rustam', 'Gulnoza']), phone: '+998 9' + Math.floor(R() * 1e8).toString().padStart(8, '0'), address: 'Namuna mavze, ' + (1 + Math.floor(R() * 40)) + '-uy' } : null } }, ctx);
    const lines = 1 + Math.floor(R() * 5);
    for (let i = 0; i < lines; i++) {
      const p = pick(pool);
      const qty = p.unit === 'kg' ? Math.round((0.5 + R()) * 10) / 10 : 1 + Math.floor(R() * (['Ichimliklar', 'Somsa va non', 'Choy va qahva'].includes(p.cat) ? 4 : 2));
      o = applyOp(o, { id: uid('p'), type: 'add', order_id: id, by: waiter, at: iso(openAt + i * 30e3), data: { item: { id: uid('i'), product_id: p.id, name: p.name, price: p.price, qty, unit: p.unit, station_id: p.station_id } } }, ctx);
    }
    if (R() < 0.15) o = applyOp(o, { id: uid('p'), type: 'comment', order_id: id, by: waiter, at: iso(openAt + 60e3), data: { item_id: o.items[0].id, comment: pick(['Piyozsiz', 'Achchiqroq', 'Tezroq', 'Kam tuzli']) } }, ctx);
    o = applyOp(o, { id: uid('p'), type: 'send', order_id: id, by: waiter, at: iso(openAt + 4 * 60e3), data: {} }, ctx);
    if (!open && R() < 0.05) {
      const it = o.items[0];
      o = applyOp(o, { id: uid('p'), type: 'cancel', order_id: id, by: waiter, at: iso(openAt + 9 * 60e3), data: { item_id: it.id, reason: pick(['Mijoz voz kechdi', 'Xato kiritilgan', 'Uzoq kutdi']), approved_by: manager } }, ctx);
      if (!o.items.some((x) => x.status !== 'cancelled')) return applyOp(o, { id: uid('p'), type: 'void', order_id: id, by: waiter, at: iso(closeAt), data: { reason: 'Mijoz ketdi', approved_by: manager, shift_id: shift } }, ctx);
    }
    if (!open && R() < 0.06) o = applyOp(o, { id: uid('p'), type: 'discount', order_id: id, by: manager, at: iso(closeAt - 60e3), data: { kind: 'pct', value: pick([5, 10, 15]), reason: pick(['Doimiy mijoz', 'Tug\'ilgan kun', 'Kechikish uchun']) } }, ctx);
    if (open) { if (R() < 0.35) o = applyOp(o, { id: uid('p'), type: 'precheck', order_id: id, by: waiter, at: iso(openAt + 30 * 60e3), data: {} }, ctx); return o; }
    const due = totals(o).total;
    let method = R() < 0.48 ? 'naqd' : R() < 0.55 ? 'karta' : pick(['click', 'payme', 'uzum']);
    if (type === 'zal' && R() < 0.03) {
      const [cid, name, phone] = pick(customers);
      o = applyOp(o, { id: uid('p'), type: 'meta', order_id: id, by: cashier, at: iso(closeAt), data: { customer: { id: cid, name, phone } } }, ctx);
      method = 'qarz';
    }
    o = applyOp(o, { id: uid('p'), type: 'pay', order_id: id, by: cashier, at: iso(closeAt), data: { payment: { id: uid('y'), method, amount: due, received: method === 'naqd' ? Math.ceil(due / 50000) * 50000 : due } } }, ctx);
    return applyOp(o, { id: uid('p'), type: 'close', order_id: id, by: cashier, at: iso(closeAt), data: { shift_id: shift } }, ctx);
  }

  // Kunlik kirim: kecha qancha ishlatilgan bo'lsa shuncha + zaxira (birinchi kun — boshlang'ich zaxira).
  async function morningReceipt(dayStart, usage, first) {
    const groups = {};
    for (const [name, v] of Object.entries(ing)) {
      const cur = Number((await db.first('SELECT stock FROM ingredients WHERE company_id = ? AND id = ?', c, v.id)).stock);
      const target = first ? (v.unit === 'dona' ? 120 : v.grp === 'Go\'sht' ? 40 : 15) : Math.max(usage[v.id] || 0, 0) * 1.6;
      let need = Math.round((target - cur) * 10) / 10;
      if (v.unit === 'dona') need = Math.ceil(need);
      if (need <= 0) continue;
      (groups[v.grp] ||= []).push([v, need]);
    }
    for (const [grp, lines] of Object.entries(groups)) {
      if (!lines.length) continue;
      const at = iso(dayStart + (8 + R()) * 3600e3);
      const sid = sup[grp];
      const doc = await db.first("INSERT INTO stock_docs (company_id, kind, supplier_id, user_id, at, pay_from) VALUES (?, 'kirim', ?, ?, ?, 'boshqa') RETURNING id", c, sid, manager, at);
      let total = 0;
      for (const [v, q] of lines) {
        const price = Math.round(v.price * (0.95 + R() * 0.1) / 100) * 100;
        await moveStock(db, c, { ingredient_id: v.id, kind: 'kirim', qty: q, price, doc_id: doc.id, user_id: manager, at });
        total += Math.round(q * price);
      }
      const paid = R() < 0.7 ? total : Math.round(total * 0.5 / 1000) * 1000;
      await db.run('UPDATE stock_docs SET total = ?, paid = ? WHERE company_id = ? AND id = ?', total, paid, c, doc.id);
      await db.run("INSERT INTO supplier_moves (company_id, supplier_id, kind, amount, doc_id, user_id, at) VALUES (?, ?, 'kirim', ?, ?, ?, ?)", c, sid, total, doc.id, manager, at);
      if (paid) await db.run("INSERT INTO supplier_moves (company_id, supplier_id, kind, amount, doc_id, pay_from, user_id, at) VALUES (?, ?, 'tolov', ?, ?, 'bank', ?, ?)", c, sid, paid, doc.id, manager, at);
      await db.run('UPDATE suppliers SET debt = debt + ? WHERE company_id = ? AND id = ?', total - paid, c, sid);
    }
  }

  const today = localDay();
  const nowMs = Date.now();
  let usage = {};
  for (let d = 14; d >= 0; d--) {
    const day = localDay(new Date(nowMs - d * 86400e3));
    const base = Date.parse(day + 'T00:00:00Z') - 5 * 3600e3;
    const isToday = day === today;
    await morningReceipt(base, usage, d === 14);
    const shiftId = uid('s');
    // Bugun ertalab ochilsa ham kassa "jonli" ko'rinsin: smena hozirdan 3 soat oldin ochilgan bo'ladi.
    const opened = isToday ? Math.min(base + 10.5 * 3600e3, nowMs - 3 * 3600e3) : base + 10.5 * 3600e3;
    await db.run('INSERT INTO shifts (company_id, id, number, opened_by, opened_at, opening_cash) VALUES (?, ?, ?, ?, ?, ?)', c, shiftId, 15 - d, cashier, iso(opened), 500000);
    const end = Math.min(isToday ? nowMs : Infinity, base + 23.5 * 3600e3);
    const count = isToday ? Math.max(0, Math.floor((end - opened) / 3600e3 * 6)) : 60 + Math.floor(R() * 45);
    const docs = [];
    let num = 0;
    for (let i = 0; i < count; i++) {
      const w = R();
      const openAt = opened + Math.floor((w < 0.35 ? 2 + R() * 2.5 : w < 0.55 ? R() * 2 : 6 + R() * 6) * 3600e3);
      const closeAt = openAt + (25 + Math.floor(R() * 60)) * 60e3;
      if (closeAt > end) continue;
      docs.push(makeOrder(shiftId, openAt, closeAt, { number: ++num }));
    }
    docs.sort((a, b) => Date.parse(a.closed_at) - Date.parse(b.closed_at));
    const before = Object.fromEntries((await db.all('SELECT id, stock FROM ingredients WHERE company_id = ?', c)).map((r) => [r.id, Number(r.stock)]));
    for (const o of docs) { await saveOrder(db, c, o, false); await finalizeOrder(db, c, o); }
    usage = Object.fromEntries((await db.all('SELECT id, stock FROM ingredients WHERE company_id = ?', c)).map((r) => [r.id, before[r.id] - Number(r.stock)]));
    // kunlik rasxodlar (kassadan)
    for (const [cat, note, p] of EXP) {
      if (R() > p) continue;
      await db.run('INSERT INTO expenses (company_id, id, category, amount, note, pay_from, shift_id, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        c, uid('e'), cat, Math.round((20 + R() * 180) * 1000 / 1000) * 1000, note, 'kassa', shiftId, cashier, iso(opened + R() * 6 * 3600e3));
    }
    if (d % 7 === 3) await db.run('INSERT INTO expenses (company_id, id, category, amount, note, pay_from, user_id, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      c, uid('e'), 'Ish haqi', 6500000, 'Haftalik avans', 'bank', owner, iso(opened + 3600e3));
    if (d === 6) {
      await db.run("INSERT INTO debt_moves (company_id, id, customer_id, kind, amount, method, shift_id, user_id, at) VALUES (?, ?, 'cdemo00001', 'tolov', 50000, 'naqd', ?, ?, ?)", c, uid('m'), shiftId, cashier, iso(opened + 5 * 3600e3));
      await db.run("UPDATE customers SET debt = debt - 50000 WHERE company_id = ? AND id = 'cdemo00001'", c);
    }
    if (isToday) {
      const busy = new Set();
      for (let i = 0; i < 12 && busy.size < 7; i++) {
        const o = makeOrder(shiftId, nowMs - (5 + Math.floor(R() * 80)) * 60e3, 0, { open: true, number: ++num });
        if (o.type !== 'zal' || busy.has(o.table_id)) continue;
        busy.add(o.table_id);
        await saveOrder(db, c, o, false);
      }
      await db.run("INSERT INTO notes (company_id, id, text, user_id, at) VALUES (?, ?, ?, ?, ?)", c, uid('n'), 'Bugun 19:00 da VIP 2 ga 12 kishilik bron (to\'y). Qozon kabob 2 ta oldindan.', manager, iso(nowMs - 3 * 3600e3));
      await db.run("INSERT INTO notes (company_id, id, text, user_id, at) VALUES (?, ?, ?, ?, ?)", c, uid('n'), 'Pomidor kam qoldi — ertalab bozordan olish kerak.', staff.oshpaz[0], iso(nowMs - 3600e3));
      continue;
    }
    // bir kunda bir oz utilizatsiya
    if (d % 3 === 0) {
      const at = iso(base + 22 * 3600e3);
      const doc = await db.first("INSERT INTO stock_docs (company_id, kind, reason, user_id, at) VALUES (?, 'utilizatsiya', ?, ?, ?) RETURNING id", c, pick(['Muddati o\'tdi', 'Buzildi', 'Tushib ketdi']), manager, at);
      const v = ing[pick(['Pomidor', 'Bodring', 'Ko\'katlar', 'Sut', 'Tovuq go\'shti'])];
      const r = await moveStock(db, c, { ingredient_id: v.id, kind: 'utilizatsiya', qty: -Math.round((0.3 + R() * 1.2) * 10) / 10, doc_id: doc.id, user_id: manager, at });
      await db.run('UPDATE stock_docs SET total = (SELECT ROUND(ABS(SUM(qty * cost))) FROM stock_moves WHERE company_id = ? AND doc_id = ?) WHERE company_id = ? AND id = ?', c, doc.id, c, doc.id);
      void r;
    }
    const closed = opened + 13 * 3600e3;
    const s = shiftSummary({ opening_cash: 500000 }, docs, await shiftMoves(db, c, shiftId));
    const counted = s.expected_cash - (R() < 0.2 ? Math.round(R() * 20) * 1000 : 0);
    Object.assign(s, { counted_cash: counted, diff: counted - s.expected_cash });
    await db.run(`UPDATE shifts SET status = 'closed', closed_by = ?, closed_at = ?, counted_cash = ?, expected_cash = ?, summary = ?::jsonb
      WHERE company_id = ? AND id = ?`, cashier, iso(closed), counted, s.expected_cash, JSON.stringify(s), c, shiftId);
  }
  return c;
}
