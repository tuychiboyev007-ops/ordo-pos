/**
 * Boshqaruv paneli: menyu, sexlar, zal va stollar, xodimlar, sozlamalar.
 * Hammasi menejer sessiyasi bilan (PIN → 12 soatlik belgi). Yozuv o'chirilmaydi —
 * active = false qilinadi: eski buyurtma va hisobot unga tayanadi.
 */
import { SECRET_SETTINGS } from '../lib/schema.js';
import { json, fail, body, str, int, bool } from '../lib/http.js';
import { makePin, validPin, hashPassword } from '../lib/auth.js';
import { ROLES } from '../../public/js/core.js';
import { imageUrl } from './auth.js';

const SETTING_KEYS = ['name', 'address', 'phone', 'receipt_header', 'receipt_footer', 'paper', 'service_pct', 'tin',
  'agent_url', 'receipt_printer', 'precheck_note', 'round_to'];

export async function menu(req, env, db, auth) {
  const c = auth.c;
  return json({
    ok: true,
    stations: await db.all('SELECT * FROM stations WHERE company_id = ? AND active = true ORDER BY sort, id', c),
    categories: await db.all('SELECT * FROM categories WHERE company_id = ? AND active = true ORDER BY sort, id', c),
    products: (await db.all(`SELECT id, category_id, name, price, cost, unit, station_id, barcode, ikpu, stop, sort, image_v,
      CASE WHEN image LIKE '/%' THEN image WHEN image IS NOT NULL THEN 'db' END AS image FROM products WHERE company_id = ? AND active = true ORDER BY sort, name`, c))
      .map((p) => ({ ...p, price: Number(p.price), cost: Number(p.cost), image: imageUrl(c, p) })),
    halls: await db.all('SELECT id, name, sort, service_pct::float AS service_pct FROM halls WHERE company_id = ? AND active = true ORDER BY sort, id', c),
    tables: await db.all('SELECT * FROM tables WHERE company_id = ? AND active = true ORDER BY sort, id', c),
  });
}

async function own(db, table, c, id) {
  return id ? db.first(`SELECT id FROM ${table} WHERE company_id = ? AND id = ?`, c, id) : null;
}

export async function saveCategory(req, env, db, auth) {
  const b = await body(req); const c = auth.c; const id = int(b.id, 0);
  const name = str(b.name, 60); if (!name) return fail(400, 'need_name', 'Nomi kerak');
  const station = int(b.station_id, 0) && (await own(db, 'stations', c, int(b.station_id))) ? int(b.station_id) : null;
  const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : null;
  if (id) {
    if (!(await own(db, 'categories', c, id))) return fail(404, 'not_found');
    await db.run('UPDATE categories SET name = ?, color = ?, station_id = ?, sort = ? WHERE company_id = ? AND id = ?', name, color, station, int(b.sort), c, id);
    return json({ ok: true, id });
  }
  const r = await db.first('INSERT INTO categories (company_id, name, color, station_id, sort) VALUES (?, ?, ?, ?, ?) RETURNING id', c, name, color, station, int(b.sort));
  return json({ ok: true, id: r.id });
}

