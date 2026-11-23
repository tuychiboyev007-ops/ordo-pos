/**
 * Ombor: elementlar, texnologik karta, kirim / utilizatsiya / inventarizatsiya hujjatlari,
 * harakatlar, bugungi holat va moddiy hisobot.
 */
import { unitCosts, ingCosts } from '../lib/cost.js';
import { json, fail, body, str, int, isDay, dayRange } from '../lib/http.js';
import { moveStock, consume, applyNeeds, produce, q3 } from '../lib/stock.js';
import { shiftSummary } from '../../public/js/core.js';
import { periodMoney } from './reports.js';
import { currentShift, shiftMoves } from './sync.js';

const UNITS = ['kg', 'l', 'dona'];
const n = (v) => Number(v) || 0;

export async function ingredients(req, env, db, auth) {
  const rows = await db.all(`SELECT id, name, unit, stock, cost, min_stock, grp, prep, yield FROM ingredients WHERE company_id = ? AND active = true ORDER BY grp NULLS LAST, name`, auth.c);
  const used = await db.all(`SELECT r.ingredient_id, COUNT(*)::int AS n FROM recipes r JOIN products p ON p.id = r.product_id AND p.company_id = r.company_id
    WHERE r.company_id = ? AND p.active = true GROUP BY r.ingredient_id`, auth.c);
  const u = Object.fromEntries(used.map((x) => [x.ingredient_id, x.n]));
  // Zagotovkaning narxi — tarkibidan hisoblangani (hali tayyorlanmagan bo'lsa ham taom tannarxi ma'lum bo'lsin).
  const ic = rows.some((r) => r.prep) ? await ingCosts(db, auth.c) : null;
  return json({ ok: true, ingredients: rows.map((r) => { const cost = r.prep && ic ? ic.get(r.id) || n(r.cost) : n(r.cost); return { ...r, prep: !!r.prep, yield: n(r.yield) || 1, stock: n(r.stock), cost, min_stock: n(r.min_stock),
    value: Math.round(n(r.stock) * (r.prep && n(r.cost) > 0 ? n(r.cost) : cost)), dishes: u[r.id] || 0, low: n(r.stock) <= n(r.min_stock) }; }) });
}

/** Zagotovkalar (yarim tayyor mahsulot) — tarkibi, 1 birlik tannarxi, tayyor qoldig'i. */
export async function preps(req, env, db, auth) {
  const c = auth.c;
  const rows = await db.all('SELECT id, name, unit, stock, cost, min_stock, grp, yield FROM ingredients WHERE company_id = ? AND active = true AND prep = true ORDER BY name', c);
  const lines = await db.all(`SELECT l.prep_id, l.ingredient_id, l.qty, i.name, i.unit, i.cost, i.stock FROM prep_lines l
    JOIN ingredients i ON i.id = l.ingredient_id AND i.company_id = l.company_id WHERE l.company_id = ? ORDER BY i.name`, c);
  const used = await db.all(`SELECT r.ingredient_id, COUNT(*)::int AS n FROM recipes r JOIN products p ON p.id = r.product_id AND p.company_id = r.company_id
    WHERE r.company_id = ? AND p.active = true GROUP BY r.ingredient_id`, c);
  const u = Object.fromEntries(used.map((x) => [x.ingredient_id, x.n]));
  const ic = await ingCosts(db, c);
  return json({ ok: true, preps: rows.map((r) => {
    const ls = lines.filter((l) => l.prep_id === r.id).map((l) => ({ ingredient_id: l.ingredient_id, name: l.name, unit: l.unit, qty: n(l.qty), cost: n(l.cost), stock: n(l.stock), sum: Math.round(n(l.qty) * n(l.cost)) }));
    const y = n(r.yield) || 1; const batch = ls.reduce((s, l) => s + l.sum, 0);
    return { id: r.id, name: r.name, unit: r.unit, grp: r.grp, yield: y, stock: n(r.stock), min_stock: n(r.min_stock), lines: ls, batch_cost: batch,
      cost: Math.round(ic.get(r.id) || 0), no_cost: ls.filter((l) => !(l.cost > 0)).length, dishes: u[r.id] || 0, low: n(r.stock) <= n(r.min_stock) && n(r.min_stock) > 0 };
  }) });
}

/**
 * Zagotovkani saqlash: nomi, o'lchovi, chiqishi (`yield` — shu tarkibdan necha birlik chiqadi) va tarkibi.
 * `id` oddiy elementniki bo'lsa — u zagotovkaga aylanadi (qoldig'i va texkartalardagi o'rni saqlanadi).
 */
