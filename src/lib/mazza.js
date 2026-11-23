/**
 * Birinchi mijoz — Mazza Point (Qo'qon, burger). Menyu va narxlar egasining o'z menyusidan
 * (Mazza Point boti: ~/Downloads/mazza-point-bot/lib/catalog.js, 2026-11-10): botdagi bitta
 * kartochkaning har turi kassada alohida pozitsiya.
 *
 * Masalliqlar va texnologik kartalar — boshlang'ich andoza (seedMazzaStock): tarkib botdagi tavsifdan
 * (BBQ — 140 g ko'fte, Dabl — 280 g, Coin set — 4 ta coin + fri + sous…), qolgan grammlar taxminiy.
 * Qoldiq va narx YO'Q — egasi kirim qilganda (Boshqaruv → Ombor → Kirim) narxi bilan yoziladi,
 * grammlarni Boshqaruv → Taomlar → Texnologik karta'da o'zi to'g'rilaydi.
 * Zal va stollar, xodimlar — vaqtincha; egasi Boshqaruvda o'zgartiradi.
 * Kirish (faqat mahalliy sinov uchun): docs/LOCAL.md.
 */
import { readFileSync } from 'node:fs';
import { hashPassword, makePin } from './auth.js';

// Kirish ma'lumotlari repoda emas: seed.local.json (gitignore'da). Fayl bo'lmasa — vaqtinchalik qiymatlar,
// egasi birinchi kirishda Boshqaruv → Sozlamalar'da o'zgartiradi.
const LOCAL = (() => { try { return JSON.parse(readFileSync(new URL('../../seed.local.json', import.meta.url), 'utf8')); } catch { return {}; } })();

export const MAZZA_LOGIN = { email: LOCAL.email || 'egasi@mazza.local', password: LOCAL.password || 'ordo-ozgartiring' };

// Rasm — Mazza Point'ning o'z menyusidan (botdagi bilan bir xil, public/img/mazza/).
export const IMG = {
  'BBQ Burger': 'bbq', 'BBQ Cheese Burger': 'bbq', 'Dabl Cheese Burger': 'dabl', 'Chicken Burger': 'chicken', 'Chicken Cheese Burger': 'chicken',
  'UFO Cheese Burger': 'ufo', 'UFO Chicken': 'ufo', 'UFO Cheese Chicken': 'ufo', 'Coin Chicken Set': 'coin-set', 'Coin Beef Set': 'coin-set',
  'Coin Duo Set': 'coin-duo', 'Longer Chicken': 'longer', 'Corn Cheese': 'corn', 'Hot Dog': 'hotdog', 'Hot Dog x2': 'hotdog', Fri: 'fri',
  'Coca-Cola 0,5 L': 'cola', 'Coca-Cola 1 L': 'cola', 'Fanta 0,5 L': 'fanta', 'Fanta 1 L': 'fanta',
};

// Tannarx (qo'lda) — egasi aytgani (2026-11-22). Qolganini egasi Boshqaruvda yozadi yoki kirimdan hisoblanadi.
const COST = { 'Coca-Cola 0,5 L': 8000, 'Corn Cheese': 18000 };

const CATS = [
  ['Burgerlar', '#c8102e', true, [['BBQ Burger', 40000], ['BBQ Cheese Burger', 43000], ['Dabl Cheese Burger', 56000], ['Chicken Burger', 35000], ['Chicken Cheese Burger', 38000]]],
  ['UFO Burger', '#6d3fd1', true, [['UFO Cheese Burger', 43000], ['UFO Chicken', 35000], ['UFO Cheese Chicken', 38000]]],
  ['Coin setlar', '#b8860b', true, [['Coin Chicken Set', 50000], ['Coin Beef Set', 55000], ['Coin Duo Set', 75000]]],
  ['Longer va hot-dog', '#d35400', true, [['Longer Chicken', 35000], ['Corn Cheese', 25000], ['Hot Dog', 12000], ['Hot Dog x2', 16000]]],
  ['Fri', '#c79a00', true, [['Fri', 15000]]],
  ['Souslar', '#7a4b26', false, [['Sirniy sous', 5000], ['Firmenniy sous', 5000], ['Chesnochniy sous', 5000], ['Ketchup', 5000]]],
  ['Ichimliklar', '#2b6cb0', false, [['Coca-Cola 0,5 L', 10000], ['Coca-Cola 1 L', 15000], ['Fanta 0,5 L', 10000], ['Fanta 1 L', 15000], ['Kofe', 10000]]],
];

