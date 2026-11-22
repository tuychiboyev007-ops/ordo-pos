/**
 * ordo — buyurtma yadrosi.
 *
 * Kassa (brauzer) va server AYNAN shu faylni ishlatadi: buyurtmaga qilingan
 * har bir amal ("op") avval kassaning o'zida qo'llanadi — internet bo'lmasa
 * ham ish to'xtamaydi — keyin serverga yuboriladi va u yerda xuddi shu
 * funksiya bilan qayta qo'llanadi. Hisob ikki joyda alohida yozilsa,
 * bir kun kelib kassadagi jami bilan hisobotdagi jami farq qilib qolardi.
 *
 * Qoidalar:
 *  - pul — so'mda, butun son;
 *  - miqdor — 3 xonagacha kasr (kg bilan sotiladigan taom uchun);
 *  - oshxonaga yuborilgan taomni o'zgartirib bo'lmaydi, faqat bekor qilinadi,
 *    va bunga menejer ruxsati kerak (pulni yashirishning eng ko'p usuli shu);
 *  - har amal bir martagina qo'llanadi: takror kelgan op o'zgarish qilmaydi.
 */

export const ORDER_TYPES = ['zal', 'olib', 'yetkazish', 'bot'];
export const TYPE_NAMES = { zal: 'Zalda', olib: 'Olib ketish', yetkazish: 'Yetkazish', bot: 'Bot' };
export const PAY_METHODS = ['naqd', 'karta', 'click', 'payme', 'uzum', 'qarz'];
export const PAY_NAMES = { naqd: 'Naqd', karta: 'Karta', click: 'Click', payme: 'Payme', uzum: 'Uzum', qarz: 'Qarzga' };
export const ROLES = ['owner', 'admin', 'kassir', 'ofitsiant', 'oshpaz'];
export const ROLE_NAMES = { owner: 'Egasi', admin: 'Menejer', kassir: 'Kassir', ofitsiant: 'Ofitsiant', oshpaz: 'Oshpaz' };
export const MANAGER_ROLES = ['owner', 'admin'];

/**
 * Telegram botdan kelgan buyurtma holati (botdagi bilan bir xil). Kassa oldinga suradi,
 * bot mijozga xabar beradi: new → accepted → cooking → onway → done (yoki cancelled).
 */
export const BOT_FLOW = ['new', 'accepted', 'cooking', 'onway', 'done'];
export const BOT_STATUS_NAMES = { new: 'Yangi', accepted: 'Qabul qilindi', cooking: 'Tayyorlanmoqda', onway: "Yo'lda", done: 'Yetkazildi', cancelled: 'Bekor qilindi' };
export const botStatusName = (o) => (o?.ext?.delivery === 'pickup' && o.ext.status === 'onway' ? 'Tayyor' : o?.ext?.delivery === 'pickup' && o.ext.status === 'done' ? 'Topshirildi' : BOT_STATUS_NAMES[o?.ext?.status] || '');
export function botCanMove(from, to) {
  if (['done', 'cancelled'].includes(from || 'new')) return false;
  if (to === 'cancelled') return true;
  return BOT_FLOW.indexOf(to) > BOT_FLOW.indexOf(from || 'new');
}

export class OpError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

export const money = (n) => Math.round(Number(n) || 0);
export const qty3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
export const lineSum = (it) => money(it.price * it.qty);
/** Qo'shimchalar (pishloq, sous...) — 1 dona uchun; taom narxiga qo'shiladi. */
export const modSum = (mods) => (mods || []).reduce((s, m) => s + money(m.price), 0);
export const modsText = (it) => (it.mods || []).map((m) => (m.price ? '+ ' : '') + m.name).join(', ');
export const modsKey = (mods) => (mods || []).map((m) => m.id ?? m.name).sort().join(',');
const clone = (o) => JSON.parse(JSON.stringify(o));

export function newOrder(id) {
  return {
    id, number: null, type: 'zal', table_id: null, guests: 0, waiter_id: null,
    status: 'open', items: [], payments: [], discount: null, service_pct: 0,
    comment: '', customer: null, opened_at: null, opened_by: null,
    closed_at: null, closed_by: null, precheck_at: null, shift_id: null,
    void_reason: null, void_by: null, ext: null, rev: 0,
  };
}

