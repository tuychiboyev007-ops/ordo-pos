/**
 * Taom tannarxi va foyda — bitta joyda.
 *
 * 1 dona (porsiya) tannarxi:
 *   - texnologik karta bo'lsa va masalliqlar narxi ma'lum bo'lsa — masalliqlarning o'rtacha kirim narxidan;
 *   - aks holda egasi qo'lda yozgan products.cost (Cola kabi tayyor sotiladigan narsa uchun).
 *
 * Buyurtma yopilganda shu paytdagi tannarx order_items.cost ga yoziladi — keyin kirim narxi
 * o'zgarsa ham o'tgan savdoning foydasi o'zgarmaydi. Yozilmagan (tannarx noma'lum bo'lgan)
 * satrlar uchun hisobotda hozirgi tannarx olinadi.
 */
const n = (v) => Number(v) || 0;

/**
 * Har masalliqning 1 birlik narxi. Zagotovka (yarim tayyor) uchun — tarkibidagi masalliqlarning HOZIRGI narxidan:
 * (Σ miqdor × narx) ÷ chiqishi. Tarkibdagi biror masalliq narxi noma'lum bo'lsa — zagotovkaning o'z o'rtacha narxi
 * (oxirgi «Tayyorlash» hujjatidan). Zagotovka ichida zagotovka bo'lmaydi, shuning uchun bitta o'tish yetarli.
 */
export async function ingCosts(db, c) {
  const ings = await db.all('SELECT id, cost::float8 AS cost, prep, yield::float8 AS yield FROM ingredients WHERE company_id = ?', c);
  const map = new Map(ings.map((i) => [i.id, n(i.cost)]));
  if (!ings.some((i) => i.prep)) return map;
  const lines = await db.all('SELECT prep_id, ingredient_id, qty::float8 AS qty FROM prep_lines WHERE company_id = ?', c);
  const own = new Map(map);
  for (const i of ings) {
    if (!i.prep) continue;
    const ls = lines.filter((l) => l.prep_id === i.id);
    if (!ls.length || ls.some((l) => !((own.get(l.ingredient_id) || 0) > 0))) continue;
    map.set(i.id, ls.reduce((s, l) => s + n(l.qty) * own.get(l.ingredient_id), 0) / (n(i.yield) > 0 ? n(i.yield) : 1));
  }
  return map;
}

export async function unitCosts(db, c) {
  const ic = await ingCosts(db, c);
  const byProduct = new Map();
  for (const r of await db.all('SELECT product_id, ingredient_id, qty::float8 AS qty FROM recipes WHERE company_id = ?', c)) {
    const x = byProduct.get(r.product_id) || { product_id: r.product_id, lines: 0, missing: 0, cost: 0 };
    const unit = ic.get(r.ingredient_id) || 0;
    x.lines++; if (!(unit > 0)) x.missing++; x.cost += n(r.qty) * unit;
    byProduct.set(r.product_id, x);
  }
  const rec = [...byProduct.values()];
  const prods = await db.all('SELECT id, cost::float8 AS cost FROM products WHERE company_id = ?', c);
  const map = new Map();
  for (const p of prods) {
    const manual = Math.round(n(p.cost));
    map.set(p.id, { manual, recipe: 0, lines: 0, cost: manual, src: manual > 0 ? 'qolda' : null });
  }
  for (const r of rec) {
    const m = map.get(r.product_id) || { manual: 0 };
    const recipe = Math.round(n(r.cost));
    // Texkartadagi ba'zi masalliqlar hali kirim qilinmagan (narxi 0) — hisob chala. Qo'lda yozilgan tannarx bo'lsa, o'sha olinadi.
    const full = recipe > 0 && !r.missing;
    const cost = full ? recipe : m.manual > 0 ? m.manual : recipe;
    const src = full ? 'texkarta' : m.manual > 0 ? 'qolda' : recipe > 0 ? 'texkarta_chala' : null;
    map.set(r.product_id, { ...m, recipe, lines: r.lines, missing: r.missing, cost, src });
  }
  return map;
}

/** Davrdagi yopilgan buyurtmalar bo'yicha har taomning savdosi va tannarxi. f, t — UTC ISO. */
export async function salesCost(db, c, f, t) {
  const units = await unitCosts(db, c);
  const rows = await db.all(`SELECT i.product_id, MIN(i.name) AS name, MIN(i.unit) AS unit, SUM(i.qty)::float8 AS qty, SUM(i.sum)::float8 AS revenue,
      SUM(CASE WHEN i.cost IS NOT NULL THEN i.qty * i.cost ELSE 0 END)::float8 AS cost_known,
      SUM(CASE WHEN i.cost IS NULL THEN i.qty ELSE 0 END)::float8 AS qty_nocost
    FROM order_items i JOIN orders o ON o.id = i.order_id AND o.company_id = i.company_id
    WHERE i.company_id = ? AND o.status = 'closed' AND i.status <> 'cancelled' AND o.closed_at >= ? AND o.closed_at < ?
    GROUP BY i.product_id, CASE WHEN i.product_id IS NULL THEN i.name END`, c, f, t);
  const items = rows.map((r) => {
    const u = r.product_id ? units.get(r.product_id) : null;
    const cost = Math.round(n(r.cost_known) + n(r.qty_nocost) * (u?.cost || 0));
    const revenue = Math.round(n(r.revenue));
    const qty = Math.round(n(r.qty) * 1000) / 1000;
    return { product_id: r.product_id, name: r.name, unit: r.unit, qty, revenue, cost, unit_cost: qty ? Math.round(cost / qty) : 0,
      profit: revenue - cost, no_cost: !!r.product_id && cost === 0, src: u?.src || null };
  });
  return { items, cost: items.reduce((s, x) => s + x.cost, 0), revenue: items.reduce((s, x) => s + x.revenue, 0) };
}
