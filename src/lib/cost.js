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

export async function unitCosts(db, c) {
  const rec = await db.all(`SELECT r.product_id, COUNT(*)::int AS lines, COUNT(*) FILTER (WHERE i.cost <= 0)::int AS missing, SUM(r.qty * i.cost)::float8 AS cost
    FROM recipes r JOIN ingredients i ON i.id = r.ingredient_id AND i.company_id = r.company_id WHERE r.company_id = ? GROUP BY r.product_id`, c);
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
