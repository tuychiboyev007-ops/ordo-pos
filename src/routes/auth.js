import { json, fail, body, str, int } from '../lib/http.js';
import { signToken, hashPassword, checkPassword, makePin, validPin } from '../lib/auth.js';
import { pinHash, sameHex } from '../../public/js/pin.js';
import { MANAGER_ROLES } from '../../public/js/core.js';
import { SECRET_SETTINGS } from '../lib/schema.js';

const SESSION_MS = 12 * 3600e3;

/** Rasm manzili: sayt fayli bo'lsa o'zi, bazada bo'lsa /api/img (versiya bilan — kesh almashsin). */
export const imageUrl = (c, p) => (!p.image ? null : p.image === 'db' ? `/api/img?c=${c}&p=${p.id}&v=${p.image_v || 0}` : p.image);

/** Taom rasmi — ochiq (rasm sir emas), uzoq keshlanadi. */
export async function image(req, env, db) {
  const u = new URL(req.url);
  const r = await db.first('SELECT image FROM products WHERE company_id = ? AND id = ?', Number(u.searchParams.get('c')) || 0, Number(u.searchParams.get('p')) || 0);
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(r?.image || '');
  if (!m) return new Response('topilmadi', { status: 404 });
  const bin = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0));
  return new Response(bin, { headers: { 'content-type': m[1], 'cache-control': 'public, max-age=31536000, immutable' } });
}

/** Restoran ochish (hozircha faqat ishlab chiquvchi / demo uchun: env.SETUP_OPEN = '1'). */
export async function setup(req, env, db) {
  if (env.SETUP_OPEN !== '1') return fail(403, 'setup_closed', 'Yangi restoran faqat ordo administratori orqali ochiladi');
  const b = await body(req);
  const name = str(b.name, 120); const email = str(b.email, 120)?.toLowerCase(); const owner = str(b.owner, 80) || 'Egasi';
  if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail(400, 'bad_input', 'Nom va email kerak');
  if (String(b.password || '').length < 8) return fail(400, 'weak_password', 'Parol kamida 8 belgi');
  if (!validPin(b.pin)) return fail(400, 'bad_pin', 'PIN 4–6 raqam');
  const taken = await db.first('SELECT id FROM users WHERE lower(email) = ? /* tenant:global — email butun tizimda yagona */', email);
  if (taken) return fail(409, 'email_taken', 'Bu email band');
  const co = await db.first('INSERT INTO companies (name) VALUES (?) RETURNING id', name);
  const pin = await makePin(b.pin);
  await db.run('INSERT INTO users (company_id, name, role, email, password_hash, pin_salt, pin_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
    co.id, owner, 'owner', email, await hashPassword(String(b.password)), pin.pin_salt, pin.pin_hash);
  return json({ ok: true, company_id: co.id });
}

/** Qurilmani ulash: egasi yoki menejer email+parol bilan. */
export async function deviceLogin(req, env, db) {
  const b = await body(req);
  const email = str(b.email, 120)?.toLowerCase();
  const key = 'login:' + email;
  const u = email ? await db.first(`SELECT u.*, c.name AS company_name, c.active AS company_active FROM users u JOIN companies c ON c.id = u.company_id
    WHERE lower(u.email) = ? /* tenant:global — kirish: firma hali noma'lum */`, email) : null;
  if (u) {
    const n = await db.first("SELECT COUNT(*)::int AS n FROM login_attempts WHERE company_id = ? AND key = ? AND at > now() - interval '15 minutes'", u.company_id, key);
    if (n.n >= 6) return fail(429, 'locked', 'Ko\'p xato urinish — 15 daqiqadan keyin qayta urining');
  }
  if (!u || !u.active || !(await checkPassword(String(b.password || ''), u.password_hash))) {
    if (u) await db.run('INSERT INTO login_attempts (company_id, key) VALUES (?, ?)', u.company_id, key);
    return fail(401, 'bad_login', 'Email yoki parol noto\'g\'ri');
  }
  if (!MANAGER_ROLES.includes(u.role)) return fail(403, 'not_manager', 'Qurilmani faqat egasi yoki menejer ulaydi');
  if (!u.company_active) return fail(403, 'company_off', 'Restoran hisobi o\'chirilgan');
  const dev = await db.first('INSERT INTO devices (company_id, name, created_by) VALUES (?, ?, ?) RETURNING id',
    u.company_id, str(b.device, 60) || 'Kassa', u.id);
  const token = await signToken(env.AUTH_SECRET, { t: 'd', c: u.company_id, d: dev.id });
  return json({ ok: true, token, company: { id: u.company_id, name: u.company_name } });
}