export async function saveProduct(req, env, db, auth) {
  const b = await body(req); const c = auth.c; const id = int(b.id, 0);
  const name = str(b.name, 120); if (!name) return fail(400, 'need_name', 'Nomi kerak');
  const price = int(b.price, -1); if (price < 0) return fail(400, 'bad_price', 'Narx noto\'g\'ri');
  const cat = int(b.category_id, 0) && (await own(db, 'categories', c, int(b.category_id))) ? int(b.category_id) : null;
  const station = int(b.station_id, 0) && (await own(db, 'stations', c, int(b.station_id))) ? int(b.station_id) : null;
  // Tannarx (qo'lda): yuborilmasa eski qiymat qoladi.
  const cur = id ? await db.first('SELECT cost FROM products WHERE company_id = ? AND id = ?', c, id) : null;
  const cost = b.cost === undefined || b.cost === null ? Number(cur?.cost || 0) : Math.max(0, int(b.cost));
  const vals = [cat, name, price, cost, b.unit === 'kg' ? 'kg' : 'dona', station, str(b.barcode, 40), str(b.ikpu, 20), bool(b.stop), int(b.sort)];
  // Rasm: yuborilmasa — o'zgarmaydi, '' — o'chiriladi, data:image — yangi (420 px gacha siqilgan bo'lishi kerak).
  let img;
  if (b.image === '' || b.image === null) img = null;
  else if (typeof b.image === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(b.image)) {
    if (b.image.length > 160000) return fail(400, 'big_image', 'Rasm juda katta');
    img = b.image;
  }
  let pid = id;
  if (id) {
    if (!(await own(db, 'products', c, id))) return fail(404, 'not_found');
    await db.run(`UPDATE products SET category_id = ?, name = ?, price = ?, cost = ?, unit = ?, station_id = ?, barcode = ?, ikpu = ?, stop = ?, sort = ?
      WHERE company_id = ? AND id = ?`, ...vals, c, id);
  } else {
    pid = (await db.first(`INSERT INTO products (company_id, category_id, name, price, cost, unit, station_id, barcode, ikpu, stop, sort)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, c, ...vals)).id;
  }
  if (img !== undefined) await db.run('UPDATE products SET image = ?, image_v = image_v + 1 WHERE company_id = ? AND id = ?', img, c, pid);
  return json({ ok: true, id: pid });
}

/** Stop-list — kassadan ham (internet bo'lsa) o'zgartiriladi. */
export async function setStop(req, env, db, auth) {
  const b = await body(req);
  const r = await db.all('UPDATE products SET stop = ? WHERE company_id = ? AND id = ? RETURNING id', bool(b.stop), auth.c, int(b.id));
  return r.length ? json({ ok: true }) : fail(404, 'not_found');
}

export async function saveStation(req, env, db, auth) {
  const b = await body(req); const c = auth.c; const id = int(b.id, 0);
  const name = str(b.name, 60); if (!name) return fail(400, 'need_name', 'Nomi kerak');
  if (id) {
    if (!(await own(db, 'stations', c, id))) return fail(404, 'not_found');
    await db.run('UPDATE stations SET name = ?, printer = ?, sort = ? WHERE company_id = ? AND id = ?', name, str(b.printer, 60), int(b.sort), c, id);
    return json({ ok: true, id });
  }
  const r = await db.first('INSERT INTO stations (company_id, name, printer, sort) VALUES (?, ?, ?, ?) RETURNING id', c, name, str(b.printer, 60), int(b.sort));
  return json({ ok: true, id: r.id });
}

export async function saveHall(req, env, db, auth) {
  const b = await body(req); const c = auth.c; const id = int(b.id, 0);
  const name = str(b.name, 60); if (!name) return fail(400, 'need_name', 'Nomi kerak');
  const pct = Math.max(0, Math.min(30, Number(b.service_pct) || 0));
  if (id) {
    if (!(await own(db, 'halls', c, id))) return fail(404, 'not_found');
    await db.run('UPDATE halls SET name = ?, sort = ?, service_pct = ? WHERE company_id = ? AND id = ?', name, int(b.sort), pct, c, id);
    return json({ ok: true, id });
  }
  const r = await db.first('INSERT INTO halls (company_id, name, sort, service_pct) VALUES (?, ?, ?, ?) RETURNING id', c, name, int(b.sort), pct);
  return json({ ok: true, id: r.id });
}

export async function saveTable(req, env, db, auth) {
  const b = await body(req); const c = auth.c; const id = int(b.id, 0);
  const name = str(b.name, 30); if (!name) return fail(400, 'need_name', 'Nomi kerak');
  const hall = int(b.hall_id); if (!(await own(db, 'halls', c, hall))) return fail(400, 'bad_hall', 'Zal tanlanmagan');
  const seats = Math.max(1, Math.min(50, int(b.seats, 4)));
  if (id) {
    if (!(await own(db, 'tables', c, id))) return fail(404, 'not_found');
    await db.run('UPDATE tables SET hall_id = ?, name = ?, seats = ?, sort = ? WHERE company_id = ? AND id = ?', hall, name, seats, int(b.sort), c, id);
    return json({ ok: true, id });
  }
  const r = await db.first('INSERT INTO tables (company_id, hall_id, name, seats, sort) VALUES (?, ?, ?, ?, ?) RETURNING id', c, hall, name, seats, int(b.sort));
  return json({ ok: true, id: r.id });
}

const DELETABLE = { category: 'categories', product: 'products', station: 'stations', hall: 'halls', table: 'tables' };

export async function remove(req, env, db, auth) {
  const b = await body(req);
  const table = DELETABLE[b.kind];
  if (!table) return fail(400, 'bad_kind');
  if (table === 'tables') {
    const busy = await db.first("SELECT id FROM orders WHERE company_id = ? AND status = 'open' AND table_id = ?", auth.c, int(b.id));
    if (busy) return fail(409, 'busy', 'Stolda ochiq buyurtma bor');
  }
  if (table === 'categories') {
    const p = await db.first('SELECT COUNT(*)::int AS n FROM products WHERE company_id = ? AND category_id = ? AND active = true', auth.c, int(b.id));
    if (p.n) return fail(409, 'has_products', `Toifada ${p.n} ta taom bor — avval ularni boshqa toifaga o'tkazing yoki o'chiring`);
  }
  if (table === 'halls') {
    const busy = await db.first(`SELECT COUNT(*)::int AS n FROM orders o JOIN tables t ON t.id = o.table_id AND t.company_id = o.company_id
      WHERE o.company_id = ? AND o.status = 'open' AND t.hall_id = ?`, auth.c, int(b.id));
    if (busy.n) return fail(409, 'busy', `Zal stollarida ochiq buyurtma bor (${busy.n} ta)`);
    await db.run('UPDATE tables SET active = false WHERE company_id = ? AND hall_id = ?', auth.c, int(b.id));
  }
  const r = await db.all(`UPDATE ${table} SET active = false WHERE company_id = ? AND id = ? RETURNING id`, auth.c, int(b.id));
  return r.length ? json({ ok: true }) : fail(404, 'not_found');
}

export async function staff(req, env, db, auth) {
  const rows = await db.all('SELECT id, name, role, email, active, color, (pin_hash IS NOT NULL) AS has_pin, created_at FROM users WHERE company_id = ? ORDER BY active DESC, role, name', auth.c);
  return json({ ok: true, staff: rows });
}

export async function saveStaff(req, env, db, auth) {
  const b = await body(req); const c = auth.c; const id = int(b.id, 0);
  const name = str(b.name, 80); if (!name) return fail(400, 'need_name', 'Ism kerak');
  const role = ROLES.includes(b.role) ? b.role : 'ofitsiant';
  if (role === 'owner' && auth.r !== 'owner') return fail(403, 'forbidden', 'Egasini faqat egasi tayinlaydi');
  if (b.pin && !validPin(b.pin)) return fail(400, 'bad_pin', 'PIN 4–6 raqam');
  const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : null;
  const email = str(b.email, 120)?.toLowerCase() || null;
  if (email) {
    const t = await db.first('SELECT id FROM users WHERE lower(email) = ? AND id <> ? /* tenant:global — email yagona */', email, id || 0);
    if (t) return fail(409, 'email_taken', 'Bu email band');
  }
  if (id) {
    const u = await db.first('SELECT id, role FROM users WHERE company_id = ? AND id = ?', c, id);
    if (!u) return fail(404, 'not_found');
    if (u.role === 'owner' && auth.r !== 'owner') return fail(403, 'forbidden', 'Egasini faqat o\'zi o\'zgartiradi');
    const active = b.active === undefined ? true : bool(b.active);
    if (id === auth.u && (!active || !['owner', 'admin'].includes(role))) return fail(409, 'self_lockout', 'O\'zingizni o\'chira olmaysiz');
    await db.run('UPDATE users SET name = ?, role = ?, color = ?, email = ?, active = ?, token_version = token_version + CASE WHEN ? THEN 1 ELSE 0 END WHERE company_id = ? AND id = ?',
      name, role, color, email, active, !active, c, id);
    if (b.pin) { const p = await makePin(b.pin); await db.run('UPDATE users SET pin_salt = ?, pin_hash = ?, token_version = token_version + 1 WHERE company_id = ? AND id = ?', p.pin_salt, p.pin_hash, c, id); }
    if (b.password) {
      if (String(b.password).length < 8) return fail(400, 'weak_password', 'Parol kamida 8 belgi');
      await db.run('UPDATE users SET password_hash = ? WHERE company_id = ? AND id = ?', await hashPassword(String(b.password)), c, id);
    }
    return json({ ok: true, id });
  }
  if (!b.pin) return fail(400, 'need_pin', 'PIN kerak');
  const p = await makePin(b.pin);
  const r = await db.first('INSERT INTO users (company_id, name, role, color, email, pin_salt, pin_hash, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    c, name, role, color, email, p.pin_salt, p.pin_hash, b.password && String(b.password).length >= 8 ? await hashPassword(String(b.password)) : null);
  return json({ ok: true, id: r.id });
}

export async function settings(req, env, db, auth) {
  const rows = await db.all('SELECT key, value FROM settings WHERE company_id = ?', auth.c);
  const co = await db.first('SELECT name FROM companies WHERE id = ? /* tenant:global — o\'z firmasi */', auth.c);
  // Maxfiy qiymat (bot kaliti) qaytmaydi — faqat bor-yo'qligi.
  const settings = Object.fromEntries(rows.map((r) => (SECRET_SETTINGS.includes(r.key) ? [r.key, r.value ? '••••' : ''] : [r.key, r.value])));
  return json({ ok: true, settings, company: co });
}

export async function saveSettings(req, env, db, auth) {
  const b = await body(req);
  for (const k of SETTING_KEYS) {
    if (!(k in b)) continue;
    const v = b[k] == null ? null : String(b[k]).slice(0, 400);
    await db.run('INSERT INTO settings (company_id, key, value) VALUES (?, ?, ?) ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value', auth.c, k, v);
  }
  if (str(b.name, 120)) await db.run('UPDATE companies SET name = ? WHERE id = ? /* tenant:global — o\'z firmasi */', str(b.name, 120), auth.c);
  return json({ ok: true });
}

export async function devices(req, env, db, auth) {
  return json({ ok: true, devices: await db.all('SELECT id, name, created_at, last_seen, revoked FROM devices WHERE company_id = ? ORDER BY id', auth.c) });
}

export async function revokeDevice(req, env, db, auth) {
  const b = await body(req);
  if (int(b.id) === auth.d) return fail(409, 'self', 'Hozirgi qurilmani o\'chirib bo\'lmaydi');
  const r = await db.all('UPDATE devices SET revoked = true WHERE company_id = ? AND id = ? RETURNING id', auth.c, int(b.id));
  return r.length ? json({ ok: true }) : fail(404, 'not_found');
}