export async function savePrep(req, env, db, auth) {
  const b = await body(req); const c = auth.c; const id = int(b.id, 0);
  const name = str(b.name, 80); if (!name) return fail(400, 'need_name', 'Nomi kerak');
  const unit = UNITS.includes(b.unit) ? b.unit : 'kg';
  const y = q3(b.yield); if (!(y > 0)) return fail(400, 'bad_yield', 'Shu tarkibdan qancha chiqishini yozing');
  const min = Math.max(0, q3(b.min_stock)); const grp = str(b.grp, 40);
  const lines = Array.isArray(b.lines) ? b.lines.slice(0, 60) : [];
  if (!lines.length) return fail(400, 'empty', 'Tarkibini yozing — zagotovka nimadan tayyorlanadi');
  const dup = await db.first('SELECT id FROM ingredients WHERE company_id = ? AND active = true AND lower(name) = lower(?) AND id <> ?', c, name, id);
  if (dup) return fail(409, 'duplicate', 'Bunday nomli element yoki zagotovka bor');
  const seen = new Set();
  for (const l of lines) {
    const iid = int(l.ingredient_id);
    if (!(q3(l.qty) > 0)) return fail(400, 'bad_qty', 'Miqdor 0 dan katta bo\'lishi kerak');
    if (iid === id) return fail(400, 'self', 'Zagotovka o\'zining tarkibida bo\'lmaydi');
    if (seen.has(iid)) return fail(400, 'duplicate_line', 'Bir element ikki marta yozilgan');
    seen.add(iid);
    const ing = await db.first('SELECT id, prep FROM ingredients WHERE company_id = ? AND id = ? AND active = true', c, iid);
    if (!ing) return fail(400, 'bad_ingredient', 'Element topilmadi');
    if (ing.prep) return fail(400, 'nested', 'Zagotovka tarkibiga boshqa zagotovka qo\'yilmaydi — oddiy elementlarni yozing');
  }
  if (id) {
    const ex = await db.first('SELECT id, unit FROM ingredients WHERE company_id = ? AND id = ? AND active = true', c, id);
    if (!ex) return fail(404, 'not_found');
    const moved = await db.first('SELECT id FROM stock_moves WHERE company_id = ? AND ingredient_id = ? LIMIT 1', c, id);
    if (moved && ex.unit !== unit) return fail(409, 'unit_locked', 'Harakati bor elementning o\'lchov birligi o\'zgarmaydi');
    if (await db.first('SELECT prep_id FROM prep_lines WHERE company_id = ? AND ingredient_id = ? LIMIT 1', c, id)) return fail(400, 'nested', 'Bu element boshqa zagotovka tarkibida turibdi — avval u yerdan olib tashlang');
  }
  const pid = await db.tx(async (tx) => {
    let rid = id;
    if (id) await tx.run('UPDATE ingredients SET name = ?, unit = ?, min_stock = ?, grp = ?, prep = true, yield = ? WHERE company_id = ? AND id = ?', name, unit, min, grp, y, c, id);
    else rid = (await tx.first('INSERT INTO ingredients (company_id, name, unit, min_stock, grp, prep, yield) VALUES (?, ?, ?, ?, ?, true, ?) RETURNING id', c, name, unit, min, grp, y)).id;
    await tx.run('DELETE FROM prep_lines WHERE company_id = ? AND prep_id = ?', c, rid);
    for (const l of lines) await tx.run('INSERT INTO prep_lines (company_id, prep_id, ingredient_id, qty) VALUES (?, ?, ?, ?)', c, rid, int(l.ingredient_id), q3(l.qty));
    return rid;
  });
  return json({ ok: true, id: pid });
}

/** Zagotovkani yana oddiy elementga qaytarish (tarkibi o'chadi, qoldig'i va texkartalardagi o'rni qoladi). */
export async function unprep(req, env, db, auth) {
  const b = await body(req); const c = auth.c; const id = int(b.id);
  const r = await db.all('UPDATE ingredients SET prep = false, yield = 1 WHERE company_id = ? AND id = ? AND prep = true RETURNING id', c, id);
  if (!r.length) return fail(404, 'not_found');
  await db.run('DELETE FROM prep_lines WHERE company_id = ? AND prep_id = ?', c, id);
  return json({ ok: true });
}