/** Buyurtma jamlari. Bekor qilingan taom va bekor qilingan to'lov sanalmaydi. */
export function totals(o) {
  const live = o.items.filter((i) => i.status !== 'cancelled');
  const subtotal = live.reduce((s, i) => s + lineSum(i), 0);
  let discount = 0;
  if (o.discount) {
    discount = o.discount.kind === 'pct'
      ? money(subtotal * o.discount.value / 100)
      : Math.min(subtotal, money(o.discount.value));
  }
  const base = subtotal - discount;
  const service = money(base * (Number(o.service_pct) || 0) / 100);
  const total = base + service;
  const paid = o.payments.filter((p) => !p.void).reduce((s, p) => s + money(p.amount), 0);
  return {
    subtotal, discount, service, total, paid,
    due: Math.max(0, total - paid),
    items: live.length,
    unsent: o.items.filter((i) => i.status === 'new').length,
  };
}

const fmtSum = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Kim ruxsat beradi: amalni menejerning o'zi qilsa — o'zi, aks holda approved_by. */
function manager(op, ctx) {
  const by = ctx.users.get(op.by);
  if (by && by.active !== false && MANAGER_ROLES.includes(by.role)) return op.by;
  const ap = op.data?.approved_by != null ? ctx.users.get(op.data.approved_by) : null;
  if (ap && ap.active !== false && MANAGER_ROLES.includes(ap.role)) return op.data.approved_by;
  throw new OpError('need_manager', 'Menejer ruxsati kerak');
}

function item(o, id) {
  const it = o.items.find((i) => i.id === id);
  if (!it) throw new OpError('no_item', 'Taom topilmadi');
  return it;
}

function cleanText(v, max = 200) { return String(v ?? '').trim().slice(0, max); }

function cleanMods(list) {
  if (!Array.isArray(list)) return [];
  return list.slice(0, 12).map((m) => ({ id: Number.isInteger(m?.id) ? m.id : null, name: cleanText(m?.name, 60), price: Math.max(0, money(m?.price)) }))
    .filter((m) => m.name);
}

/** Tashqi manba (Telegram bot) ma'lumoti: faqat shu maydonlar saqlanadi. */
function cleanExt(e) {
  if (!e || typeof e !== 'object' || e.source !== 'telegram') return null;
  return {
    source: 'telegram', number: cleanText(e.number, 12), status: [...BOT_FLOW, 'cancelled'].includes(e.status) ? e.status : 'new',
    delivery: e.delivery === 'pickup' ? 'pickup' : 'delivery', pay: e.pay === 'karta' ? 'karta' : 'naqd',
    user: cleanText(e.user, 80), username: cleanText(e.username, 40), at: e.at && !Number.isNaN(Date.parse(e.at)) ? new Date(e.at).toISOString() : null,
    gen: Math.max(0, Math.floor(Number(e.gen) || 0)),
  };
}

function cleanCustomer(c) {
  if (!c || typeof c !== 'object') return null;
  const id = /^[A-Za-z0-9_-]{6,64}$/.test(String(c.id || '')) ? String(c.id) : null;
  const r = { id, name: cleanText(c.name, 80), phone: cleanText(c.phone, 30), address: cleanText(c.address, 200) };
  return r.id || r.name || r.phone || r.address ? r : null;
}

/**
 * Bitta amalni qo'llaydi va YANGI buyurtma qaytaradi (eski obyekt o'zgarmaydi).
 * ctx.users — Map(id → { role, active }): menejer ruxsatini tekshirish uchun.
 */
