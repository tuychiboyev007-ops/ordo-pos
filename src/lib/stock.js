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
  qaytish: 'Qaytdi', bekor: 'Hujjat bekor qilindi', tuzatish: 'Tuzatish', tayyorlash: 'Zagotovka tayyorlash',
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
export async function consume(tx, company, items, { kind = 'sotuv', order_id = null, doc_id = null, user_id = null, at, sign = -1, extra = [] } = {}) {
  const ids = [...new Set(items.map((i) => i.product_id).filter(Boolean))];
  const recipe = ids.length ? await tx.all(`SELECT product_id, ingredient_id, qty FROM recipes WHERE company_id = ? AND product_id IN (${ids.map(() => '?').join(',')})`, company, ...ids) : [];
  if (!recipe.length && !extra.length) return 0;
  const need = new Map(); // product:ingredient → qty
  // Qo'shimchalar (pishloq...) masalligi: [{ product_id, ingredient_id, qty }]
  for (const x of extra) { const k = `${x.product_id || 0}:${x.ingredient_id}`; need.set(k, (need.get(k) || 0) + Number(x.qty)); }
  for (const it of items) {
    for (const r of recipe) {
      if (r.product_id !== it.product_id) continue;
      const k = `${r.product_id}:${r.ingredient_id}`;
      need.set(k, (need.get(k) || 0) + Number(r.qty) * Number(it.qty));
    }
  }
  return applyNeeds(tx, company, need, { kind, order_id, doc_id, user_id, at, sign });
}

/**
 * need — Map("taom:masalliq" → miqdor). Zagotovka (yarim tayyor) bo'lsa:
 *   omborda TAYYORI bor — o'shandan olinadi; yetmagan qismi tarkibidagi masalliqlardan ayiriladi
 *   (egasi «Tayyorlash» hujjatini yuritmasa ham ombor to'g'ri kamayadi; yuritsa — tayyor kotlet soni ham ko'rinadi).
 * Zagotovkalar har doim oddiy masalliqlardan OLDIN qulflanadi (ikki kassa va «Tayyorlash» bir vaqtda ishlasa tiqilmasin).
 */
export async function applyNeeds(tx, company, need, { kind = 'sotuv', order_id = null, doc_id = null, user_id = null, at, sign = -1 } = {}) {
  const idOf = (k) => Number(k.split(':')[1]);
  const iids = [...new Set([...need.keys()].map(idOf))];
  if (!iids.length) return 0;
  const preps = sign < 0 ? await tx.all(`SELECT id, yield FROM ingredients WHERE company_id = ? AND prep = true AND id IN (${iids.map(() => '?').join(',')}) ORDER BY id`, company, ...iids) : [];
  const done = new Set();
  let n = 0;
  if (preps.length) {
    const pl = await tx.all(`SELECT prep_id, ingredient_id, qty FROM prep_lines WHERE company_id = ? AND prep_id IN (${preps.map(() => '?').join(',')})`, company, ...preps.map((p) => p.id));
    for (const p of preps) {
      const lines = pl.filter((l) => l.prep_id === p.id);
      if (!lines.length) continue; // tarkibi yozilmagan — oddiy masalliqdek
      const row = await tx.first('SELECT stock FROM ingredients WHERE company_id = ? AND id = ? FOR UPDATE', company, p.id);
      let avail = Math.max(0, Number(row.stock));
      const y = Number(p.yield) > 0 ? Number(p.yield) : 1;
      for (const k of [...need.keys()].filter((x) => idOf(x) === p.id).sort()) {
        const want = need.get(k); const take = q3(Math.min(avail, want)); const rest = want - take;
        const pid = Number(k.split(':')[0]);
        done.add(k);
        if (take > 0) {
          avail = q3(avail - take);
          await moveStock(tx, company, { ingredient_id: p.id, kind, qty: -take, order_id, doc_id, product_id: pid || null, user_id, at }); n++;
        }
        if (rest > 0.0005) for (const l of lines) { const kk = `${pid}:${l.ingredient_id}`; need.set(kk, (need.get(kk) || 0) + (rest * Number(l.qty)) / y); }
      }
    }
  }
  // Qulflar bir xil tartibda olinsin (ikki kassa bir vaqtda yopsa ham tiqilib qolmasin).
  const keys = [...need.keys()].filter((k) => !done.has(k)).sort((a, b) => idOf(a) - idOf(b));
  for (const k of keys) {
    const pid = Number(k.split(':')[0]);
    await moveStock(tx, company, { ingredient_id: idOf(k), kind, qty: sign * need.get(k), order_id, doc_id, product_id: pid || null, user_id, at });
    n++;
  }
  return n;
}

/**
 * «Tayyorlash»: qty birlik zagotovka tayyorlandi — tarkibidagi masalliqlar ombordan chiqadi, zagotovka kiradi.
 * Narxi — chiqqan masalliqlarning shu paytdagi o'rtacha narxidan. Qaytaradi: tayyorlangan partiyaning tannarxi (so'm).
 */
export async function produce(tx, company, prepId, qty, { doc_id = null, user_id = null, at } = {}) {
  const prep = await tx.first('SELECT id, name, yield FROM ingredients WHERE company_id = ? AND id = ? AND prep = true FOR UPDATE', company, prepId);
  if (!prep) throw Object.assign(new Error('no_prep'), { code: 'no_prep' });
  const lines = await tx.all('SELECT ingredient_id, qty FROM prep_lines WHERE company_id = ? AND prep_id = ? ORDER BY ingredient_id', company, prepId);
  const y = Number(prep.yield) > 0 ? Number(prep.yield) : 1;
  let cost = 0;
  for (const l of lines) {
    const out = q3((Number(l.qty) * qty) / y);
    if (!out) continue;
    const r = await moveStock(tx, company, { ingredient_id: l.ingredient_id, kind: 'tayyorlash', qty: -out, doc_id, user_id, at, note: `${prep.name} uchun` });
    cost += out * (r?.unit || 0);
  }
  await moveStock(tx, company, { ingredient_id: prepId, kind: 'tayyorlash', qty, price: qty ? cost / qty : 0, doc_id, user_id, at });
  return Math.round(cost);
}
