/**
 * Ombor harakati — bitta joy.
 *
 * Tannarx — og'irlikli o'rtacha: kirimda (eski qoldiq × eski narx + kelgan × yangi narx) ÷ jami.
 * Chiqim (sotuv, utilizatsiya) shu paytdagi o'rtacha narxda baholanadi.
 * Har harakatga keyingi qoldiq (balance) va o'rtacha narx (avg) yoziladi: moddiy hisobot
 * istalgan sanadagi qoldiqni oxirgi harakatdan aniq o'qiydi.
 *
 * Qoldiq manfiyga tushishi MUMKIN — oshxona kirim kiritilmagan masalliqdan ham taom tayyorlaydi,
 * kassa buning uchun sotuvni to'xtatmasligi kerak. Manfiy qoldiq panelda qizil ko'rinadi.
 */
export const IN_KINDS = ['kirim'];
export const KIND_NAMES = {
  kirim: 'Kirim', sotuv: 'Sotuv (taomga ketdi)', utilizatsiya: 'Utilizatsiya', inventar: 'Inventarizatsiya',
  qaytish: 'Qaytdi', bekor: 'Hujjat bekor qilindi', tuzatish: 'Tuzatish',
};

export const q3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

/** price — faqat kirimda: 1 birlik narxi (so'm). */
export async function moveStock(tx, company, m) {
  const ing = await tx.first('SELECT id, stock, cost FROM ingredients WHERE company_id = ? AND id = ? FOR UPDATE', company, m.ingredient_id);
  if (!ing) throw Object.assign(new Error('no_ingredient'), { code: 'no_ingredient' });
  const stock = Number(ing.stock); const cost = Number(ing.cost);
  const qty = q3(m.qty);
  if (!qty) return null;
  let unit = cost; let avg = cost;
  if (qty > 0 && m.price != null) {
    unit = Math.max(0, Number(m.price));
    avg = stock > 0 ? (stock * cost + qty * unit) / (stock + qty) : unit;
  } else if (qty > 0 && m.unit_cost != null) {
    // qaytish / bekor — chiqib ketgan narxida qaytadi
    unit = Number(m.unit_cost);
    avg = stock > 0 ? (stock * cost + qty * unit) / (stock + qty) : unit;
  } else if (qty < 0 && m.unit_cost != null) {
    // Kirim bekor qilindi — o'sha kirim narxida chiqadi va o'rtacha narx kirimdan oldingi holatga qaytadi.
    unit = Number(m.unit_cost);
    const rest = stock + qty;
    avg = rest > 0 && stock > 0 ? Math.max(0, (stock * cost + qty * unit) / rest) : cost;
  }
  const balance = q3(stock + qty);
  await tx.run('UPDATE ingredients SET stock = ?, cost = ? WHERE company_id = ? AND id = ?', balance, avg, company, ing.id);
  await tx.run(`INSERT INTO stock_moves (company_id, ingredient_id, kind, qty, cost, balance, avg, doc_id, order_id, product_id, note, user_id, at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, company, ing.id, m.kind, qty, unit, balance, avg, m.doc_id ?? null,
  m.order_id ?? null, m.product_id ?? null, m.note ?? null, m.user_id ?? null, m.at || new Date().toISOString());
  return { balance, avg, unit };
}

/**
 * Taom sotilganda texnologik karta bo'yicha masalliqlar ombordan ayiriladi.
 * items — [{ product_id, qty }]. Har (taom, masalliq) juftligi alohida harakat —
 * hisobotda "go'sht qaysi taomga ketdi" ko'rinadi.
 */
export async function consume(tx, company, items, { kind = 'sotuv', order_id = null, doc_id = null, user_id = null, at, sign = -1 } = {}) {
  const ids = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
  if (!ids.length) return 0;
  const recipe = await tx.all(`SELECT product_id, ingredient_id, qty FROM recipes WHERE company_id = ? AND product_id IN (${ids.map(() => '?').join(',')})`, company, ...ids);
  if (!recipe.length) return 0;
  const need = new Map(); // product:ingredient → qty
  for (const it of items) {
    for (const r of recipe) {
      if (r.product_id !== it.product_id) continue;
      const k = `${r.product_id}:${r.ingredient_id}`;
      need.set(k, (need.get(k) || 0) + Number(r.qty) * Number(it.qty));
    }
  }
  // Qulflar bir xil tartibda olinsin (ikki kassa bir vaqtda yopsa ham tiqilib qolmasin).
  const keys = [...need.keys()].sort((a, b) => Number(a.split(':')[1]) - Number(b.split(':')[1]));
  let n = 0;
  for (const k of keys) {
    const [pid, iid] = k.split(':').map(Number);
    await moveStock(tx, company, { ingredient_id: iid, kind, qty: sign * need.get(k), order_id, doc_id, product_id: pid, user_id, at });
    n++;
  }
  return n;
}