export function applyOp(order, op, ctx) {
  const o = order ? clone(order) : newOrder(op.order_id);
  const d = op.data || {};
  const at = op.at || new Date().toISOString();
  if (!ctx.users.get(op.by)) throw new OpError('bad_user', 'Xodim topilmadi');

  if (op.type === 'open') {
    if (o.opened_at) return o; // takror ochish — o'zgarishsiz
    if (!ORDER_TYPES.includes(d.type)) throw new OpError('bad_type', 'Buyurtma turi noto\'g\'ri');
    if (d.type === 'zal' && !d.table_id) throw new OpError('need_table', 'Stol tanlanmagan');
    Object.assign(o, {
      number: Number(d.number) || null, type: d.type, table_id: d.type === 'zal' ? d.table_id : null,
      guests: Math.max(0, Math.min(99, Number(d.guests) || 0)), waiter_id: d.waiter_id ?? op.by,
      service_pct: d.type === 'zal' ? Math.max(0, Math.min(30, Number(d.service_pct) || 0)) : 0,
      customer: cleanCustomer(d.customer), comment: cleanText(d.comment, 300), opened_at: at, opened_by: op.by,
      shift_id: d.shift_id || null, ext: cleanExt(d.ext),
    });
    o.rev++;
    return o;
  }

  if (!o.opened_at) throw new OpError('no_order', 'Buyurtma ochilmagan');
  if (o.status !== 'open') throw new OpError('closed', 'Buyurtma yopilgan');

  switch (op.type) {
    case 'add': {
      const it = d.item || {};
      if (!it.id) throw new OpError('bad_item', 'Taom id si yo\'q');
      if (o.items.some((i) => i.id === it.id)) return o;
      const q = qty3(it.qty);
      const mods = cleanMods(it.mods);
      // base — taomning o'z narxi; price — qo'shimchalar bilan 1 dona narxi.
      const base = it.base != null ? money(it.base) : money(it.price) - modSum(mods);
      if (!(q > 0)) throw new OpError('bad_qty', 'Miqdor noto\'g\'ri');
      if (base < 0) throw new OpError('bad_price', 'Narx noto\'g\'ri');
      o.items.push({
        id: it.id, product_id: it.product_id ?? null, name: cleanText(it.name, 120), price: base + modSum(mods), qty: q,
        unit: it.unit === 'kg' ? 'kg' : 'dona', station_id: it.station_id ?? null, comment: cleanText(it.comment),
        status: 'new', added_at: at, added_by: op.by, sent_at: null, ...(mods.length ? { base, mods } : {}),
      });
      o.precheck_at = null;
      break;
    }
    case 'qty': {
      const it = item(o, d.item_id);
      if (it.status !== 'new') throw new OpError('sent', 'Oshxonaga yuborilgan taom o\'zgarmaydi — bekor qiling');
      const q = qty3(d.qty);
      if (!(q > 0)) throw new OpError('bad_qty', 'Miqdor noto\'g\'ri');
      it.qty = q;
      o.precheck_at = null;
      break;
    }
    case 'remove': {
      const it = item(o, d.item_id);
      if (it.status !== 'new') throw new OpError('sent', 'Oshxonaga yuborilgan taom o\'chmaydi — bekor qiling');
      o.items = o.items.filter((i) => i.id !== it.id);
      o.precheck_at = null;
      break;
    }
    case 'mods': {
      const it = item(o, d.item_id);
      if (it.status !== 'new') throw new OpError('sent', 'Oshxonaga yuborilgan taomning qo\'shimchasi o\'zgarmaydi');
      const mods = cleanMods(d.mods);
      const base = it.base != null ? it.base : it.price - modSum(it.mods);
      it.base = base; it.mods = mods; it.price = base + modSum(mods);
      o.precheck_at = null;
      break;
    }
    case 'xfer_out': {
      // Taom boshqa buyurtmaga (stolga) ketdi. Hisobi qabul qilgan buyurtmada davom etadi.
      const list = Array.isArray(d.items) ? d.items.slice(0, 100) : [];
      if (!list.length) throw new OpError('bad_items', 'Taom tanlanmagan');
      if (!d.to || d.to === o.id) throw new OpError('bad_target', 'Qayerga ko\'chirilishi noma\'lum');
      for (const x of list) {
        const it = item(o, x.id);
        if (it.status === 'cancelled') throw new OpError('cancelled', 'Bekor qilingan taom ko\'chirilmaydi');
        const q = x.qty != null ? qty3(x.qty) : it.qty;
        if (!(q > 0) || q > it.qty) throw new OpError('bad_qty', 'Miqdor noto\'g\'ri');
        if (q === it.qty) o.items = o.items.filter((i) => i.id !== it.id);
        else { if (!x.new_id) throw new OpError('bad_split', 'Bo\'lish id si yo\'q'); it.qty = qty3(it.qty - q); }
      }
      o.moved = [...(o.moved || []), { to: String(d.to), n: list.length, at, by: op.by }].slice(-30);
      o.precheck_at = null;
      break;
    }
    case 'xfer_in': {
      const list = Array.isArray(d.items) ? d.items.slice(0, 100) : [];
      if (!list.length) throw new OpError('bad_items', 'Taom tanlanmagan');
      for (const it of list) {
        if (!it?.id || o.items.some((i) => i.id === it.id)) continue;
        const q = qty3(it.qty); const mods = cleanMods(it.mods);
        const base = it.base != null ? money(it.base) : money(it.price) - modSum(mods);
        if (!(q > 0) || base < 0) throw new OpError('bad_qty', 'Miqdor yoki narx noto\'g\'ri');
        const sent = it.status === 'sent';
        const when = (v) => (v && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : at);
        o.items.push({
          id: String(it.id), product_id: it.product_id ?? null, name: cleanText(it.name, 120), price: base + modSum(mods), qty: q,
          unit: it.unit === 'kg' ? 'kg' : 'dona', station_id: it.station_id ?? null, comment: cleanText(it.comment),
          status: sent ? 'sent' : 'new', added_at: when(it.added_at), added_by: it.added_by ?? op.by, sent_at: sent ? when(it.sent_at) : null,
          from_order: d.from ? String(d.from) : null, ...(mods.length ? { base, mods } : {}),
        });
      }
      o.precheck_at = null;
      break;
    }
    case 'comment': {
      const it = item(o, d.item_id);
      if (it.status !== 'new') throw new OpError('sent', 'Yuborilgan taomga izoh yozilmaydi');
      it.comment = cleanText(d.comment);
      break;
    }
    case 'send': {
      const ids = new Set(d.item_ids || o.items.filter((i) => i.status === 'new').map((i) => i.id));
      for (const it of o.items) if (ids.has(it.id) && it.status === 'new') { it.status = 'sent'; it.sent_at = at; }
      break;
    }
    case 'cancel': {
      const it = item(o, d.item_id);
      if (it.status === 'cancelled') return o;
      if (it.status === 'new') throw new OpError('not_sent', 'Yuborilmagan taom shunchaki o\'chiriladi');
      const reason = cleanText(d.reason, 120);
      if (!reason) throw new OpError('need_reason', 'Bekor qilish sababi kerak');
      const who = manager(op, ctx);
      const q = d.qty != null ? qty3(d.qty) : it.qty;
      if (!(q > 0) || q > it.qty) throw new OpError('bad_qty', 'Miqdor noto\'g\'ri');
      const mark = (x) => Object.assign(x, { status: 'cancelled', cancel_reason: reason, cancelled_by: who, cancelled_at: at, cancel_op: op.id });
      if (q === it.qty) mark(it);
      else {
        if (!d.split_id) throw new OpError('bad_split', 'Bo\'lish id si yo\'q');
        it.qty = qty3(it.qty - q);
        o.items.push(mark({ ...clone(it), id: d.split_id, qty: q }));
      }
      o.precheck_at = null;
      break;
    }
    case 'discount': {
      if (!d.value) { o.discount = null; break; }
      const kind = d.kind === 'sum' ? 'sum' : 'pct';
      const value = kind === 'pct' ? Math.min(100, Math.max(0, Number(d.value))) : Math.max(0, money(d.value));
      if (!(value > 0)) throw new OpError('bad_value', 'Chegirma noto\'g\'ri');
      const reason = cleanText(d.reason, 120);
      if (!reason) throw new OpError('need_reason', 'Chegirma sababi kerak');
      o.discount = { kind, value, reason, by: manager(op, ctx), at };
      o.precheck_at = null;
      break;
    }
    case 'service': {
      const pct = Math.max(0, Math.min(30, Number(d.pct) || 0));
      // Kamaytirish (olib tashlash) — amalda chegirma: menejer ruxsati kerak.
      if (pct < (Number(o.service_pct) || 0)) manager(op, ctx);
      o.service_pct = pct; o.precheck_at = null;
      break;
    }
    case 'guests': o.guests = Math.max(0, Math.min(99, Number(d.guests) || 0)); break;
    case 'waiter': o.waiter_id = d.waiter_id ?? null; break;
    case 'move': {
      if (o.type !== 'zal') throw new OpError('not_hall', 'Faqat zal buyurtmasi ko\'chiriladi');
      if (!d.table_id) throw new OpError('need_table', 'Stol tanlanmagan');
      o.table_id = d.table_id;
      break;
    }
    case 'meta': {
      if ('comment' in d) o.comment = cleanText(d.comment, 300);
      if ('customer' in d) {
        const c = cleanCustomer(d.customer);
        const debt = o.payments.some((p) => !p.void && p.method === 'qarz');
        if (debt && (c?.id || null) !== (o.customer?.id || null)) throw new OpError('has_debt', 'Qarzga to\'lov bor — mijozni almashtirish uchun avval qarz to\'lovini bekor qiling');
        o.customer = c;
      }
      break;
    }
    case 'ext': {
      // Bot buyurtmasining holati (kassa qabul qildi, yo'lga chiqdi...). Orqaga qaytmaydi.
      if (!o.ext) throw new OpError('not_bot', 'Bu buyurtma botdan emas');
      const to = String(d.status || '');
      if (![...BOT_FLOW, 'cancelled'].includes(to)) throw new OpError('bad_status', 'Holat noto\'g\'ri');
      if (o.ext.status === to || !botCanMove(o.ext.status, to)) return o;
      o.ext.status = to; o.ext.status_at = at;
      break;
    }
    case 'precheck': o.precheck_at = at; break;
    case 'pay': {
      const p = d.payment || {};
      if (!p.id) throw new OpError('bad_payment', 'To\'lov id si yo\'q');
      if (o.payments.some((x) => x.id === p.id)) return o;
      if (!PAY_METHODS.includes(p.method)) throw new OpError('bad_method', 'To\'lov turi noto\'g\'ri');
      const t = totals(o);
      const amount = money(p.amount);
      if (!(amount > 0)) throw new OpError('bad_amount', 'Summa noto\'g\'ri');
      if (amount > t.due) throw new OpError('overpay', 'Qoldiqdan ko\'p to\'lov');
      if (p.method === 'qarz' && !(o.customer?.id && (o.customer.name || o.customer.phone))) throw new OpError('need_customer', 'Qarzga — mijozni tanlang');
      const received = p.method === 'naqd' ? Math.max(amount, money(p.received || amount)) : amount;
      o.payments.push({ id: p.id, method: p.method, amount, received, change: received - amount, at, by: op.by, void: false });
      break;
    }
    case 'unpay': {
      const p = o.payments.find((x) => x.id === d.payment_id);
      if (!p) throw new OpError('no_payment', 'To\'lov topilmadi');
      if (p.void) return o;
      Object.assign(p, { void: true, void_by: manager(op, ctx), void_at: at });
      break;
    }
    case 'close': {
      const t = totals(o);
      if (!t.items) throw new OpError('empty', 'Buyurtmada taom yo\'q — bekor qiling');
      if (t.unsent) throw new OpError('unsent', 'Oshxonaga yuborilmagan taom bor');
      if (t.due > 0) throw new OpError('unpaid', 'To\'lov to\'liq emas');
      // Chegirma yoki bekor qilish to'lovdan keyin bo'lsa — to'lov jamidan oshib qoladi.
      if (t.paid > t.total) throw new OpError('overpaid', `To'lov ${fmtSum(t.paid - t.total)} so'm ortiqcha — ortiqcha to'lovni bekor qiling`);
      if (o.payments.some((p) => !p.void && p.method === 'qarz') && !o.customer?.id) throw new OpError('need_customer', 'Qarzga to\'lov bor, lekin mijoz tanlanmagan');
      Object.assign(o, { status: 'closed', closed_at: at, closed_by: op.by, shift_id: d.shift_id || o.shift_id });
      break;
    }
    case 'void': {
      const reason = cleanText(d.reason, 120);
      if (!reason) throw new OpError('need_reason', 'Sabab kerak');
      if (o.payments.some((p) => !p.void)) throw new OpError('has_payments', 'Avval to\'lovni bekor qiling');
      const sent = o.items.some((i) => i.status === 'sent');
      Object.assign(o, { status: 'void', void_reason: reason, void_by: sent ? manager(op, ctx) : op.by, closed_at: at, closed_by: op.by, shift_id: d.shift_id || o.shift_id });
      for (const it of o.items) if (it.status === 'new') it.status = 'cancelled';
      break;
    }
    default: throw new OpError('bad_op', 'Noma\'lum amal');
  }
  o.rev++;
  return o;
}

