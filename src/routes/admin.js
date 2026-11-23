/**
 * Boshqaruv paneli: menyu, sexlar, zal va stollar, xodimlar, sozlamalar.
 * Hammasi menejer sessiyasi bilan (PIN → 12 soatlik belgi). Yozuv o'chirilmaydi —
 * active = false qilinadi: eski buyurtma va hisobot unga tayanadi.
 */
import { SECRET_SETTINGS } from '../lib/schema.js';
import { json, fail, body, str, int, bool } from '../lib/http.js';
import { makePin, validPin, hashPassword } from '../lib/auth.js';
import { ROLES } from '../../public/js/core.js';
import { imageUrl, modGroups } from './auth.js';

const SETTING_KEYS = ['name', 'address', 'phone', 'receipt_header', 'receipt_footer', 'paper', 'service_pct', 'tin',
  'agent_url', 'receipt_printer', 'precheck_note', 'round_to'];

export async function menu(req, env, db, auth) {
  const c = auth.c;
  return json({
    ok: true,
    stations: await db.all('SELECT * FROM stations WHERE company_id = ? AND active = true ORDER BY sort, id', c),
    categories: await db.all('SELECT * FROM categories WHERE company_id = ? AND active = true ORDER BY sort, id', c),
    products: (await db.all(`SELECT id, category_id, name, price, cost, unit, station_id, barcode, ikpu, stop, sort, image_v, goods_id,
      (SELECT i.stock FROM ingredients i WHERE i.company_id = products.company_id AND i.id = products.goods_id AND i.active = true)::float8 AS goods_stock,
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
  const unit = b.unit === 'kg' ? 'kg' : 'dona';
  const vals = [cat, name, price, cost, unit, station, str(b.barcode, 40), str(b.ikpu, 20), bool(b.stop), int(b.sort)];
  // Tayyor tovar (`goods`): yuborilmasa — o'zgarmaydi. Hech narsa yozilmasidan OLDIN tekshiriladi (taom yaratilib, xato chiqib qolmasin).
  let goodsIng = null;
  if (b.goods !== undefined && bool(b.goods)) {
    const linked = id ? (await db.first('SELECT goods_id FROM products WHERE company_id = ? AND id = ?', c, id))?.goods_id : null;
    goodsIng = linked ? await db.first('SELECT id, name, unit, true AS linked FROM ingredients WHERE company_id = ? AND id = ? AND active = true', c, linked) : null;
    if (!goodsIng) goodsIng = await db.first('SELECT id, name, unit FROM ingredients WHERE company_id = ? AND active = true AND lower(name) = lower(?)', c, name);
    if (goodsIng && goodsIng.unit !== unit) {
      const moved = await db.first('SELECT id FROM stock_moves WHERE company_id = ? AND ingredient_id = ? LIMIT 1', c, goodsIng.id);
      if (moved) return fail(409, 'unit_mismatch', `Omborda «${goodsIng.name}» ${goodsIng.unit === 'dona' ? 'donalab' : goodsIng.unit + ' bilan'} hisoblanadi — sotish birligini ham shunday qo'ying`);
    }
  }
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
  let goodsId;
  if (b.goods !== undefined && !bool(b.goods)) {
    await db.run('UPDATE products SET goods_id = NULL WHERE company_id = ? AND id = ?', c, pid); goodsId = null;
  } else if (b.goods !== undefined) {
    goodsId = await db.tx(async (tx) => {
      let ing = goodsIng;
      if (!ing) ing = await tx.first("INSERT INTO ingredients (company_id, name, unit, grp) VALUES (?, ?, ?, 'Tayyor tovar') RETURNING id, name, unit", c, name, unit);
      else if (ing.unit !== unit) await tx.run('UPDATE ingredients SET unit = ? WHERE company_id = ? AND id = ?', unit, c, ing.id);
      // Taom nomi o'zgarsa ombordagi nomi ham o'zgaradi (boshqa element shu nomda bo'lmasa).
      if (ing.linked && ing.name !== name && !(await tx.first('SELECT id FROM ingredients WHERE company_id = ? AND active = true AND lower(name) = lower(?) AND id <> ?', c, name, ing.id))) {
        await tx.run('UPDATE ingredients SET name = ? WHERE company_id = ? AND id = ?', name, c, ing.id);
      }
      await tx.run('DELETE FROM recipes WHERE company_id = ? AND product_id = ?', c, pid);
      await tx.run('INSERT INTO recipes (company_id, product_id, ingredient_id, qty) VALUES (?, ?, ?, 1)', c, pid, ing.id);
      await tx.run('UPDATE products SET goods_id = ? WHERE company_id = ? AND id = ?', ing.id, c, pid);
      return ing.id;
    });
  }
  return json({ ok: true, id: pid, goods_id: goodsId });
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


// =================== Qo'shimchalar ===================
export async function mods(req, env, db, auth) {
  return json({ ok: true, groups: await modGroups(db, auth.c, { full: true }) });
}

/** Guruh to'liq saqlanadi: nomi, majburiyligi, qo'shimchalar ro'yxati va qaysi taomlarga tegishli. */
export async function saveModGroup(req, env, db, auth) {
  const b = await body(req); const c = auth.c; const id = int(b.id, 0);
  const name = str(b.name, 60); if (!name) return fail(400, 'need_name', 'Guruh nomi kerak');
  const list = (Array.isArray(b.mods) ? b.mods : []).slice(0, 40).map((m, i) => ({
    id: int(m.id, 0), name: str(m.name, 60), price: Math.max(0, int(m.price)), cost: Math.max(0, int(m.cost)),
    ingredient_id: int(m.ingredient_id, 0) || null, ingredient_qty: Math.max(0, Number(String(m.ingredient_qty ?? '').replace(',', '.')) || 0), sort: i,
  })).filter((m) => m.name);
  if (!list.length) return fail(400, 'need_mods', 'Kamida bitta qo\'shimcha yozing');
  const ings = new Set((await db.all('SELECT id FROM ingredients WHERE company_id = ? AND active = true', c)).map((r) => r.id));
  for (const m of list) if (m.ingredient_id && !ings.has(m.ingredient_id)) m.ingredient_id = null;
  const prods = new Set((await db.all('SELECT id FROM products WHERE company_id = ? AND active = true', c)).map((r) => r.id));
  const pids = [...new Set((Array.isArray(b.product_ids) ? b.product_ids : []).map((x) => int(x, 0)).filter((x) => prods.has(x)))];
  if (id && !(await own(db, 'mod_groups', c, id))) return fail(404, 'not_found');
  const gid = await db.tx(async (tx) => {
    let g = id;
    if (id) {
      await tx.run('UPDATE mod_groups SET name = ?, required = ?, multi = ?, sort = ? WHERE company_id = ? AND id = ?', name, bool(b.required), b.multi === false ? false : true, int(b.sort), c, id);
    } else {
      g = (await tx.first('INSERT INTO mod_groups (company_id, name, required, multi, sort) VALUES (?, ?, ?, ?, ?) RETURNING id', c, name, bool(b.required), b.multi === false ? false : true, int(b.sort))).id;
    }
    const keep = [];
    for (const m of list) {
      const ex = m.id ? await tx.first('SELECT id FROM modifiers WHERE company_id = ? AND group_id = ? AND id = ?', c, g, m.id) : null;
      if (ex) {
        await tx.run('UPDATE modifiers SET name = ?, price = ?, cost = ?, ingredient_id = ?, ingredient_qty = ?, sort = ?, active = true WHERE company_id = ? AND id = ?',
          m.name, m.price, m.cost, m.ingredient_id, m.ingredient_qty, m.sort, c, ex.id);
        keep.push(ex.id);
      } else {
        keep.push((await tx.first('INSERT INTO modifiers (company_id, group_id, name, price, cost, ingredient_id, ingredient_qty, sort) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
          c, g, m.name, m.price, m.cost, m.ingredient_id, m.ingredient_qty, m.sort)).id);
      }
    }
    // Ro'yxatdan olib tashlangan qo'shimcha o'chirilmaydi — eski buyurtmalar unga tayanadi.
    await tx.run(`UPDATE modifiers SET active = false WHERE company_id = ? AND group_id = ? AND id NOT IN (${keep.map(() => '?').join(',')})`, c, g, ...keep);
    await tx.run('DELETE FROM product_mods WHERE company_id = ? AND group_id = ?', c, g);
    for (const p of pids) await tx.run('INSERT INTO product_mods (company_id, product_id, group_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', c, p, g);
    return g;
  });
  return json({ ok: true, id: gid });
}

export async function removeModGroup(req, env, db, auth) {
  const b = await body(req);
  const r = await db.all('UPDATE mod_groups SET active = false WHERE company_id = ? AND id = ? RETURNING id', auth.c, int(b.id));
  if (!r.length) return fail(404, 'not_found');
  await db.run('DELETE FROM product_mods WHERE company_id = ? AND group_id = ?', auth.c, int(b.id));
  return json({ ok: true });
}

/**
 * Ma'lumotni tozalash — sinov (demo) savdolaridan keyin hisobotlarni nolga tushirish. Faqat EGASI, tasdiqlash so'zi bilan.
 *   savdo   — buyurtmalar, to'lovlar, smenalar, kassa harakati, rasxod, nasiya; sotuv tufayli ombordan chiqqan
 *             elementlar omborga QAYTADI (kirim va inventarizatsiya hujjatlari joyida qoladi);
 *   hammasi — yuqoridagilar + ombor hujjatlari va harakatlari, qoldiq 0, yetkazib beruvchilar qarzi 0.
 * HECH QACHON o'chmaydi: menyu (taom, toifa, texkarta, qo'shimchalar), elementlar ro'yxati va narxi, zagotovkalar,
 * xodimlar, zal va stollar, sozlamalar, qurilmalar. Kassalar keshini tozalashi uchun `reset_at` belgisi qo'yiladi.
 */
const RESET_WORD = 'TOZALASH';
const SALES_TABLES = ['payments', 'order_items', 'ops', 'orders', 'cash_moves', 'shifts', 'expenses', 'debt_moves', 'notes', 'bot_events'];
const STOCK_TABLES = ['stock_moves', 'supplier_moves', 'stock_docs'];

export async function resetInfo(req, env, db, auth) {
  const c = auth.c;
  const one = async (sql) => (await db.first(sql, c)).n;
  const counts = {
    orders: await one('SELECT COUNT(*)::int AS n FROM orders WHERE company_id = ?'),
    open_orders: await one("SELECT COUNT(*)::int AS n FROM orders WHERE company_id = ? AND status = 'open'"),
    shifts: await one('SELECT COUNT(*)::int AS n FROM shifts WHERE company_id = ?'),
    expenses: await one('SELECT COUNT(*)::int AS n FROM expenses WHERE company_id = ? AND deleted_at IS NULL'),
    debts: await one('SELECT COUNT(*)::int AS n FROM customers WHERE company_id = ? AND debt <> 0'),
    stock_docs: await one('SELECT COUNT(*)::int AS n FROM stock_docs WHERE company_id = ?'),
    stock_moves: await one('SELECT COUNT(*)::int AS n FROM stock_moves WHERE company_id = ?'),
    products: await one('SELECT COUNT(*)::int AS n FROM products WHERE company_id = ? AND active = true'),
    ingredients: await one('SELECT COUNT(*)::int AS n FROM ingredients WHERE company_id = ? AND active = true'),
    staff: await one('SELECT COUNT(*)::int AS n FROM users WHERE company_id = ? AND active = true'),
  };
  const sales = await db.first("SELECT COALESCE(SUM(total), 0)::float8 AS v FROM orders WHERE company_id = ? AND status = 'closed'", c);
  return json({ ok: true, word: RESET_WORD, owner: auth.r === 'owner', counts, sales: Math.round(Number(sales.v) || 0) });
}

export async function resetData(req, env, db, auth) {
  if (auth.r !== 'owner') return fail(403, 'forbidden', 'Ma\'lumotni faqat restoran egasi tozalay oladi');
  const b = await body(req); const c = auth.c;
  const scope = ['savdo', 'hammasi'].includes(b.scope) ? b.scope : null;
  if (!scope) return fail(400, 'bad_scope', 'Nimani tozalashni tanlang');
  if (String(b.confirm || '').trim().toUpperCase() !== RESET_WORD) return fail(400, 'confirm', `Tasdiqlash uchun ${RESET_WORD} deb yozing`);
  const at = new Date().toISOString();
  const deleted = await db.tx(async (tx) => {
    const out = {};
    if (scope === 'savdo') {
      // Sotuvda ombordan chiqqan elementlar qaytariladi — aks holda savdo o'chib, ombor kamayganicha qolardi.
      await tx.run(`UPDATE ingredients SET stock = ingredients.stock - s.q FROM (SELECT ingredient_id, SUM(qty) AS q FROM stock_moves
        WHERE company_id = ? AND order_id IS NOT NULL GROUP BY ingredient_id) s WHERE ingredients.company_id = ? AND ingredients.id = s.ingredient_id`, c, c);
      out.sale_moves = (await tx.all('DELETE FROM stock_moves WHERE company_id = ? AND order_id IS NOT NULL RETURNING id', c)).length;
    }
    for (const t of SALES_TABLES) out[t] = (await tx.all(`DELETE FROM ${t} WHERE company_id = ? RETURNING 1 AS x`, c)).length;
    await tx.run('UPDATE customers SET debt = 0 WHERE company_id = ?', c);
    if (scope === 'hammasi') {
      for (const t of STOCK_TABLES) out[t] = (await tx.all(`DELETE FROM ${t} WHERE company_id = ? RETURNING 1 AS x`, c)).length;
      await tx.run('UPDATE ingredients SET stock = 0 WHERE company_id = ?', c);
      await tx.run('UPDATE suppliers SET debt = 0 WHERE company_id = ?', c);
    }
    await tx.run(`INSERT INTO settings (company_id, key, value) VALUES (?, 'reset_at', ?) ON CONFLICT (company_id, key) DO UPDATE SET value = EXCLUDED.value`, c, at);
    return out;
  });
  return json({ ok: true, scope, at, deleted });
}