export async function saveIngredient(req, env, db, auth) {
  const b = await body(req); const c = auth.c; const id = int(b.id, 0);
  const name = str(b.name, 80); if (!name) return fail(400, 'need_name', 'Nomi kerak');
  const unit = UNITS.includes(b.unit) ? b.unit : 'kg';
  const min = Math.max(0, q3(b.min_stock)); const grp = str(b.grp, 40);
  const dup = await db.first('SELECT id FROM ingredients WHERE company_id = ? AND active = true AND lower(name) = lower(?) AND id <> ?', c, name, id);
  if (dup) return fail(409, 'duplicate', 'Bunday nomli element bor');
  if (id) {
    const ex = await db.first('SELECT id, unit FROM ingredients WHERE company_id = ? AND id = ?', c, id);
    if (!ex) return fail(404, 'not_found');
    const moved = await db.first('SELECT id FROM stock_moves WHERE company_id = ? AND ingredient_id = ? LIMIT 1', c, id);
    if (moved && ex.unit !== unit) return fail(409, 'unit_locked', 'Harakati bor elementning o\'lchov birligi o\'zgarmaydi');
    await db.run('UPDATE ingredients SET name = ?, unit = ?, min_stock = ?, grp = ? WHERE company_id = ? AND id = ?', name, unit, min, grp, c, id);
    return json({ ok: true, id });
  }
  const r = await db.first('INSERT INTO ingredients (company_id, name, unit, min_stock, grp) VALUES (?, ?, ?, ?, ?) RETURNING id', c, name, unit, min, grp);
  return json({ ok: true, id: r.id });
}

export async function removeIngredient(req, env, db, auth) {
  const b = await body(req);
  const r = await db.all('UPDATE ingredients SET active = false WHERE company_id = ? AND id = ? RETURNING id', auth.c, int(b.id));
  if (!r.length) return fail(404, 'not_found');
  await db.run('DELETE FROM recipes WHERE company_id = ? AND ingredient_id = ?', auth.c, int(b.id));
  await db.run('DELETE FROM prep_lines WHERE company_id = ? AND (ingredient_id = ? OR prep_id = ?)', auth.c, int(b.id), int(b.id));
  await db.run('UPDATE products SET goods_id = NULL WHERE company_id = ? AND goods_id = ?', auth.c, int(b.id));
  return json({ ok: true });
}

/** Texnologik karta: 1 porsiya (yoki 1 kg) uchun elementlar. */
export async function recipe(req, env, db, auth) {
  const pid = int(new URL(req.url).searchParams.get('product_id'));
  const p = await db.first('SELECT id, name, price, unit FROM products WHERE company_id = ? AND id = ?', auth.c, pid);
  if (!p) return fail(404, 'not_found');
  const lines = await db.all(`SELECT r.ingredient_id, r.qty, i.name, i.unit, i.cost FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id AND i.company_id = r.company_id
    WHERE r.company_id = ? AND r.product_id = ? ORDER BY i.name`, auth.c, pid);
  const ic = await ingCosts(db, auth.c);
  const out = lines.map((l) => ({ ...l, qty: n(l.qty), cost: ic.get(l.ingredient_id) ?? n(l.cost) }));
  const cost = Math.round(out.reduce((s, l) => s + l.qty * l.cost, 0));
  return json({ ok: true, product: { ...p, price: n(p.price) }, lines: out, cost });
}

export async function saveRecipe(req, env, db, auth) {
  const b = await body(req); const c = auth.c; const pid = int(b.product_id);
  const p = await db.first('SELECT id, goods_id FROM products WHERE company_id = ? AND id = ?', c, pid);
  if (!p) return fail(404, 'not_found');
  const lines = Array.isArray(b.lines) ? b.lines.slice(0, 60) : [];
  // Tayyor tovarga boshqa texkarta yozilsa — u endi oddiy taom (omborda 1:1 hisoblanmaydi).
  if (p.goods_id && !(lines.length === 1 && int(lines[0].ingredient_id) === p.goods_id && q3(lines[0].qty) === 1)) {
    await db.run('UPDATE products SET goods_id = NULL WHERE company_id = ? AND id = ?', c, pid);
  }
  const seen = new Set();
  for (const l of lines) {
    const iid = int(l.ingredient_id); const q = q3(l.qty);
    if (!(q > 0)) return fail(400, 'bad_qty', 'Miqdor 0 dan katta bo\'lishi kerak');
    if (seen.has(iid)) return fail(400, 'duplicate', 'Bir element ikki marta yozilgan');
    seen.add(iid);
    if (!(await db.first('SELECT id FROM ingredients WHERE company_id = ? AND id = ? AND active = true', c, iid))) return fail(400, 'bad_ingredient', 'Element topilmadi');
  }
  await db.tx(async (tx) => {
    await tx.run('DELETE FROM recipes WHERE company_id = ? AND product_id = ?', c, pid);
    for (const l of lines) await tx.run('INSERT INTO recipes (company_id, product_id, ingredient_id, qty) VALUES (?, ?, ?, ?)', c, pid, int(l.ingredient_id), q3(l.qty));
  });
  return json({ ok: true });
}