export async function seedMazza(db) {
  const c = (await db.first('INSERT INTO companies (name) VALUES (?) RETURNING id', 'Mazza Point')).id;
  const set = { name: 'Mazza Point', receipt_header: 'Yangicha ta\'m', address: 'Qo\'qon, Sarbon ko\'chasi, 12/4', phone: '+998 98 770 22 11',
    receipt_footer: 'Rahmat! Yoqimli ishtaha!', paper: '80', service_pct: '0' };
  for (const [k, v] of Object.entries(set)) await db.run('INSERT INTO settings (company_id, key, value) VALUES (?, ?, ?)', c, k, v);
  const kitchen = (await db.first('INSERT INTO stations (company_id, name, sort) VALUES (?, ?, 0) RETURNING id', c, 'Oshxona')).id;
  const hall = (await db.first('INSERT INTO halls (company_id, name, sort, service_pct) VALUES (?, ?, 0, 0) RETURNING id', c, 'Zal')).id;
  for (let i = 1; i <= 6; i++) await db.run('INSERT INTO tables (company_id, hall_id, name, seats, sort) VALUES (?, ?, ?, 4, ?)', c, hall, String(i), i);
  for (const [ci, [name, color, toKitchen, items]] of CATS.entries()) {
    const cat = (await db.first('INSERT INTO categories (company_id, name, color, station_id, sort) VALUES (?, ?, ?, ?, ?) RETURNING id', c, name, color, toKitchen ? kitchen : null, ci)).id;
    for (const [pi, [pname, price]] of items.entries()) {
      await db.run('INSERT INTO products (company_id, category_id, name, price, cost, unit, sort, image) VALUES (?, ?, ?, ?, ?, \'dona\', ?, ?)', c, cat, pname, price, COST[pname] || 0, pi,
        IMG[pname] ? `/img/mazza/${IMG[pname]}.jpg` : null);
    }
  }
  const staff = [['Egasi', 'owner', LOCAL.pins?.owner || '0000', '#14213d', true], ['Kassir', 'kassir', LOCAL.pins?.kassir || '1111', '#e4572e', false]];
  for (const [name, role, pin, color, owner] of staff) {
    const p = await makePin(pin);
    await db.run(`INSERT INTO users (company_id, name, role, email, password_hash, pin_salt, pin_hash, color) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      c, name, role, owner ? MAZZA_LOGIN.email : null, owner ? await hashPassword(MAZZA_LOGIN.password) : null, p.pin_salt, p.pin_hash, color);
  }
  await seedMazzaStock(db, c);
  return c;
}

// [nomi, birlik, guruh] — qoldiq va narx bo'sh: kirimda yoziladi.
const INGREDIENTS = [
  ['Burger bulochkasi', 'dona', 'Non'], ['UFO bulochkasi', 'dona', 'Non'], ['Longer bulochkasi', 'dona', 'Non'],
  ['Hot-dog bulochkasi', 'dona', 'Non'], ['Coin bulochkasi', 'dona', 'Non'],
  ['Mol go\'shti (qiyma)', 'kg', 'Go\'sht'], ['Tovuq filesi', 'kg', 'Go\'sht'], ['Sosiska', 'dona', 'Go\'sht'],
  ['Cheddar pishloq (slays)', 'dona', 'Pishloq'], ['Mozzarella', 'kg', 'Pishloq'],
  ['Pomidor', 'kg', 'Sabzavot'], ['Aysberg salat', 'kg', 'Sabzavot'], ['Tuzlangan bodring', 'kg', 'Sabzavot'],
  ['Firmenniy sous', 'kg', 'Sous'], ['Sirniy sous', 'kg', 'Sous'], ['Chesnochniy sous', 'kg', 'Sous'], ['BBQ sous', 'kg', 'Sous'],
  ['Ketchup', 'kg', 'Sous'], ['Mayonez', 'kg', 'Sous'],
  ['Kartoshka fri', 'kg', 'Fri'], ['O\'simlik yog\'i', 'l', 'Fri'], ['Panirovka', 'kg', 'Fri'],
  ['Coca-Cola 0,5 L', 'dona', 'Ichimlik'], ['Coca-Cola 1 L', 'dona', 'Ichimlik'], ['Fanta 0,5 L', 'dona', 'Ichimlik'], ['Fanta 1 L', 'dona', 'Ichimlik'],
  ['Kofe', 'kg', 'Ichimlik'],
  ['Burger qog\'ozi', 'dona', 'Qadoq'], ['Fri qutisi', 'dona', 'Qadoq'], ['Sous idishi', 'dona', 'Qadoq'], ['Stakan', 'dona', 'Qadoq'],
];

const BBQ = [['Burger bulochkasi', 1], ['Mol go\'shti (qiyma)', 0.14], ['Pomidor', 0.03], ['Aysberg salat', 0.015], ['Firmenniy sous', 0.02], ['BBQ sous', 0.015], ['Burger qog\'ozi', 1]];
const CHICKEN = [['Burger bulochkasi', 1], ['Tovuq filesi', 0.12], ['Panirovka', 0.02], ['Pomidor', 0.03], ['Mayonez', 0.015], ['Burger qog\'ozi', 1]];
const UFO = (meat, kg) => [['UFO bulochkasi', 1], [meat, kg], ['Burger qog\'ozi', 1]];
const SET = (n, meats, fri) => [['Coin bulochkasi', n], ...meats, ['Kartoshka fri', fri], ['O\'simlik yog\'i', 0.01], ['Firmenniy sous', 0.04], ['Sous idishi', 1], ['Fri qutisi', 1]];
const SAUCE = (name) => [[name, 0.04], ['Sous idishi', 1]];
const HOTDOG = (n) => [['Hot-dog bulochkasi', n], ['Sosiska', n], ['Ketchup', 0.01 * n], ['Mayonez', 0.01 * n], ['Tuzlangan bodring', 0.015 * n], ['Burger qog\'ozi', n]];

const RECIPES = {
  'BBQ Burger': BBQ,
  'BBQ Cheese Burger': [...BBQ, ['Cheddar pishloq (slays)', 1]],
  'Dabl Cheese Burger': [['Burger bulochkasi', 1], ['Mol go\'shti (qiyma)', 0.28], ['Cheddar pishloq (slays)', 2], ['Pomidor', 0.03], ['Aysberg salat', 0.015], ['Firmenniy sous', 0.02], ['Burger qog\'ozi', 1]],
  'Chicken Burger': CHICKEN,
  'Chicken Cheese Burger': [...CHICKEN, ['Cheddar pishloq (slays)', 1], ['Aysberg salat', 0.015]],
  'UFO Cheese Burger': [...UFO('Mol go\'shti (qiyma)', 0.12), ['Cheddar pishloq (slays)', 1], ['Sirniy sous', 0.02]],
  'UFO Chicken': [...UFO('Tovuq filesi', 0.1), ['Mayonez', 0.015]],
  'UFO Cheese Chicken': [...UFO('Tovuq filesi', 0.1), ['Mayonez', 0.015], ['Cheddar pishloq (slays)', 1]],
  'Coin Chicken Set': SET(4, [['Tovuq filesi', 0.16]], 0.12),
  'Coin Beef Set': SET(4, [['Mol go\'shti (qiyma)', 0.16]], 0.12),
  'Coin Duo Set': SET(8, [['Tovuq filesi', 0.16], ['Mol go\'shti (qiyma)', 0.16]], 0.15),
  'Longer Chicken': [['Longer bulochkasi', 1], ['Tovuq filesi', 0.1], ['Panirovka', 0.02], ['Aysberg salat', 0.01], ['Pomidor', 0.02], ['Mayonez', 0.015], ['Burger qog\'ozi', 1]],
  'Corn Cheese': [['Mozzarella', 0.06], ['Panirovka', 0.04], ['O\'simlik yog\'i', 0.02]],
  'Hot Dog': HOTDOG(1),
  'Hot Dog x2': HOTDOG(2),
  Fri: [['Kartoshka fri', 0.15], ['O\'simlik yog\'i', 0.015], ['Fri qutisi', 1]],
  'Sirniy sous': SAUCE('Sirniy sous'), 'Firmenniy sous': SAUCE('Firmenniy sous'), 'Chesnochniy sous': SAUCE('Chesnochniy sous'), Ketchup: SAUCE('Ketchup'),
  'Coca-Cola 0,5 L': [['Coca-Cola 0,5 L', 1]], 'Coca-Cola 1 L': [['Coca-Cola 1 L', 1]], 'Fanta 0,5 L': [['Fanta 0,5 L', 1]], 'Fanta 1 L': [['Fanta 1 L', 1]],
  Kofe: [['Kofe', 0.008], ['Stakan', 1]],
};

/** Masalliqlar va texnologik kartalar (bir marta: masalliq allaqachon bo'lsa hech narsa qilmaydi). */
export async function seedMazzaStock(db, c) {
  const has = await db.first('SELECT COUNT(*)::int AS n FROM ingredients WHERE company_id = ?', c);
  if (has.n) return { skipped: true };
  const ing = {};
  for (const [name, unit, grp] of INGREDIENTS) {
    ing[name] = (await db.first('INSERT INTO ingredients (company_id, name, unit, grp) VALUES (?, ?, ?, ?) RETURNING id', c, name, unit, grp)).id;
  }
  const products = Object.fromEntries((await db.all('SELECT id, name FROM products WHERE company_id = ?', c)).map((p) => [p.name, p.id]));
  let n = 0;
  for (const [pname, lines] of Object.entries(RECIPES)) {
    const pid = products[pname]; if (!pid) continue;
    const merged = new Map();
    for (const [iname, q] of lines) merged.set(iname, Math.round(((merged.get(iname) || 0) + q) * 1000) / 1000);
    for (const [iname, q] of merged) {
      if (!ing[iname]) throw new Error('masalliq yo\'q: ' + iname);
      await db.run('INSERT INTO recipes (company_id, product_id, ingredient_id, qty) VALUES (?, ?, ?, ?)', c, pid, ing[iname], q);
    }
    n++;
  }
  return { ingredients: Object.keys(ing).length, recipes: n };
}