/**
 * Smena jamlari — X/Z hisobot.
 * orders — shu smenada yopilgan yoki bekor qilingan buyurtmalar;
 * moves — kassadagi boshqa pul harakatlari: { kind, amount, method }
 *   kirim / chiqim — kassaga qo'yilgan yoki olingan pul (inkassatsiya),
 *   rasxod — kassadan to'langan xarajat, qarz_tolov — mijoz qarzini to'ladi,
 *   yetkazuvchi — yetkazib beruvchiga kassadan to'landi.
 */
export function shiftSummary(shift, orders, moves = []) {
  const s = {
    orders: 0, voided: 0, guests: 0, subtotal: 0, discount: 0, service: 0, total: 0,
    by_method: Object.fromEntries(PAY_METHODS.map((m) => [m, 0])),
    by_type: Object.fromEntries(ORDER_TYPES.map((t) => [t, 0])),
    cancelled_items: 0, cancelled_sum: 0, cash_in: 0, cash_out: 0, expenses: 0, supplier_paid: 0,
    debt_paid: Object.fromEntries(PAY_METHODS.filter((m) => m !== 'qarz').map((m) => [m, 0])),
  };
  for (const o of orders) {
    for (const it of o.items) if (it.status === 'cancelled' && it.sent_at) { s.cancelled_items++; s.cancelled_sum += lineSum(it); }
    if (o.status === 'void') { s.voided++; continue; }
    if (o.status !== 'closed') continue;
    const t = totals(o);
    s.orders++; s.guests += o.guests || 0;
    s.subtotal += t.subtotal; s.discount += t.discount; s.service += t.service; s.total += t.total;
    s.by_type[o.type] = (s.by_type[o.type] || 0) + t.total;
    for (const p of o.payments) if (!p.void) s.by_method[p.method] += money(p.amount);
  }
  for (const m of moves) {
    const a = money(m.amount);
    if (m.kind === 'kirim') s.cash_in += a;
    else if (m.kind === 'chiqim') s.cash_out += a;
    else if (m.kind === 'rasxod') s.expenses += a;
    else if (m.kind === 'yetkazuvchi') s.supplier_paid += a;
    else if (m.kind === 'qarz_tolov') s.debt_paid[m.method || 'naqd'] = (s.debt_paid[m.method || 'naqd'] || 0) + a;
  }
  s.expected_cash = money(shift?.opening_cash) + s.by_method.naqd + s.cash_in - s.cash_out - s.expenses - s.supplier_paid + (s.debt_paid.naqd || 0);
  s.avg_check = s.orders ? Math.round(s.total / s.orders) : 0;
  return s;
}

/** Sana/vaqt: Toshkent (UTC+5). */
export const TZ = 5;
export function localDay(d = new Date()) {
  const t = new Date((typeof d === 'string' ? Date.parse(d) : d.getTime()) + TZ * 3600e3);
  return t.toISOString().slice(0, 10);
}