/** Menyu bo'yicha tannarx (food cost): har taomning texkarta narxi. */
export async function recipeCosts(req, env, db, auth) {
  const units = await unitCosts(db, auth.c);
  return json({ ok: true, costs: Object.fromEntries([...units].filter(([, u]) => u.lines || u.cost).map(([id, u]) => [id, u])) });
}

/**
 * Hujjat: kirim (yetkazib beruvchidan), utilizatsiya (buzilgan/yaroqsiz), inventarizatsiya (sanoq).
 * Utilizatsiyada tayyor taom ham yozilsa bo'ladi — texkarta bo'yicha elementlari chiqadi.
 */
export async function saveDoc(req, env, db, auth) {
  const b = await body(req); const c = auth.c;
  const kind = ['kirim', 'utilizatsiya', 'inventar', 'tayyorlash'].includes(b.kind) ? b.kind : null;
  if (!kind) return fail(400, 'bad_kind');
  const lines = Array.isArray(b.lines) ? b.lines.slice(0, 300) : [];
  if (!lines.length) return fail(400, 'empty', 'Hujjatda satr yo\'q');
  const reason = str(b.reason, 120);
  if (kind === 'utilizatsiya' && !reason) return fail(400, 'need_reason', 'Utilizatsiya sababi kerak');
  const supplier = int(b.supplier_id, 0) ? await db.first('SELECT id FROM suppliers WHERE company_id = ? AND id = ? AND active = true', c, int(b.supplier_id)) : null;
  if (int(b.supplier_id, 0) && !supplier) return fail(400, 'bad_supplier', 'Yetkazib beruvchi topilmadi');
  const at = b.at && !Number.isNaN(Date.parse(b.at)) && Date.parse(b.at) <= Date.now() + 60e3 ? new Date(b.at).toISOString() : new Date().toISOString();
  const payFrom = ['kassa', 'karta', 'bank', 'boshqa'].includes(b.pay_from) ? b.pay_from : null;

  for (const l of lines) {
    if (kind === 'utilizatsiya' && l.product_id) {
      const pr = await db.first('SELECT p.id, p.name, (SELECT COUNT(*)::int FROM recipes r WHERE r.company_id = p.company_id AND r.product_id = p.id) AS lines FROM products p WHERE p.company_id = ? AND p.id = ?', c, int(l.product_id));
      if (!pr) return fail(400, 'bad_product', 'Taom topilmadi');
      if (!pr.lines) return fail(400, 'no_recipe', `${pr.name} — texnologik kartasi yo'q. Utilizatsiyani element bo'yicha kiriting (masalan, Cola — 1 dona).`);
      if (!(q3(l.qty) > 0)) return fail(400, 'bad_qty', 'Miqdor noto\'g\'ri');
      continue;
    }
    const ing = await db.first('SELECT id, name, prep, (SELECT COUNT(*)::int FROM prep_lines pl WHERE pl.company_id = i.company_id AND pl.prep_id = i.id) AS comp FROM ingredients i WHERE i.company_id = ? AND i.id = ? AND i.active = true', c, int(l.ingredient_id));
    if (!ing) return fail(400, 'bad_ingredient', 'Element topilmadi');
    l.prep = !!ing.prep && ing.comp > 0;
    if (kind === 'tayyorlash' && !l.prep) return fail(400, 'not_prep', `${ing.name} — zagotovka emas yoki tarkibi yozilmagan`);
    if (kind === 'inventar' ? !(q3(l.qty) >= 0) : !(q3(l.qty) > 0)) return fail(400, 'bad_qty', 'Miqdor noto\'g\'ri');
    if (kind === 'kirim' && !(Number(l.price) >= 0)) return fail(400, 'bad_price', 'Narx noto\'g\'ri');
  }
  let shift = null;
  if (kind === 'kirim' && payFrom === 'kassa' && int(b.paid) > 0) {
    shift = await db.first("SELECT id FROM shifts WHERE company_id = ? AND status = 'open' LIMIT 1", c);
    if (!shift) return fail(409, 'no_shift', 'Kassadan to\'lash uchun smena ochiq bo\'lishi kerak');
  }

  const id = await db.tx(async (tx) => {
    const doc = await tx.first(`INSERT INTO stock_docs (company_id, kind, supplier_id, reason, note, pay_from, user_id, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`, c, kind, supplier?.id || null, reason, str(b.note, 300), payFrom, auth.u || null, at);
    let total = 0;
    // Zagotovkalar oddiy elementlardan oldin, keyin raqam tartibida — sotuv bilan bir xil qulf tartibi.
    lines.sort((a, b) => (a.prep ? 0 : 1) - (b.prep ? 0 : 1) || int(a.ingredient_id, 0) - int(b.ingredient_id, 0));
    for (const l of lines) {
      if (kind === 'tayyorlash') {
        total += await produce(tx, c, int(l.ingredient_id), q3(l.qty), { doc_id: doc.id, user_id: auth.u, at });
      } else if (kind === 'kirim') {
        // narx — 1 birlik uchun; summa yaxlitlanib jamlanadi
        const q = q3(l.qty); const price = Number(l.price);
        await moveStock(tx, c, { ingredient_id: int(l.ingredient_id), kind, qty: q, price, doc_id: doc.id, user_id: auth.u, at });
        total += Math.round(q * price);
      } else if (kind === 'utilizatsiya') {
        if (l.product_id) {
          await consume(tx, c, [{ product_id: int(l.product_id), qty: q3(l.qty) }], { kind, doc_id: doc.id, user_id: auth.u, at });
        } else if (l.prep) {
          // Tayyori bo'lsa o'shandan, yetmagani tarkibidagi elementlardan (sotuvdagi kabi)
          await applyNeeds(tx, c, new Map([[`0:${int(l.ingredient_id)}`, q3(l.qty)]]), { kind, doc_id: doc.id, user_id: auth.u, at });
        } else {
          const r = await moveStock(tx, c, { ingredient_id: int(l.ingredient_id), kind, qty: -q3(l.qty), doc_id: doc.id, user_id: auth.u, at });
          total += Math.round(q3(l.qty) * (r?.unit || 0));
        }
      } else {
        const ing = await tx.first('SELECT stock FROM ingredients WHERE company_id = ? AND id = ?', c, int(l.ingredient_id));
        const diff = q3(q3(l.qty) - n(ing.stock));
        if (diff) await moveStock(tx, c, { ingredient_id: int(l.ingredient_id), kind, qty: diff, doc_id: doc.id, user_id: auth.u, at, note: `sanoq: ${q3(l.qty)}` });
      }
    }
    if (kind !== 'kirim' && kind !== 'tayyorlash') {
      const s = await tx.first('SELECT COALESCE(SUM(qty * cost), 0)::float8 AS v FROM stock_moves WHERE company_id = ? AND doc_id = ?', c, doc.id);
      total = Math.round(Math.abs(n(s.v)));
    }
    const paid = kind === 'kirim' ? Math.max(0, Math.min(total, int(b.paid))) : 0;
    await tx.run('UPDATE stock_docs SET total = ?, paid = ? WHERE company_id = ? AND id = ?', total, paid, c, doc.id);
    if (kind === 'kirim' && !supplier && paid && payFrom === 'kassa') {
      await tx.run(`INSERT INTO cash_moves (company_id, id, shift_id, kind, amount, reason, user_id, at) VALUES (?, ?, ?, 'chiqim', ?, ?, ?, ?)`,
        c, `kirim${c}-${doc.id}`, shift.id, paid, `Kirim #${doc.id} uchun to'lov`, auth.u, at);
    }
    if (kind === 'kirim' && supplier) {
      await tx.run("INSERT INTO supplier_moves (company_id, supplier_id, kind, amount, doc_id, user_id, at) VALUES (?, ?, 'kirim', ?, ?, ?, ?)", c, supplier.id, total, doc.id, auth.u, at);
      if (paid) await tx.run("INSERT INTO supplier_moves (company_id, supplier_id, kind, amount, doc_id, pay_from, shift_id, user_id, at) VALUES (?, ?, 'tolov', ?, ?, ?, ?, ?, ?)",
        c, supplier.id, paid, doc.id, payFrom, shift?.id || null, auth.u, at);
      await tx.run('UPDATE suppliers SET debt = debt + ? WHERE company_id = ? AND id = ?', total - paid, c, supplier.id);
    }
    return doc.id;
  });
  return json({ ok: true, id });
}