/** PIN bilan boshqaruv sessiyasi (internet kerak). */
export async function pinLogin(req, env, db, auth) {
  const b = await body(req);
  const id = int(b.user_id, 0);
  const key = 'pin:' + id;
  const n = await db.first("SELECT COUNT(*)::int AS n FROM login_attempts WHERE company_id = ? AND key = ? AND at > now() - interval '5 minutes'", auth.c, key);
  if (n.n >= 5) return fail(429, 'locked', 'Ko\'p xato urinish — 5 daqiqa kuting');
  const u = await db.first('SELECT id, name, role, pin_salt, pin_hash, active, token_version FROM users WHERE company_id = ? AND id = ?', auth.c, id);
  if (!u || !u.active || !u.pin_hash || !sameHex(await pinHash(String(b.pin || ''), u.pin_salt), u.pin_hash)) {
    await db.run('INSERT INTO login_attempts (company_id, key) VALUES (?, ?)', auth.c, key);
    return fail(401, 'bad_pin', 'PIN noto\'g\'ri');
  }
  const token = await signToken(env.AUTH_SECRET, { t: 's', c: auth.c, d: auth.d, u: u.id, r: u.role, v: u.token_version, exp: Date.now() + SESSION_MS });
  return json({ ok: true, token, user: { id: u.id, name: u.name, role: u.role } });
}

export async function changePassword(req, env, db, auth) {
  const b = await body(req);
  const u = await db.first('SELECT id, password_hash FROM users WHERE company_id = ? AND id = ?', auth.c, auth.u);
  if (!u?.password_hash) return fail(400, 'no_password', 'Bu xodimda parol yo\'q');
  if (!(await checkPassword(String(b.old || ''), u.password_hash))) return fail(401, 'bad_password', 'Eski parol noto\'g\'ri');
  if (String(b.password || '').length < 8) return fail(400, 'weak_password', 'Parol kamida 8 belgi');
  await db.run('UPDATE users SET password_hash = ?, token_version = token_version + 1 WHERE company_id = ? AND id = ?', await hashPassword(String(b.password)), auth.c, u.id);
  return json({ ok: true });
}

/** Kassa uchun hamma kerakli ma'lumot — bir so'rovda; kassa uni o'zida saqlaydi (oflayn). */
export async function boot(req, env, db, auth) {
  const c = auth.c;
  const company = await db.first('SELECT id, name FROM companies WHERE id = ? /* tenant:global — o\'z firmasi */', c);
  const rows = await db.all('SELECT key, value FROM settings WHERE company_id = ?', c);
  const settings = Object.fromEntries(rows.filter((r) => !SECRET_SETTINGS.includes(r.key) && !r.key.startsWith('bot_')).map((r) => [r.key, r.value]));
  // Kassa botdan buyurtma so'rashni shundan biladi (manzil va kalit kassaga bormaydi).
  if (rows.some((r) => r.key === 'bot_url' && r.value) && rows.some((r) => r.key === 'bot_key' && r.value)) settings.bot_on = '1';
  const stations = await db.all('SELECT id, name, printer, sort FROM stations WHERE company_id = ? AND active = true ORDER BY sort, id', c);
  const halls = await db.all('SELECT id, name, sort, service_pct::float AS service_pct FROM halls WHERE company_id = ? AND active = true ORDER BY sort, id', c);
  const tables = await db.all('SELECT id, hall_id, name, seats, sort FROM tables WHERE company_id = ? AND active = true ORDER BY sort, id', c);
  const categories = await db.all('SELECT id, name, color, station_id, sort FROM categories WHERE company_id = ? AND active = true ORDER BY sort, id', c);
  const products = (await db.all(`SELECT id, category_id, name, price, unit, station_id, barcode, stop, sort, image_v,
    CASE WHEN image LIKE '/%' THEN image WHEN image IS NOT NULL THEN 'db' END AS image FROM products
    WHERE company_id = ? AND active = true ORDER BY sort, name`, c)).map((p) => ({ ...p, price: Number(p.price), image: imageUrl(c, p) }));
  const staff = await db.all('SELECT id, name, role, color, pin_salt, pin_hash FROM users WHERE company_id = ? AND active = true AND pin_hash IS NOT NULL ORDER BY role, name', c);
  return json({ ok: true, company, settings, stations, halls, tables, categories, products, staff, device_id: auth.d });
}