export async function docs(req, env, db, auth) {
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind');
  const from = url.searchParams.get('from'); const to = url.searchParams.get('to') || from;
  if (!isDay(from) || !isDay(to)) return fail(400, 'bad_range', 'Sana noto\'g\'ri');
  const [f, t] = dayRange(from, to);
  const rows = await db.all(`SELECT d.id, d.kind, d.reason, d.note, d.total::float8 AS total, d.paid::float8 AS paid, d.pay_from, d.at, d.cancelled_at,
    s.name AS supplier, u.name AS user_name, (SELECT COUNT(*)::int FROM stock_moves m WHERE m.company_id = d.company_id AND m.doc_id = d.id AND m.kind <> 'bekor') AS lines
    FROM stock_docs d LEFT JOIN suppliers s ON s.id = d.supplier_id AND s.company_id = d.company_id LEFT JOIN users u ON u.id = d.user_id AND u.company_id = d.company_id
    WHERE d.company_id = ? AND d.at >= ? AND d.at < ? AND (? = '' OR d.kind = ?) ORDER BY d.at DESC LIMIT 500`, auth.c, f, t, kind || '', kind || '');
  return json({ ok: true, docs: rows });
}

export async function doc(req, env, db, auth) {
  const id = int(new URL(req.url).searchParams.get('id'));
  const d = await db.first(`SELECT d.*, d.total::float8 AS total, d.paid::float8 AS paid, s.name AS supplier, u.name AS user_name FROM stock_docs d
    LEFT JOIN suppliers s ON s.id = d.supplier_id AND s.company_id = d.company_id LEFT JOIN users u ON u.id = d.user_id AND u.company_id = d.company_id
    WHERE d.company_id = ? AND d.id = ?`, auth.c, id);
  if (!d) return fail(404, 'not_found');
  const moves = await db.all(`SELECT m.id, m.kind, m.qty, m.cost, m.product_id, m.note, i.name, i.unit, p.name AS product
    FROM stock_moves m JOIN ingredients i ON i.id = m.ingredient_id AND i.company_id = m.company_id
    LEFT JOIN products p ON p.id = m.product_id AND p.company_id = m.company_id WHERE m.company_id = ? AND m.doc_id = ? ORDER BY m.id`, auth.c, id);
  return json({ ok: true, doc: d, moves: moves.map((m) => ({ ...m, qty: n(m.qty), cost: n(m.cost), sum: Math.round(n(m.qty) * n(m.cost)) })) });
}

/** Xato hujjatni bekor qilish: harakatlar teskari yoziladi (o'chirilmaydi), yetkazib beruvchi qarzi qaytadi. */
export async function cancelDoc(req, env, db, auth) {
  const b = await body(req); const c = auth.c; const id = int(b.id);
  const r = await db.tx(async (tx) => {
    const d = await tx.first('SELECT * FROM stock_docs WHERE company_id = ? AND id = ? FOR UPDATE', c, id);
    if (!d) return 'not_found';
    if (d.cancelled_at) return 'already';
    const moves = await tx.all("SELECT ingredient_id, qty, cost, product_id FROM stock_moves WHERE company_id = ? AND doc_id = ? AND kind <> 'bekor' ORDER BY ingredient_id", c, id);
    const at = new Date().toISOString();
    for (const m of moves) {
      await moveStock(tx, c, { ingredient_id: m.ingredient_id, kind: 'bekor', qty: -n(m.qty), unit_cost: n(m.cost), doc_id: id, product_id: m.product_id, user_id: auth.u, at, note: `#${id} bekor` });
    }
    if (d.kind === 'kirim' && d.supplier_id) {
      // To'langan qismi qaytmaydi — u endi yetkazib beruvchining bizga qarzi (balans manfiy bo'ladi).
      const total = n(d.total);
      await tx.run("INSERT INTO supplier_moves (company_id, supplier_id, kind, amount, doc_id, user_id, at, note) VALUES (?, ?, 'bekor', ?, ?, ?, ?, ?)", c, d.supplier_id, -total, id, auth.u, at,
        n(d.paid) ? `Kirim #${id} bekor qilindi — to'langan ${Math.round(n(d.paid))} so'm yetkazib beruvchidan qaytarilishi kerak` : `Kirim #${id} bekor qilindi`);
      await tx.run('UPDATE suppliers SET debt = debt - ? WHERE company_id = ? AND id = ?', total, c, d.supplier_id);
    }
    await tx.run('UPDATE stock_docs SET cancelled_at = ?, cancelled_by = ? WHERE company_id = ? AND id = ?', at, auth.u, c, id);
    return 'ok';
  });
  if (r === 'not_found') return fail(404, 'not_found');
  if (r === 'already') return fail(409, 'already', 'Hujjat allaqachon bekor qilingan');
  return json({ ok: true });
}

export async function moves(req, env, db, auth) {
  const url = new URL(req.url);
  const iid = int(url.searchParams.get('ingredient_id'));
  const from = url.searchParams.get('from'); const to = url.searchParams.get('to') || from;
  if (!isDay(from) || !isDay(to)) return fail(400, 'bad_range', 'Sana noto\'g\'ri');
  const [f, t] = dayRange(from, to);
  const rows = await db.all(`SELECT m.id, m.kind, m.qty, m.cost, m.balance, m.at, m.doc_id, m.order_id, m.note, p.name AS product, u.name AS user_name, o.number
    FROM stock_moves m LEFT JOIN products p ON p.id = m.product_id AND p.company_id = m.company_id
    LEFT JOIN users u ON u.id = m.user_id AND u.company_id = m.company_id LEFT JOIN orders o ON o.id = m.order_id AND o.company_id = m.company_id
    WHERE m.company_id = ? AND m.ingredient_id = ? AND m.at >= ? AND m.at < ? ORDER BY m.id DESC LIMIT 1000`, auth.c, iid, f, t);
  return json({ ok: true, moves: rows.map((m) => ({ ...m, qty: n(m.qty), cost: n(m.cost), balance: n(m.balance) })) });
}

/**
 * Moddiy hisobot: har element bo'yicha davr boshidagi qoldiq + kirim − sarf (sotuv) − utilizatsiya ± inventarizatsiya = davr oxiri.
 * Boshi va oxiri — davr chegarasidan oldingi oxirgi harakatdagi qoldiq va o'rtacha narx;
 * summalar shu narxlarda, shuning uchun har qator aniq balanslanadi.
 */
export async function material(req, env, db, auth) {
  const url = new URL(req.url);
  const from = url.searchParams.get('from'); const to = url.searchParams.get('to') || from;
  if (!isDay(from) || !isDay(to) || to < from) return fail(400, 'bad_range', 'Sana noto\'g\'ri');
  const [f, t] = dayRange(from, to); const c = auth.c;
  const ings = await db.all('SELECT id, name, unit, grp, stock, cost, min_stock, active FROM ingredients WHERE company_id = ? ORDER BY grp NULLS LAST, name', c);
  // Chegaradagi qoldiq — shu paytgacha bo'lgan HAMMA harakatlar yig'indisi (kech sinxronlangan
  // oflayn buyurtma tartibni buzmasin); narx — chegaradan oldingi oxirgi harakatdagi o'rtacha.
  const edge = async (at) => {
    const q = await db.all('SELECT ingredient_id, SUM(qty)::float8 AS q FROM stock_moves WHERE company_id = ? AND at < ? GROUP BY ingredient_id', c, at);
    const a = Object.fromEntries((await db.all(`SELECT DISTINCT ON (ingredient_id) ingredient_id, avg FROM stock_moves
      WHERE company_id = ? AND at < ? ORDER BY ingredient_id, at DESC, id DESC`, c, at)).map((r) => [r.ingredient_id, n(r.avg)]));
    return Object.fromEntries(q.map((r) => { const qq = Math.round(n(r.q) * 1000) / 1000; return [r.ingredient_id, { q: qq, v: qq * (a[r.ingredient_id] || 0) }]; }));
  };
  const start = await edge(f); const end = await edge(t);
  const sums = await db.all(`SELECT ingredient_id, kind, SUM(qty)::float8 AS q, SUM(qty * cost)::float8 AS v FROM stock_moves
    WHERE company_id = ? AND at >= ? AND at < ? GROUP BY ingredient_id, kind`, c, f, t);
  const by = {};
  for (const s of sums) (by[s.ingredient_id] ||= {})[s.kind] = { q: n(s.q), v: n(s.v) };
  const rows = [];
  const tot = { open_v: 0, in_v: 0, used_v: 0, waste_v: 0, inv_v: 0, close_v: 0 };
  for (const i of ings) {
    const m = by[i.id] || {};
    const s0 = start[i.id] || { q: 0, v: 0 }; const s1 = end[i.id] || { q: 0, v: 0 };
    if (!i.active && !Object.keys(m).length && !s1.q) continue;
    const g = (k) => m[k] || { q: 0, v: 0 };
    // «Tayyorlash»: zagotovkaga — kirim, tarkibidagi elementga — sarf (zagotovkaga ketdi).
    const made = g('tayyorlash');
    const kirim = { q: g('kirim').q + Math.max(0, made.q), v: g('kirim').v + Math.max(0, made.v) };
    const sotuv = { q: g('sotuv').q + Math.min(0, made.q), v: g('sotuv').v + Math.min(0, made.v) };
    const util = g('utilizatsiya'); const inv = g('inventar');
    const other = { q: g('bekor').q + g('qaytish').q + g('tuzatish').q, v: g('bekor').v + g('qaytish').v + g('tuzatish').v };
    const row = {
      id: i.id, name: i.name, unit: i.unit, grp: i.grp,
      open_q: q3(s0.q), open_v: Math.round(s0.v), in_q: q3(kirim.q), in_v: Math.round(kirim.v),
      used_q: q3(-sotuv.q), used_v: Math.round(-sotuv.v), waste_q: q3(-util.q), waste_v: Math.round(-util.v),
      inv_q: q3(inv.q + other.q), inv_v: 0, close_q: q3(s1.q), close_v: Math.round(s1.v),
      low: s1.q <= n(i.min_stock),
    };
    // Inventarizatsiya / bekor / narx farqi — qoldiq sifatida: qator har doim aniq balanslansin
    // (manfiy qoldiqqa kirim kelganda o'rtacha narx qayta hisoblanadi, farq shu ustunga tushadi).
    row.inv_v = row.close_v - row.open_v - row.in_v + row.used_v + row.waste_v;
    rows.push(row);
    for (const k of Object.keys(tot)) tot[k] += row[k];
  }
  // Qaysi taomga qancha ketdi (sarfning taqsimoti)
  const dishes = await db.all(`SELECT p.name AS product, i.name AS ingredient, i.unit, ROUND(SUM(-m.qty)::numeric, 3)::float8 AS q, SUM(-m.qty * m.cost)::float8 AS v
    FROM stock_moves m JOIN ingredients i ON i.id = m.ingredient_id AND i.company_id = m.company_id
    LEFT JOIN products p ON p.id = m.product_id AND p.company_id = m.company_id
    WHERE m.company_id = ? AND m.kind = 'sotuv' AND m.at >= ? AND m.at < ? GROUP BY p.name, i.name, i.unit ORDER BY v DESC LIMIT 500`, c, f, t);
  // Pul xulosasi (rahbar bitta ekranda ko'rsin): savdo, sof foyda, utilizatsiya, xodimlar olgani — shu DAVR uchun,
  // "Foyda" hisoboti bilan bir xil hisob. Kassadagi naqd pul esa HOZIRGI holat (ochiq smena), davrga bog'liq emas;
  // smena yopiq bo'lsa null.
  const pm = await periodMoney(db, c, f, t);
  const sh = await currentShift(db, c);
  let cash = null;
  if (sh) {
    const orders = (await db.all("SELECT doc FROM orders WHERE company_id = ? AND shift_id = ? AND status <> 'open'", c, sh.id)).map((r) => r.doc);
    cash = shiftSummary(sh, orders, await shiftMoves(db, c, sh.id)).expected_cash;
  }
  const money = { ...pm.totals, cash, shift_number: sh?.number ?? null };
  return json({ ok: true, from, to, rows, totals: tot, money, dishes: dishes.map((d) => ({ ...d, q: n(d.q), v: Math.round(n(d.v)) })) });
}

/** "Bugun omborda": nima keldi, nima ishlatildi, nima utilizatsiya qilindi, qancha qoldi. */
export async function today(req, env, db, auth) {
  const day = new URL(req.url).searchParams.get('day');
  if (!isDay(day)) return fail(400, 'bad_day', 'Sana noto\'g\'ri');
  const [f, t] = dayRange(day, day); const c = auth.c;
  const rows = await db.all(`SELECT i.id, i.name, i.unit, i.stock, i.cost, i.min_stock,
    ROUND(COALESCE(SUM(m.qty) FILTER (WHERE m.kind = 'kirim' OR (m.kind = 'tayyorlash' AND m.qty > 0)), 0)::numeric, 3)::float8 AS in_q, COALESCE(SUM(m.qty * m.cost) FILTER (WHERE m.kind = 'kirim' OR (m.kind = 'tayyorlash' AND m.qty > 0)), 0)::float8 AS in_v,
    ROUND(COALESCE(-SUM(m.qty) FILTER (WHERE m.kind = 'sotuv' OR (m.kind = 'tayyorlash' AND m.qty < 0)), 0)::numeric, 3)::float8 AS used_q, COALESCE(-SUM(m.qty * m.cost) FILTER (WHERE m.kind = 'sotuv' OR (m.kind = 'tayyorlash' AND m.qty < 0)), 0)::float8 AS used_v,
    ROUND(COALESCE(-SUM(m.qty) FILTER (WHERE m.kind = 'utilizatsiya'), 0)::numeric, 3)::float8 AS waste_q, COALESCE(-SUM(m.qty * m.cost) FILTER (WHERE m.kind = 'utilizatsiya'), 0)::float8 AS waste_v
    FROM ingredients i LEFT JOIN stock_moves m ON m.ingredient_id = i.id AND m.company_id = i.company_id AND m.at >= ? AND m.at < ?
    WHERE i.company_id = ? AND i.active = true GROUP BY i.id ORDER BY used_v DESC, i.name`, f, t, c);
  const list = rows.map((r) => ({ ...r, stock: n(r.stock), cost: n(r.cost), min_stock: n(r.min_stock), in_v: Math.round(r.in_v), used_v: Math.round(r.used_v), waste_v: Math.round(r.waste_v), low: n(r.stock) <= n(r.min_stock) }));
  const sum = (k) => list.reduce((s, r) => s + r[k], 0);
  return json({ ok: true, day, rows: list, totals: { in_v: sum('in_v'), used_v: sum('used_v'), waste_v: sum('waste_v'),
    stock_v: Math.round(list.reduce((s, r) => s + Math.max(0, r.stock) * r.cost, 0)), low: list.filter((r) => r.low).length } });
}
