/**
 * ordo — kassa ekrani.
 * Ko'rinishlar: zal (stollar), olib ketish, yetkazish, buyurtma (menyu + chek), buyurtmalar tarixi,
 * smena (kassa puli, rasxod, qarz to'lovi, X/Z hisobot), eslatmalar. Kirish — PIN bilan (qulf ekrani).
 */
import { totals, lineSum, modSum, modsText, modsKey, TYPE_NAMES, PAY_NAMES, PAY_METHODS, ROLE_NAMES, MANAGER_ROLES, shiftSummary, botStatusName } from './core.js';
import { S, on, start, refreshBoot, dispatch, openOrders, order, shift, notes, nextNumber, stationName, tableName, hallOf, staffName, setting, flushSoon } from './store.js';
import { deviceToken, get, post } from './api.js';
import { $, $$, esc, sum, qty, time, dateTime, since, uid, initials, icon, toast, openModal, confirmBox, numberBox, isTopModal, MARK } from './ui.js';
import { pinHash, sameHex } from './pin.js';
import { modsFor, pickMods } from './mods.js';
import { receiptHTML, kitchenHTML, cancelHTML, zReportHTML, print, printCfg, setPrintCfg } from './print.js';

if (!deviceToken()) location.replace('/?qurilma=1');

const ui = { view: 'zal', hall: null, order: null, draft: null, cat: null, search: '', back: 'zal', sel: null, buf: '' };
const QUICK_NOTES = ['Piyozsiz', 'Achchiqroq', 'Achchiq emas', 'Tuzsiz', 'Tezroq', 'Olib ketish uchun', 'Muzsiz', 'Shakarsiz', 'Yaxshi pishgan'];
const CANCEL_REASONS = ['Mijoz voz kechdi', 'Xato kiritilgan', 'Uzoq kutdi', 'Taom sifatsiz', 'Tugab qoldi'];
const DISCOUNT_REASONS = ['Doimiy mijoz', 'Tug\'ilgan kun', 'Xodim', 'Kechikish uchun', 'Aksiya'];
const VOID_REASONS = ['Mijoz ketdi', 'Xato ochilgan', 'Ikki marta kiritilgan', 'Test'];

const ctxPrint = () => ({ settings: S.boot?.settings || {}, company: S.boot?.company, tableName, staffName, paper: printCfg().paper });
const isManager = () => MANAGER_ROLES.includes(S.user?.role);
const fail = (e) => toast(e?.message || 'Xatolik', 'bad');
const avatar = (u, size = 32) => `<span class="av" style="background:${esc(u?.color || '#3d4a63')};width:${size}px;height:${size}px">${esc(initials(u?.name))}</span>`;
const cats = () => S.boot?.categories || [];
const modsOf = (pid) => modsFor(S.boot, pid);
const modPicker = (p, opts) => pickMods(S.boot, p, opts);
const products = () => S.boot?.products || [];

// =================== Qobiq ===================
function mount() {
  $('#app').innerHTML = `<div class="k-shell">
    <nav class="rail" id="rail"></nav>
    <main class="k-main"><header class="k-top" id="top"></header><section class="view" id="view"></section></main></div>`;
  renderRail(); renderTop(); renderView();
}

const NAV = [['zal', 'hall', 'Zal'], ['olib', 'bag', 'Olib ketish'], ['yetkazish', 'truck', 'Yetkazish'], ['tarix', 'list', 'Buyurtmalar'],
  ['smena', 'cash', 'Smena'], ['eslatma', 'note', 'Eslatmalar']];

/** Botdan kelgan buyurtma: olib ketish bo'lsa "Olib ketish" ro'yxatida, yetkazish bo'lsa "Yetkazish"da. */
const listType = (o) => (o.type === 'bot' ? (o.ext?.delivery === 'pickup' ? 'olib' : 'yetkazish') : o.type);
const isBot = (o) => o?.type === 'bot' && !!o.ext;

function renderRail() {
  const open = openOrders();
  const count = { zal: open.filter((o) => o.type === 'zal').length, olib: open.filter((o) => listType(o) === 'olib').length,
    yetkazish: open.filter((o) => listType(o) === 'yetkazish').length, eslatma: notes().length };
  const active = ui.view === 'order' ? ui.back : ui.view;
  $('#rail').innerHTML = `<div class="mk">${MARK}</div>
    ${NAV.map(([k, ic, l]) => `<button data-nav="${k}" class="${active === k ? 'on' : ''}">${icon(ic)}${esc(l)}${count[k] ? `<span class="n">${count[k]}</span>` : ''}</button>`).join('')}
    <div class="sp"></div>
    ${isManager() ? `<button data-nav="admin">${icon('gear')}Boshqaruv</button>` : ''}
    <button data-nav="lock">${icon('lock')}Qulflash</button>`;
}

function renderTop() {
  const sh = shift();
  const pending = S.outbox.length;
  const sync = !S.online ? `<span class="sync off">${icon('offline')}Internet yo'q${pending ? ` · ${pending} ta navbatda` : ''}</span>`
    : pending ? `<span class="sync wait">${icon('wifi')}Yuborilmoqda · ${pending}</span>` : `<span class="sync">${icon('wifi')}Onlayn</span>`;
  const titles = { zal: 'Zal', olib: 'Olib ketish', yetkazish: 'Yetkazish', tarix: 'Buyurtmalar', smena: 'Smena', eslatma: 'Eslatmalar' };
  let title = titles[ui.view] || '';
  let crumb = '';
  if (ui.view === 'order') {
    const o = order(ui.order) || ui.draft;
    title = o?.type === 'zal' ? `Stol ${tableName(o.table_id)}` : TYPE_NAMES[o?.type] || 'Buyurtma';
    crumb = o?.type === 'zal' ? esc(hallOf(o.table_id)?.name || '') : '';
  }
  $('#top').innerHTML = `${ui.view === 'order' ? `<button class="icon-btn" data-back aria-label="Orqaga">${icon('back')}</button>` : ''}
    <h1>${esc(title)}</h1>${crumb ? `<span class="crumb">${crumb}</span>` : ''}<div class="sp"></div>
    ${S.failed.length ? `<button class="btn sm danger" data-failed>${icon('alert')}${S.failed.length} ta amal rad etildi</button>` : ''}
    ${sync}
    ${sh ? `<button class="shift-chip" data-nav="smena">${icon('clock')}Smena${sh.number ? ' №' + sh.number : ''} · ${time(sh.opened_at)}</button>`
      : `<button class="shift-chip closed" data-open-shift>${icon('cash')}Smena yopiq — ochish</button>`}
    <button class="me" data-me>${avatar(S.user)}<span class="nm">${esc(S.user?.name || '')}<small>${esc(ROLE_NAMES[S.user?.role] || '')}</small></span>${icon('chev')}</button>
    <span class="when"><span class="clock" id="clock">${time(new Date())}</span><small id="cdate">${dayLabel()}</small></span>`;
}

function dayLabel() {
  const d = new Date(Date.now() + 5 * 3600e3);
  const m = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
  return `${d.getUTCDate()}-${m[d.getUTCMonth()]}`;
}

function go(view, extra = {}) {
  Object.assign(ui, { view }, extra);
  renderRail(); renderTop(); renderView();
}

function renderView() {
  const v = $('#view');
  v.className = 'view' + (ui.view === 'order' ? ' flush' : '');
  ({ zal: viewHall, olib: (x) => viewListOf(x, 'olib'), yetkazish: (x) => viewListOf(x, 'yetkazish'), order: viewOrder, tarix: viewHistory, smena: viewShift, eslatma: viewNotes }[ui.view] || viewHall)(v);
}

/** Do'kon holati o'zgarganda (sinxron, boshqa kassadan) — faqat kerakli qism yangilanadi. */
function refresh() {
  renderRail(); renderTop();
  if (ui.view === 'zal' || ui.view === 'olib' || ui.view === 'yetkazish') renderView();
  else if (ui.view === 'order') { const o = order(ui.order); if (ui.order && !o) { go(ui.back); return; } renderTicket(); renderCounts(); }
  else if (ui.view === 'eslatma') renderNotesList();
}

// =================== Zal ===================
function viewHall(v) {
  const halls = S.boot?.halls || [];
  if (!ui.hall || !halls.some((h) => h.id === ui.hall)) ui.hall = halls[0]?.id;
  const open = openOrders().filter((o) => o.type === 'zal');
  const byTable = new Map(open.map((o) => [o.table_id, o]));
  const tables = (S.boot?.tables || []).filter((t) => t.hall_id === ui.hall);
  const all = S.boot?.tables || [];
  // Zalda chizilmay qoladigan buyurtmalar: bitta stolda ikkinchisi yoki stoli o'chirilgan.
  const lost = open.filter((o) => byTable.get(o.table_id) !== o || !all.some((t) => t.id === o.table_id));
  const nBusy = all.filter((t) => byTable.has(t.id)).length;
  const nBill = all.filter((t) => byTable.get(t.id)?.precheck_at).length;
  const guests = open.reduce((a, o) => a + (o.guests || 0), 0);
  const openSum = openOrders().reduce((a, o) => a + totals(o).total, 0);
  const late = (o) => { const m = (Date.now() - Date.parse(o.opened_at)) / 60000; return m > 120 ? 'very' : m > 75 ? 'late' : ''; };
  v.innerHTML = `<div class="kpis">
      <div class="kpi"><span class="ic">${icon('table')}</span><div><div class="l">Band stollar</div><div class="v">${nBusy} <small>/ ${all.length}</small></div></div></div>
      <div class="kpi"><span class="ic g">${icon('users')}</span><div><div class="l">Zaldagi mehmonlar</div><div class="v">${guests}</div></div></div>
      <div class="kpi"><span class="ic w">${icon('receipt')}</span><div><div class="l">Hisob so'ragan</div><div class="v">${nBill}</div></div></div>
      <div class="kpi"><span class="ic a">${icon('cash')}</span><div><div class="l">Ochiq hisoblar summasi</div><div class="v">${sum(openSum)}</div></div></div></div>
    <div class="hall-bar">
      <div class="seg">${halls.map((h) => { const n = (S.boot.tables.filter((t) => t.hall_id === h.id && byTable.has(t.id))).length;
        return `<button data-hall="${h.id}" class="${h.id === ui.hall ? 'on' : ''}">${esc(h.name)}${n ? ` · ${n}` : ''}</button>`; }).join('')}</div>
      <div class="sp grow"></div>
      <div class="legend"><span><i style="background:#9fd4b6"></i>Bo'sh ${all.length - nBusy}</span>
        <span><i style="background:var(--ink)"></i>Band ${nBusy - nBill}</span><span><i style="background:#e8a317"></i>Hisob so'radi ${nBill}</span></div>
    </div>
    ${lost.length ? `<div class="dupwarn">${icon('alert')}<span>Zalda ko'rinmay qolgan buyurtma:</span>${lost.map((o) => `<button class="btn sm" data-order="${o.id}">№${esc(o.number ?? '')} · ${esc(all.some((t) => t.id === o.table_id) ? 'Stol ' + tableName(o.table_id) : 'stoli o\'chirilgan')}</button>`).join('')}</div>` : ''}
    <div class="tables">${tables.map((t) => {
      const o = byTable.get(t.id);
      if (!o) return `<button class="tbl-card free" data-table="${t.id}"><span class="hd"><span class="nm">${esc(t.name)}</span><span class="pill">Bo'sh</span></span>
        <span class="ft"><span class="seats">${icon('users')}${t.seats} o'rin</span></span></button>`;
      const tt = totals(o); const w = S.boot.staff.find((u) => u.id === o.waiter_id);
      return `<button class="tbl-card ${o.precheck_at ? 'bill' : 'busy'}" data-order="${o.id}">
        <span class="hd"><span class="nm">${esc(t.name)}</span><span class="pill">${o.precheck_at ? 'Hisob' : '№ ' + esc(o.number ?? '')}</span></span>
        <span class="sub">${w ? `<span class="av wt" style="background:${esc(w.color || '#3d4a63')}" title="${esc(w.name)}">${esc(initials(w.name))}</span>` : ''}${icon('users')}${o.guests || '—'}
          ${tt.unsent ? `<span class="new"><i></i>${tt.unsent} yuborilmagan</span>` : ''}</span>
        <span class="ft"><span class="sm">${sum(tt.total)}</span><span class="tm ${late(o)}">${icon('clock')}${since(o.opened_at)}</span></span></button>`;
    }).join('') || '<div class="empty">Bu zalda stol yo\'q — Boshqaruv → Zal va stollar</div>'}</div>`;
}

function viewListOf(v, type) {
  const list = openOrders().filter((o) => listType(o) === type)
    .sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at));
  const total = list.reduce((s_, o) => s_ + totals(o).total, 0);
  const stage = (o) => { const t = totals(o); return o.precheck_at ? 'bill' : (t.unsent || !t.items) ? 'new' : 'cook'; };
  const cols = [['new', 'Yangi — oshxonaga yuborilmagan', 'var(--accent)'], ['cook', 'Tayyorlanmoqda', 'var(--ink)'], ['bill', 'Hisob berildi — to\'lov kutilmoqda', '#e8a317']];
  const card = (o) => {
    const t = totals(o);
    const live = o.items.filter((i) => i.status !== 'cancelled');
    const late = (Date.now() - Date.parse(o.opened_at)) / 60000 > 30;
    const cu = o.customer && (o.customer.name || o.customer.phone);
    return `<div class="ocard ${o.type === 'bot' ? 'src-bot' : ''}" data-order="${o.id}">
      <div class="hd"><span class="no">№ ${esc(o.number ?? o.ext?.number ?? '')}</span>${isBot(o) ? `<span class="badge tg">${icon('send')}Bot №${esc(o.ext.number)}</span><span class="badge bst-${o.ext.status}">${esc(botStatusName(o))}</span>` : ''}
        <span class="tm ${late ? 'late' : ''}">${icon('clock')}${time(o.opened_at)} · ${since(o.opened_at)}</span></div>
      ${cu ? `<div class="cu">${icon('user')}${esc([o.customer.name, o.customer.phone].filter(Boolean).join(' · '))}</div>` : ''}
      ${o.customer?.address ? `<div class="cu">${icon('truck')}${esc(o.customer.address)}</div>` : ''}
      <ul>${live.slice(0, 4).map((i) => `<li class="${i.status === 'new' ? 'new' : ''}"><b>${i.unit === 'kg' ? qty(i.qty, 'kg') : qty(i.qty) + '×'}</b><span>${esc(i.name)}</span></li>`).join('')}
        ${live.length > 4 ? `<li class="more">yana ${live.length - 4} ta taom</li>` : ''}${!live.length ? '<li class="more">hali taom yo\'q</li>' : ''}</ul>
      <div class="ft"><span class="sm">${sum(t.total)}</span>${isBot(o) && o.ext.status === 'new' ? `<button class="btn sm accent" data-bacc="${o.id}">${icon('check')}Qabul qilish</button>`
        : isBot(o) && ['accepted', 'cooking'].includes(o.ext.status) ? `<button class="btn sm" data-bway="${o.id}">${icon(o.ext.delivery === 'pickup' ? 'check' : 'truck')}${o.ext.delivery === 'pickup' ? 'Tayyor' : 'Yo\'lga chiqdi'}</button>` : ''}
        ${t.unsent && !(isBot(o) && o.ext.status === 'new') ? `<button class="btn sm accent" data-qsend="${o.id}">${icon('send')}Oshxonaga</button>` : ''}
        <button class="btn sm primary" data-qpay="${o.id}" ${!t.items ? 'disabled' : ''}>${icon('card')}To'lov</button></div></div>`;
  };
  v.innerHTML = `<div class="lbar"><span class="t"><b>${list.length}</b> ta ochiq buyurtma · <b>${sum(total)}</b> so'm</span>
      <button class="btn accent lg" data-new="${type}">${icon('plus')}Yangi buyurtma</button></div>
    <div class="board">${cols.map(([k, l, c]) => { const items = list.filter((o) => stage(o) === k);
      return `<section class="col"><h3><i style="background:${c}"></i>${esc(l)}<span>${items.length}</span></h3>${items.map(card).join('') || '<div class="none">Bo\'sh</div>'}</section>`; }).join('')}</div>`;
}

// =================== Buyurtma ekrani ===================
function current() { return ui.order ? order(ui.order) : null; }

function viewOrder(v) {
  const list = cats();
  if (!ui.cat || (ui.cat !== 'all' && !list.some((c) => c.id === ui.cat))) ui.cat = list[0]?.id || 'all';
  ui.buf = ''; ui.sel = null;
  v.innerHTML = `<div class="pos">
    <aside class="ticket" id="ticket"></aside>
    <section class="rpane">
      <div class="ctabs" id="ctabs">${list.map((c) => `<button data-cat="${c.id}" class="${ui.cat === c.id ? 'on' : ''}" style="--c:${esc(c.color || '#475569')}">${esc(c.name)}</button>`).join('')}
        <label class="csearch">${icon('search')}<input id="psearch" placeholder="Qidirish yoki shtrix-kod" autocomplete="off" value="${esc(ui.search)}"></label></div>
      <div class="pgrid" id="pgrid"></div></section></div>`;
  // Rasm yuklanmasa (internet yo'q, fayl o'chgan) kartochka buzuq rasm bilan qolmaydi — oddiy rangli ko'rinishga qaytadi.
  // `error` hodisasi yuqoriga ko'tarilmaydi, shuning uchun ushlash (capture) bosqichida tinglanadi.
  $('#pgrid').addEventListener('error', (e) => {
    if (e.target.tagName !== 'IMG') return;
    const t = e.target.closest('.ptile'); e.target.closest('.ph')?.remove(); t?.classList.remove('pic');
  }, true);
  $('#psearch').addEventListener('input', (e) => { ui.search = e.target.value; renderProducts(); });
  $('#psearch').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const q = ui.search.trim();
    const p = products().find((x) => x.barcode && x.barcode === q) || (filteredProducts().length === 1 ? filteredProducts()[0] : null);
    if (p) { addProduct(p); ui.search = ''; e.target.value = ''; renderProducts(); }
  });
  renderProducts(); renderTicket();
}

function filteredProducts() {
  const q = ui.search.trim().toLowerCase();
  if (q) return products().filter((p) => p.name.toLowerCase().includes(q) || (p.barcode || '').includes(q));
  return products().filter((p) => ui.cat === 'all' || p.category_id === ui.cat);
}

function renderProducts() {
  const grid = $('#pgrid'); if (!grid) return;
  const color = Object.fromEntries(cats().map((c) => [c.id, c.color]));
  const list = filteredProducts();
  // Restoranda birorta taomning rasmi bo'lsa kartochkalar balandroq (rasm tepada, nom va narx rangli tasmada).
  // Rasmi yo'q restoranda ko'rinish o'zgarmaydi — ixcham rangli tugmalar.
  grid.classList.toggle('pics', products().some((p) => p.image));
  grid.innerHTML = list.map((p) => `<button class="ptile ${p.image ? 'pic' : ''} ${S.stop.has(p.id) || p.stop ? 'stop' : ''}" data-p="${p.id}" style="--c:${esc(color[p.category_id] || '#475569')}">
      ${p.image ? `<span class="ph"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" draggable="false"></span>` : ''}<span class="n">${esc(p.name)}</span><span class="p">${sum(p.price)}${p.unit === 'kg' ? '<small>/ kg</small>' : ''}</span></button>`).join('')
    || `<div class="empty" style="grid-column:1/-1">${icon('search')}<div>Hech narsa topilmadi</div></div>`;
  renderCounts();
}

function renderCounts() {
  const o = current();
  const cnt = new Map();
  for (const it of o?.items || []) if (it.status !== 'cancelled') cnt.set(it.product_id, (cnt.get(it.product_id) || 0) + (it.unit === 'kg' ? 1 : it.qty));
  $$('#pgrid .ptile').forEach((b) => {
    b.querySelector('.cnt')?.remove();
    const n = cnt.get(Number(b.dataset.p));
    if (n) b.insertAdjacentHTML('beforeend', `<span class="cnt">${qty(n)}</span>`);
  });
}

const PAD_KEYS = ['7', '8', '9', 'qty', '4', '5', '6', 'disc', '1', '2', '3', 'note', '0', '00', 'C', 'del'];
const PAD_NAMES = { qty: 'Soni', disc: 'Chegirma', note: 'Izoh', del: 'O\'chirish' };

function renderTicket() {
  const box = $('#ticket'); if (!box) return;
  const o = current(); const d = ui.draft;
  const base = o || d;
  if (!base) return;
  const t = o ? totals(o) : { subtotal: 0, discount: 0, service: 0, total: 0, paid: 0, due: 0, items: 0, unsent: 0 };
  const items = o?.items || [];
  if (ui.sel && !items.some((i) => i.id === ui.sel)) ui.sel = null;
  const line = (it) => {
    const isNew = it.status === 'new'; const can = it.status === 'cancelled'; const on = ui.sel === it.id;
    const qlabel = it.unit === 'kg' ? qty(it.qty, 'kg') : `${qty(it.qty)}×`;
    const st = can ? `<span class="st bad">Bekor · ${esc(it.cancel_reason || '')}</span>` : isNew ? '<span class="st new">Yangi</span>' : it.ready_at ? `<span class="st ok">${icon('check')}Tayyor ${time(it.ready_at)}</span>` : `<span class="st">${icon('send')}${time(it.sent_at)}</span>`;
    return `<div class="tk-line ${isNew ? 'new' : ''} ${can ? 'cancelled' : ''} ${on ? 'on' : ''}" data-line="${it.id}">
      <span class="q">${qlabel}</span><span class="nm">${esc(it.name)}</span><span class="sm">${sum(lineSum(it))}</span>
      <span class="meta">${it.mods?.length ? `<span class="md">${esc(modsText(it))}</span>` : ''}${it.comment ? `<span class="cm">${icon('note')}${esc(it.comment)}</span>` : ''}${st}${on && isNew && it.unit !== 'kg'
        ? `<span class="qc"><button data-dec="${it.id}" aria-label="Kamaytirish">${icon('minus')}</button><button data-inc="${it.id}" aria-label="Ko'paytirish">${icon('plus')}</button></span>` : ''}</span></div>`;
  };
  const chips = [base.type === 'zal' ? `<button data-guests>${icon('users')}${base.guests || 0} mehmon</button>` : '',
    `<button data-waiter>${icon('user')}${esc(staffName(base.waiter_id ?? S.user?.id) || 'Ofitsiant')}</button>`,
    base.customer ? `<button data-customer>${icon('user')}${esc(base.customer.phone || base.customer.name)}</button>` : base.type !== 'zal' ? `<button data-customer>${icon('phone')}Telefon</button>` : '',
    base.customer?.address ? `<button data-customer class="addr">${icon('truck')}${esc(base.customer.address.slice(0, 40))}</button>` : '',
    o?.comment ? `<button data-ocomment>${icon('note')}${esc(o.comment.slice(0, 24))}</button>` : ''].join('');
  const sel = items.find((i) => i.id === ui.sel);
  box.innerHTML = `<div class="tk-h">${o ? `<b>№ ${esc(o.number ?? '')}</b><span>${time(o.opened_at)} dan</span>` : '<b>Yangi buyurtma</b>'}
      <button class="icon-btn" data-omenu aria-label="Amallar">${icon('menu')}</button></div>
    <div class="tk-chips">${chips}</div>
    <div class="tk-body">${!items.length ? `<div class="tk-empty">${icon('receipt')}<p>O'ngdagi tugmalardan taom tanlang.<br><small>Avval son yozib, keyin taomni bossangiz — shuncha qo'shiladi.</small></p></div>` : ''}
      ${items.map(line).join('')}</div>
    ${isBot(o) ? `<div class="tk-bot"><span class="badge tg">${icon('send')}Telegram bot №${esc(o.ext.number)}</span><span class="badge bst-${o.ext.status}">${esc(botStatusName(o))}</span>
      ${o.ext.pay === 'karta' ? '<span class="badge">Kartaga o\'tkazdi</span>' : ''}<span class="grow"></span>
      ${o.ext.status === 'new' ? `<button class="btn sm accent" data-bacc="${o.id}">${icon('check')}Qabul qilish</button>` : ['accepted', 'cooking'].includes(o.ext.status)
        ? `<button class="btn sm" data-bway="${o.id}">${icon(o.ext.delivery === 'pickup' ? 'check' : 'truck')}${o.ext.delivery === 'pickup' ? 'Tayyor' : 'Yo\'lga chiqdi'}</button>` : ''}</div>
      ${o.ext.status === 'cancelled' ? '<div class="tk-warn">Mijoz yoki egasi botda bekor qildi — buyurtmani bekor qiling</div>' : ''}
      ${o.ext.unmatched ? `<div class="tk-warn">${o.ext.unmatched} ta taom kassa menyusida topilmadi — nomi botdagidek yozildi, ombordan ayirilmaydi</div>` : ''}` : ''}
    <div class="tk-sum">
      ${t.discount ? `<div class="r"><span>Chegirma${o.discount.kind === 'pct' ? ' ' + o.discount.value + '%' : ''}</span><b class="neg">−${sum(t.discount)}</b></div>` : ''}
      ${o?.service_pct ? `<div class="r"><span>Xizmat haqi ${o.service_pct}%</span><b>${sum(t.service)}</b></div>` : ''}
      ${t.paid ? `<div class="r"><span>To'langan</span><b class="okc">${sum(t.paid)}</b></div>` : ''}
      <div class="tot"><span>${t.paid ? 'Qoldi' : 'Jami'}</span><b>${sum(t.paid ? t.due : t.total)}</b></div></div>
    <div class="tk-pad">${ui.buf ? `<div class="buf">${esc(ui.buf)} <small>${sel && sel.status === 'new' ? '— «Soni»ni bosing' : '— endi taomni bosing'}</small></div>` : ''}
      ${PAD_KEYS.map((k) => `<button data-k="${k}" class="${PAD_NAMES[k] ? 'f' : ''} ${k === 'del' ? 'x' : ''}" ${(k === 'del' || k === 'note') && !sel && k === 'del' ? 'disabled' : ''}>${esc(PAD_NAMES[k] || k)}</button>`).join('')}</div>
    <div class="tk-act">
      <button class="btn kitchen" data-send ${!t.unsent ? 'disabled' : ''}>${icon('send')}Oshxona${t.unsent ? ` · ${t.unsent}` : ''}</button>
      <button class="btn" data-precheck ${!t.items ? 'disabled' : ''}>${icon('receipt')}Hisob</button>
      <button class="btn pay" data-pay ${!t.items ? 'disabled' : ''}>${icon('card')}TO'LOV</button></div>`;
  box.querySelector('.tk-line.on')?.scrollIntoView({ block: 'nearest' });
}

/** Raqam tugmalari: son yozib taom bosilsa — shuncha; tanlangan satrga — Soni, Izoh, O'chirish. */
async function padKey(k) {
  const o = current();
  const it = o?.items.find((i) => i.id === ui.sel);
  if (/^\d+$/.test(k)) { ui.buf = (ui.buf + k).replace(/^0+/, '').slice(0, 4); return renderTicket(); }
  if (k === 'C') { if (ui.buf) ui.buf = ''; else ui.sel = null; return renderTicket(); }
  try {
    if (k === 'qty') {
      if (!it) { toast('Avval chekdagi taomni tanlang', 'bad'); return; }
      if (it.status !== 'new') { toast('Oshxonaga yuborilgan — o\'zgartirish uchun «O\'chirish» (bekor qilish)', 'bad'); return; }
      let q = Number(ui.buf) || 0; ui.buf = '';
      if (!q) q = await numberBox({ title: 'Miqdor', value: it.unit === 'kg' ? String(it.qty).replace('.', ',') : String(it.qty), decimal: it.unit === 'kg', suffix: it.unit === 'kg' ? 'kg' : 'dona' });
      if (q > 0) dispatch('qty', { item_id: it.id, qty: q }, o.id);
    } else if (k === 'disc') { ui.buf = ''; if (!o) { toast('Avval taom qo\'shing', 'bad'); return; } await setDiscount(o); }
    else if (k === 'note') {
      if (it && it.status === 'new') { const c = await commentBox(it.comment, 'Taomga izoh'); if (c != null) dispatch('comment', { item_id: it.id, comment: c }, o.id); }
      else if (o) { const c = await commentBox(o.comment, 'Buyurtmaga izoh'); if (c != null) dispatch('meta', { comment: c }, o.id); }
    } else if (k === 'del') {
      if (!it) return;
      if (it.status === 'new') { dispatch('remove', { item_id: it.id }, o.id); ui.sel = null; }
      else if (it.status !== 'cancelled') await cancelLine(o, it);
    }
  } catch (e) { fail(e); }
  renderTicket(); renderCounts(); renderRail();
}

async function startOrder(type, extra = {}) {
  if (!(await ensureShift())) return null;
  const sh = shift();
  const id = uid('o');
  const hall = extra.table_id ? hallOf(extra.table_id) : null;
  dispatch('open', { type, number: nextNumber(sh.id), shift_id: sh.id, waiter_id: extra.waiter_id ?? S.user.id, guests: extra.guests || 0,
    table_id: extra.table_id || null, customer: extra.customer || null,
    service_pct: type === 'zal' ? Number(hall?.service_pct ?? setting('service_pct', 0)) || 0 : 0 }, id);
  return id;
}

async function addProduct(p, opts = {}) {
  if (S.stop.has(p.id) || p.stop) { toast(`${p.name} — stop-listda (tugagan)`, 'bad'); return; }
  let q = opts.qty || 1;
  if (p.unit === 'kg' && !opts.qty) {
    q = await numberBox({ title: `${p.name} — og'irligi`, decimal: true, suffix: 'kg', hint: `1 kg narxi: ${sum(p.price)} so'm`, value: '' });
    if (!q) return;
  }
  try {
    if (!ui.order) {
      const d = ui.draft;
      const id = await startOrder(d.type, d);
      if (!id) return;
      ui.order = id; ui.draft = null;
      renderTop();
    }
    const o = current();
    const mods = opts.mods || [];
    const same = p.unit !== 'kg' && o.items.find((i) => i.status === 'new' && i.product_id === p.id && !i.comment && modsKey(i.mods) === modsKey(mods));
    if (same) { dispatch('qty', { item_id: same.id, qty: same.qty + q }, o.id); ui.sel = same.id; }
    else {
      const cat = cats().find((c) => c.id === p.category_id);
      const iid = uid('i');
      dispatch('add', { item: { id: iid, product_id: p.id, name: p.name, base: p.price, price: p.price + modSum(mods), mods, qty: q, unit: p.unit, station_id: p.station_id || cat?.station_id || null } }, o.id);
      ui.sel = iid;
    }
    const tile = $(`#pgrid [data-p="${p.id}"]`); tile?.classList.remove('flash'); void tile?.offsetWidth; tile?.classList.add('flash');
    renderTicket(); renderCounts(); renderRail();
  } catch (e) { fail(e); }
}

async function sendKitchen(silent = false, id = null) {
  const o = id ? order(id) : current(); if (!o) return;
  const fresh = o.items.filter((i) => i.status === 'new');
  if (!fresh.length) return;
  try { dispatch('send', { item_ids: fresh.map((i) => i.id) }, o.id); } catch (e) { fail(e); return; }
  const cfg = printCfg();
  if (cfg.kitchen && cfg.mode !== 'off') {
    const by = new Map();
    for (const it of fresh) { const k = it.station_id || 0; by.set(k, [...(by.get(k) || []), it]); }
    const hasStations = (S.boot?.stations || []).length > 0;
    for (const [st, list] of by) {
      if (!st && hasStations) continue; // sexi yo'q (ichimlik, sous) — kassaning o'zida beriladi, oshxona cheki chiqmaydi
      await print(kitchenHTML(order(o.id), list, stationName(st), ctxPrint()));
    }
  }
  if (!silent) toast(`Oshxonaga yuborildi · ${fresh.length} ta taom`, 'ok');
  if (ui.view === 'order') renderTicket();
  renderRail();
}

// ---- Satr amallari ----
async function lineMenu(id) {
  const o = current(); const it = o?.items.find((i) => i.id === id); if (!it) return;
  if (it.status === 'cancelled') { toast(`Bekor qilingan: ${it.cancel_reason} (${staffName(it.cancelled_by)})`); return; }
  const isNew = it.status === 'new';
  const act = await openModal({
    title: it.name,
    body: `<p class="hint" style="margin-bottom:14px">${qty(it.qty, it.unit === 'kg' ? 'kg' : 'dona')} × ${sum(it.price)} = <b>${sum(lineSum(it))}</b>${isNew ? '' : ` · oshxonaga ${time(it.sent_at)} da yuborilgan`}</p>
      <div class="actions">${isNew ? `<button class="btn" data-a="qty">${icon('edit')}Miqdor</button><button class="btn" data-a="note">${icon('note')}Izoh</button>
        ${it.product_id && modsOf(it.product_id).length ? `<button class="btn" data-a="mods">${icon('plus')}Qo'shimchalar</button>` : ''}
        <button class="btn danger" data-a="remove">${icon('trash')}O'chirish</button>`
      : `<button class="btn danger" data-a="cancel">${icon('x')}Bekor qilish</button><button class="btn" data-a="again">${icon('plus')}Yana shundan</button>`}
      ${o.type === 'zal' && !it.status.startsWith('cancel') ? `<button class="btn" data-a="xfer">${icon('move')}Boshqa stolga</button>` : ''}</div>`,
    onOpen: (m, close) => m.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => close(b.dataset.a)),
  });
  try {
    if (act === 'qty') {
      const q = await numberBox({ title: 'Miqdor', value: it.unit === 'kg' ? String(it.qty).replace('.', ',') : String(it.qty), decimal: it.unit === 'kg', suffix: it.unit === 'kg' ? 'kg' : 'dona' });
      if (q > 0) dispatch('qty', { item_id: it.id, qty: q }, o.id);
    } else if (act === 'note') {
      const c = await commentBox(it.comment, 'Taomga izoh');
      if (c != null) dispatch('comment', { item_id: it.id, comment: c }, o.id);
    } else if (act === 'mods') {
      const p = products().find((x) => x.id === it.product_id);
      const r = p && await modPicker({ ...p, price: it.base ?? p.price }, { current: it.mods || [] });
      if (r) dispatch('mods', { item_id: it.id, mods: r.mods }, o.id);
    } else if (act === 'remove') dispatch('remove', { item_id: it.id }, o.id);
    else if (act === 'again') { const p = products().find((x) => x.id === it.product_id); if (p) await addProduct(p); }
    else if (act === 'cancel') await cancelLine(o, it);
    else if (act === 'xfer') {
      let n = it.qty;
      if (it.unit !== 'kg' && it.qty > 1) { n = await numberBox({ title: `${it.name} — nechtasi o'tadi`, value: String(it.qty), suffix: 'ta' }); if (!(n > 0)) return; n = Math.min(n, it.qty); }
      await transferItems(o, [{ id: it.id, qty: n }]);
    }
  } catch (e) { fail(e); }
  renderTicket(); renderCounts(); renderRail();
}

async function cancelLine(o, it) {
  const r = await openModal({
    title: `Bekor qilish — ${it.name}`,
    body: `<p class="hint" style="margin-bottom:12px">Taom oshxonaga yuborilgan. Bekor qilish menejer ruxsati bilan va sababi yozib qo'yiladi — hisobotda ko'rinadi.</p>
      ${it.qty > 10 && it.unit !== 'kg' ? `<div class="field"><label>Nechtasi bekor qilinadi (jami ${it.qty})</label><input class="input" data-qn inputmode="numeric" value="${it.qty}"></div>` : ''}
      ${it.qty > 1 && it.qty <= 10 && it.unit !== 'kg' ? `<div class="field"><label>Nechtasi bekor qilinadi</label><div class="seg" data-q>${Array.from({ length: Math.min(it.qty, 10) }, (_, i) => `<button data-v="${i + 1}" class="${i + 1 === it.qty ? 'on' : ''}">${i + 1}</button>`).join('')}</div></div>` : ''}
      <div class="field"><label>Sababi</label><div class="chips" data-r>${CANCEL_REASONS.map((x) => `<button class="chip" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <input class="input" data-rt placeholder="yoki o'zingiz yozing" style="margin-top:8px"></div>`,
    foot: `<button class="btn" data-x>Orqaga</button><button class="btn danger solid" data-ok>Bekor qilish</button>`,
    onOpen: (m, close) => {
      let n = it.qty; let reason = '';
      m.querySelectorAll('[data-q] button').forEach((b) => b.onclick = () => { n = Number(b.dataset.v); m.querySelectorAll('[data-q] button').forEach((x) => x.classList.toggle('on', x === b)); });
      m.querySelectorAll('[data-r] .chip').forEach((b) => b.onclick = () => { reason = b.dataset.v; m.querySelector('[data-rt]').value = ''; m.querySelectorAll('[data-r] .chip').forEach((x) => x.classList.toggle('on', x === b)); });
      m.querySelector('[data-ok]').onclick = () => {
        const rr = m.querySelector('[data-rt]').value.trim() || reason; if (!rr) { toast('Sababini tanlang', 'bad'); return; }
        const qn = m.querySelector('[data-qn]');
        if (qn) { n = Math.round(Number(qn.value.replace(/\s/g, ''))); if (!(n >= 1 && n <= it.qty)) { toast(`1 dan ${it.qty} gacha son kiriting`, 'bad'); return; } }
        close({ n, reason: rr });
      };
    },
  });
  if (!r) return;
  const approver = await approve('Bekor qilish uchun menejer ruxsati');
  if (!approver) return;
  dispatch('cancel', { item_id: it.id, qty: r.n, reason: r.reason, approved_by: approver, split_id: uid('i') }, o.id);
  const cfg = printCfg();
  if (cfg.kitchen && cfg.mode !== 'off') await print(cancelHTML(order(o.id), { ...it, qty: r.n }, r.reason, ctxPrint()));
  toast('Bekor qilindi', 'ok');
}

function commentBox(value = '', title = 'Izoh', chips = QUICK_NOTES) {
  return openModal({
    title, body: `<div class="chips" style="margin-bottom:12px">${chips.map((x) => `<button class="chip" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
      <textarea class="input" data-t rows="3" placeholder="Izoh yozing" autofocus>${esc(value)}</textarea>`,
    foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
    onOpen: (m, close) => {
      const t = m.querySelector('[data-t]');
      m.querySelectorAll('.chip').forEach((b) => b.onclick = () => { t.value = t.value ? `${t.value}, ${b.dataset.v}` : b.dataset.v; });
      m.querySelector('[data-ok]').onclick = () => close(t.value.trim());
    },
  });
}

/** Menejer ruxsati: o'zi menejer bo'lsa — darhol, aks holda menejer tanlab PIN kiritadi. */
async function approve(title) {
  if (isManager()) return S.user.id;
  const mgrs = S.boot.staff.filter((u) => MANAGER_ROLES.includes(u.role));
  return openModal({
    title, body: `<div class="row wrap" data-who style="gap:8px;margin-bottom:12px">${mgrs.map((u) => `<button class="chip" data-u="${u.id}">${esc(u.name)}</button>`).join('')}</div>
      <input class="input" data-pin type="password" inputmode="numeric" maxlength="6" placeholder="Menejer PIN-kodi" style="font-size:22px;text-align:center;letter-spacing:.4em">`,
    foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Tasdiqlash</button>`,
    onOpen: (m, close) => {
      let who = mgrs.length === 1 ? mgrs[0] : null;
      if (who) m.querySelector(`[data-u="${who.id}"]`)?.classList.add('on');
      m.querySelectorAll('[data-u]').forEach((b) => b.onclick = () => { who = mgrs.find((u) => u.id === Number(b.dataset.u)); m.querySelectorAll('[data-u]').forEach((x) => x.classList.toggle('on', x === b)); m.querySelector('[data-pin]').focus(); });
      const ok = async () => {
        if (!who) { toast('Menejerni tanlang', 'bad'); return; }
        const h = await pinHash(m.querySelector('[data-pin]').value, who.pin_salt);
        if (!sameHex(h, who.pin_hash)) { toast('PIN noto\'g\'ri', 'bad'); m.querySelector('[data-pin]').value = ''; return; }
        close(who.id);
      };
      m.querySelector('[data-ok]').onclick = ok;
      m.querySelector('[data-pin]').addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
      setTimeout(() => m.querySelector('[data-pin]').focus(), 50);
    },
  });
}

// ---- Buyurtma amallari ----
async function orderMenu() {
  const o = current();
  if (!o) { toast('Avval taom qo\'shing'); return; }
  const items = [
    o.type === 'zal' && ['guests', 'users', 'Mehmonlar soni'], ['waiter', 'user', 'Ofitsiantni almashtirish'],
    o.type === 'zal' && ['move', 'move', 'Butun stolni boshqa stolga'], o.type === 'zal' && ['split', 'move', 'Taomlarni boshqa stolga (chekni bo\'lish)'],
    o.type === 'zal' && ['merge', 'table', 'Boshqa stol bilan birlashtirish'], ['discount', 'pct', 'Chegirma'],
    o.type === 'zal' && ['service', 'pct', 'Xizmat haqi'], ['customer', 'user', o.customer ? 'Mijozni o\'zgartirish' : 'Mijoz (nasiya / yetkazish)'],
    ['comment', 'note', 'Buyurtmaga izoh'], ['void', 'trash', 'Buyurtmani bekor qilish'],
  ].filter(Boolean);
  const a = await openModal({
    title: `Buyurtma № ${o.number ?? ''}`,
    body: `<div class="actions">${items.map(([k, ic, l]) => `<button class="btn ${k === 'void' ? 'danger' : ''}" data-a="${k}">${icon(ic)}${esc(l)}</button>`).join('')}</div>`,
    onOpen: (m, close) => m.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => close(b.dataset.a)),
  });
  try {
    if (a === 'guests') await setGuests(o);
    else if (a === 'waiter') await setWaiter(o);
    else if (a === 'move') await moveTable(o);
    else if (a === 'split') { const list = await pickItems(o, 'Qaysi taomlar boshqa stolga o\'tadi'); if (list) await transferItems(o, list); }
    else if (a === 'merge') await mergeTable(o);
    else if (a === 'discount') await setDiscount(o);
    else if (a === 'service') {
      const v = await numberBox({ title: 'Xizmat haqi', value: String(o.service_pct || 0), suffix: '%', hint: '0 — xizmat haqisiz' });
      if (v !== undefined) {
        const pct = Math.min(30, v);
        let ap = null;
        if (pct < (o.service_pct || 0)) { ap = await approve('Xizmat haqini kamaytirish uchun menejer ruxsati'); if (!ap) return; }
        dispatch('service', { pct, approved_by: ap }, o.id);
      }
    } else if (a === 'customer') { const c = o.type === 'zal' ? await pickCustomer(false) : await contactBox(o.type, o.customer || {}); if (c !== undefined) dispatch('meta', { customer: c }, o.id); }
    else if (a === 'comment') { const c = await commentBox(o.comment, 'Buyurtmaga izoh'); if (c != null) dispatch('meta', { comment: c }, o.id); }
    else if (a === 'void') await voidOrder(o);
  } catch (e) { fail(e); }
  if (ui.view === 'order') { renderTop(); renderTicket(); }
}

async function setGuests(o) {
  const v = await numberBox({ title: 'Mehmonlar soni', value: String(o?.guests || ''), suffix: 'kishi' });
  if (v === undefined) return;
  if (o) dispatch('guests', { guests: v }, o.id); else if (ui.draft) ui.draft.guests = v;
  renderTicket();
}

async function setWaiter(o) {
  const list = S.boot.staff.filter((u) => ['ofitsiant', 'kassir', 'admin', 'owner'].includes(u.role));
  const id = await openModal({
    title: 'Ofitsiant', body: `<div class="actions">${list.map((u) => `<button class="btn" data-u="${u.id}">${avatar(u, 28)} ${esc(u.name)}</button>`).join('')}</div>`,
    onOpen: (m, close) => m.querySelectorAll('[data-u]').forEach((b) => b.onclick = () => close(Number(b.dataset.u))),
  });
  if (!id) return;
  if (o) dispatch('waiter', { waiter_id: id }, o.id); else if (ui.draft) ui.draft.waiter_id = id;
  renderTicket();
}

async function moveTable(o) {
  const dest = await pickTable(o, 'Butun stol qaysi stolga ko\'chiriladi', { freeOnly: true });
  if (dest) { dispatch('move', { table_id: dest.table_id }, o.id); toast(`Stol ${tableName(dest.table_id)} ga ko'chirildi`, 'ok'); }
}

/** Buyurtmadagi taomlardan tanlash (soni bilan): chekni bo'lish va taom bo'yicha to'lash uchun. */
function pickItems(o, title, { ok = 'Davom etish' } = {}) {
  const live = o.items.filter((i) => i.status !== 'cancelled');
  if (!live.length) { toast('Buyurtmada taom yo\'q', 'bad'); return Promise.resolve(null); }
  const q = new Map(live.map((i) => [i.id, 0]));
  return openModal({
    title, size: 'wide',
    body: `<p class="hint" style="margin-bottom:10px">Taomni bosing — hammasi tanlanadi; − / + bilan sonini o'zgartiring.</p>
      <div class="pick-items">${live.map((it) => `<div class="pi" data-pi="${it.id}"><span class="nm">${esc(it.name)}${it.mods?.length ? `<small>${esc(modsText(it))}</small>` : ''}</span>
        <span class="mx">${it.unit === 'kg' ? qty(it.qty, 'kg') : `${qty(it.qty)} ta`}</span>
        <span class="qc">${it.unit === 'kg' ? '' : `<button data-pm="-">${icon('minus')}</button>`}<b data-pq>0</b>${it.unit === 'kg' ? '' : `<button data-pm="+">${icon('plus')}</button>`}</span>
        <span class="sm" data-ps></span></div>`).join('')}</div>`,
    foot: `<span class="mtot" data-tot></span><button class="btn" data-x>Bekor</button><button class="btn primary lg" data-ok>${esc(ok)}</button>`,
    onOpen: (m, close) => {
      const draw = () => {
        let s_ = 0;
        for (const it of live) {
          const row = m.querySelector(`[data-pi="${it.id}"]`); const n = q.get(it.id);
          row.classList.toggle('on', n > 0); row.querySelector('[data-pq]').textContent = it.unit === 'kg' ? (n ? qty(n, 'kg') : '0') : qty(n);
          row.querySelector('[data-ps]').textContent = n ? sum(Math.round(it.price * n)) : '';
          s_ += Math.round(it.price * n);
        }
        m.querySelector('[data-tot]').innerHTML = s_ ? `Tanlandi: <b>${sum(s_)}</b>` : 'Hali tanlanmadi';
      };
      m.querySelectorAll('[data-pi]').forEach((row) => row.addEventListener('click', (e) => {
        const it = live.find((x) => x.id === row.dataset.pi); const pm = e.target.closest('[data-pm]');
        if (pm) q.set(it.id, Math.max(0, Math.min(it.qty, q.get(it.id) + (pm.dataset.pm === '+' ? 1 : -1))));
        else q.set(it.id, q.get(it.id) === it.qty ? 0 : it.qty);
        draw();
      }));
      m.querySelector('[data-ok]').onclick = () => {
        const list = live.filter((it) => q.get(it.id) > 0).map((it) => ({ id: it.id, qty: q.get(it.id) }));
        if (!list.length) { toast('Kamida bitta taom tanlang', 'bad'); return; }
        close(list);
      };
      draw();
    },
  });
}

/** Stol tanlash: bo'sh stol — yangi buyurtma ochiladi, band stol — o'sha buyurtmaga qo'shiladi. */
function pickTable(o, title, { busyOnly = false, freeOnly = false } = {}) {
  const busy = new Map(openOrders().filter((x) => x.type === 'zal' && x.id !== o.id).map((x) => [x.table_id, x]));
  const tables = S.boot.tables.filter((t) => t.id !== o.table_id && (!busyOnly || busy.has(t.id)) && (!freeOnly || !busy.has(t.id)));
  return openModal({
    title, size: 'wide',
    body: S.boot.halls.map((h) => { const ts = tables.filter((t) => t.hall_id === h.id); if (!ts.length) return '';
      return `<div class="lbl" style="margin:6px 0">${esc(h.name)}</div><div class="tpick">${ts.map((t) => { const b = busy.get(t.id);
        return `<button class="${b ? 'busy' : 'free'}" data-t="${t.id}"><b>${esc(t.name)}</b><span>${b ? `№ ${esc(b.number ?? '')} · ${sum(totals(b).total)}` : 'bo\'sh'}</span></button>`; }).join('')}</div>`; }).join('')
      || '<p class="hint">Boshqa band stol yo\'q</p>',
    onOpen: (m, close) => m.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { const t = Number(b.dataset.t); close({ table_id: t, order: busy.get(t) || null }); }),
  });
}

/** Tanlangan taomlar boshqa stolga ko'chadi (oshxonaga ketgani ham — qayta chiqmaydi). */
async function transferItems(o, list) {
  const dest = await pickTable(o, 'Qaysi stolga o\'tkaziladi');
  if (!dest) return false;
  let to = dest.order?.id;
  if (!to) { to = await startOrder('zal', { table_id: dest.table_id, waiter_id: o.waiter_id }); if (!to) return false; }
  const moving = list.map((x) => { const it = o.items.find((i) => i.id === x.id); const whole = x.qty >= it.qty; return { it, whole, qty: whole ? it.qty : x.qty, nid: whole ? it.id : uid('i') }; });
  // Avval qabul qiluvchi buyurtmaga yoziladi: biror sabab bilan ikkinchi amal o'tmasa ham taom yo'qolmaydi.
  dispatch('xfer_in', { from: o.id, items: moving.map((m) => ({ ...m.it, id: m.nid, qty: m.qty })) }, to);
  dispatch('xfer_out', { to, items: moving.map((m) => ({ id: m.it.id, qty: m.qty, new_id: m.whole ? undefined : m.nid })) }, o.id);
  toast(`${moving.length} ta taom Stol ${tableName(dest.table_id)} ga o'tdi`, 'ok');
  if (!order(o.id)?.items.some((i) => i.status !== 'cancelled') && !order(o.id)?.payments.some((p) => !p.void)) {
    try { dispatch('void', { reason: `Hammasi Stol ${tableName(dest.table_id)} ga o'tdi`, shift_id: shift()?.id }, o.id); } catch { /* */ }
    go('order', { back: 'zal', order: to, draft: null });
  }
  return true;
}

/** Boshqa stoldagi buyurtma shu buyurtmaga qo'shiladi, u stol bo'shaydi. */
async function mergeTable(o) {
  const dest = await pickTable(o, 'Qaysi stol shu stolga qo\'shiladi', { busyOnly: true });
  if (!dest?.order) return;
  const src = dest.order;
  if (src.payments.some((p) => !p.void)) { toast(`Stol ${tableName(src.table_id)} da to'lov bor — avval o'sha hisobni yoping`, 'bad'); return; }
  const live = src.items.filter((i) => i.status !== 'cancelled');
  if (!live.length) { toast('U stolda taom yo\'q', 'bad'); return; }
  if (!(await confirmBox(`Stol ${tableName(src.table_id)} (${live.length} ta taom, ${sum(totals(src).total)}) shu stolga qo'shilsinmi? U stol bo'shaydi.${src.discount ? ' U stoldagi chegirma bekor bo\'ladi.' : ''}`, { ok: 'Birlashtirish' }))) return;
  dispatch('xfer_in', { from: src.id, items: live }, o.id);
  dispatch('xfer_out', { to: o.id, items: live.map((i) => ({ id: i.id, qty: i.qty })) }, src.id);
  if (src.guests) dispatch('guests', { guests: (o.guests || 0) + src.guests }, o.id);
  dispatch('void', { reason: `Birlashtirildi: Stol ${tableName(o.table_id)}`, shift_id: shift()?.id }, src.id);
  toast(`Stol ${tableName(src.table_id)} qo'shildi`, 'ok');
}

async function setDiscount(o) {
  const r = await openModal({
    title: 'Chegirma',
    body: `<div class="seg" data-k style="margin-bottom:12px"><button data-v="pct" class="on">Foizda</button><button data-v="sum">So'mda</button></div>
      <div class="chips" data-pv style="margin-bottom:12px">${[5, 10, 15, 20, 30, 50].map((x) => `<button class="chip" data-v="${x}">${x}%</button>`).join('')}</div>
      <div class="field"><label data-ul>Foiz</label><input class="input money" data-val inputmode="numeric" value="${o.discount ? esc(o.discount.value) : ''}"></div>
      <div class="field"><label>Sababi</label><div class="chips" data-r>${DISCOUNT_REASONS.map((x) => `<button class="chip" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <input class="input" data-rt placeholder="yoki o'zingiz yozing" style="margin-top:8px"></div>
      <p class="hint">Chegirma menejer ruxsati bilan beriladi va hisobotda kim berganini ko'rsatadi.</p>`,
    foot: `${o.discount ? '<button class="btn danger" data-del>Chegirmani olib tashlash</button><span class="grow"></span>' : ''}<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Qo'llash</button>`,
    onOpen: (m, close) => {
      let kind = o.discount?.kind || 'pct'; let reason = o.discount?.reason || '';
      const sync = () => { m.querySelectorAll('[data-k] button').forEach((b) => b.classList.toggle('on', b.dataset.v === kind)); m.querySelector('[data-pv]').hidden = kind !== 'pct'; m.querySelector('[data-ul]').textContent = kind === 'pct' ? 'Foiz' : 'Summa (so\'m)'; };
      sync();
      m.querySelectorAll('[data-k] button').forEach((b) => b.onclick = () => { kind = b.dataset.v; sync(); });
      m.querySelectorAll('[data-pv] .chip').forEach((b) => b.onclick = () => { m.querySelector('[data-val]').value = b.dataset.v; });
      m.querySelectorAll('[data-r] .chip').forEach((b) => b.onclick = () => { reason = b.dataset.v; m.querySelectorAll('[data-r] .chip').forEach((x) => x.classList.toggle('on', x === b)); });
      m.querySelector('[data-del]')?.addEventListener('click', () => close({ del: true }));
      m.querySelector('[data-ok]').onclick = () => {
        const value = Number(m.querySelector('[data-val]').value.replace(/\s/g, '').replace(',', '.'));
        const rr = m.querySelector('[data-rt]').value.trim() || reason;
        if (!(value > 0)) { toast('Qiymatni kiriting', 'bad'); return; }
        if (!rr) { toast('Sababini tanlang', 'bad'); return; }
        close({ kind, value, reason: rr });
      };
    },
  });
  if (!r) return;
  const ap = await approve('Chegirma uchun menejer ruxsati');
  if (!ap) return;
  dispatch('discount', r.del ? { value: 0 } : { ...r, approved_by: ap }, o.id);
}

async function voidOrder(o) {
  const t = totals(o);
  if (t.paid) { toast('Avval to\'lovni bekor qiling', 'bad'); return; }
  const reason = await openModal({
    title: 'Buyurtmani bekor qilish',
    body: `<p class="hint" style="margin-bottom:12px">Buyurtma butunlay bekor qilinadi.${o.items.some((i) => i.status === 'sent') ? ' Oshxonaga yuborilgan taom bor — menejer ruxsati kerak.' : ''}</p>
      <div class="chips">${VOID_REASONS.map((x) => `<button class="chip" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>`,
    onOpen: (m, close) => m.querySelectorAll('.chip').forEach((b) => b.onclick = () => close(b.dataset.v)),
  });
  if (!reason) return;
  let ap = null;
  if (o.items.some((i) => i.status === 'sent')) { ap = await approve('Bekor qilish uchun menejer ruxsati'); if (!ap) return; }
  dispatch('void', { reason, approved_by: ap, shift_id: shift()?.id }, o.id);
  toast('Buyurtma bekor qilindi');
  go(ui.back, { order: null, draft: null });
}

/** Telefon: 9 raqam kiritiladi (+998 o'zi), "+998 90 123 45 67" ko'rinishida saqlanadi. */
const phoneDigits = (v) => { let d = String(v || '').replace(/\D/g, ''); if (d.startsWith('998')) d = d.slice(3); return d.slice(0, 9); };
const fmtLocal = (d) => [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean).join(' ');
const fmtPhone = (d) => (d ? '+998 ' + fmtLocal(d) : '');

/**
 * Olib ketish / yetkazish: faqat telefon (yetkazishda — manzil ham). Raqam to'liq yozilsa
 * doimiy mijoz va uning oxirgi manzili o'zi topiladi.
 * Qaytaradi: mijoz obyekti, null (olib ketish — raqamsiz) yoki undefined (bekor).
 */
function contactBox(type, cur = null) {
  const del = type !== 'olib';
  return openModal({
    title: del ? 'Yetkazib berish' : 'Olib ketish', size: 'wide',
    body: `<div class="contact"><div>
        <label class="lbl">Telefon raqami</label>
        <div class="phone"><span>+998</span><b data-ph></b><i></i></div>
        <div class="known" data-known></div>
        ${del ? `<label class="lbl" style="margin-top:16px">Manzil</label>
        <textarea class="input" data-a rows="3" placeholder="Ko'cha, uy, xonadon, mo'ljal">${esc(cur?.address || '')}</textarea>` : ''}
      </div>
      <div class="pad" data-pad>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button data-d="${d}">${d}</button>`).join('')}<button class="fn" data-d="clr">Tozalash</button><button data-d="0">0</button><button class="fn" data-d="del">${icon('back')}</button></div></div>`,
    foot: `${!del && !cur ? '<button class="btn" data-skip>Raqamsiz</button>' : ''}<button class="btn primary lg" data-ok>${cur ? 'Saqlash' : 'Davom etish — menyu'}</button>`,
    onOpen: (m, close) => {
      let digits = phoneDigits(cur?.phone); let known = cur?.id ? { id: cur.id, name: cur.name || '' } : null; let asked = '';
      const addr = m.querySelector('[data-a]');
      const draw = () => {
        m.querySelector('[data-ph]').textContent = fmtLocal(digits) || '';
        m.querySelector('.phone').classList.toggle('full', digits.length === 9);
        m.querySelector('[data-known]').innerHTML = known?.name ? `${icon('user')}Doimiy mijoz: <b>${esc(known.name)}</b>` : '';
        if (digits.length === 9 && asked !== digits) lookup();
        if (digits.length < 9) { known = null; asked = ''; m.querySelector('[data-known]').innerHTML = ''; }
      };
      const lookup = async () => {
        asked = digits; const q = digits;
        try {
          const r = await get('/api/customers?q=' + q);
          if (q !== digits) return;
          const c = r.customers.find((x) => phoneDigits(x.phone) === q);
          known = c ? { id: c.id, name: c.name || '' } : (r.last?.name ? { id: null, name: r.last.name } : null);
          if (addr && !addr.value.trim() && r.last?.address) { addr.value = r.last.address; toast('Oxirgi manzili qo\'yildi'); }
          draw();
        } catch { /* oflayn — qo'lda yoziladi */ }
      };
      const type_ = (d) => { digits = d === 'del' ? digits.slice(0, -1) : d === 'clr' ? '' : (digits + d).slice(0, 9); draw(); };
      m.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => type_(b.dataset.d));
      const key = (e) => {
        if (!document.body.contains(m)) { document.removeEventListener('keydown', key); return; }
        if (e.target === addr) return;
        if (/^\d$/.test(e.key)) type_(e.key); else if (e.key === 'Backspace') type_('del');
        else if (e.key === 'Enter') { e.preventDefault(); m.querySelector('[data-ok]').click(); }
      };
      document.addEventListener('keydown', key);
      m.querySelector('[data-skip]')?.addEventListener('click', () => close(null));
      m.querySelector('[data-ok]').onclick = () => {
        if (digits.length !== 9) { toast('Telefon raqamini to\'liq yozing (9 raqam)', 'bad'); return; }
        const address = addr ? addr.value.trim() : (cur?.address || '');
        if (del && !address) { toast('Manzilni yozing', 'bad'); addr.focus(); return; }
        close({ id: known?.id || cur?.id || uid('c'), name: known?.name || cur?.name || '', phone: fmtPhone(digits), address });
      };
      draw();
    },
  });
}

/** Mijoz tanlash — nasiya va yetkazish uchun. Internet bo'lsa bazadan qidiradi. */
function pickCustomer(needAddress = false) {
  return openModal({
    title: 'Mijoz', size: 'wide',
    body: `<div class="grid2"><div><label class="search" style="position:relative;display:block">${icon('search')}<input class="input" data-q placeholder="Ism yoki telefon" style="padding-left:40px" autofocus></label>
        <div data-res style="margin-top:10px;max-height:300px;overflow:auto"></div></div>
      <div><div class="lbl" style="margin-bottom:8px">Yangi mijoz</div>
        <div class="field"><input class="input" data-n placeholder="Ismi"></div><div class="field"><input class="input" data-p placeholder="Telefon" inputmode="tel"></div>
        ${needAddress ? '<div class="field"><input class="input" data-a placeholder="Manzil"></div>' : ''}
        <button class="btn primary block" data-new>Qo'shish</button></div></div>`,
    foot: `<button class="btn" data-none>Mijozsiz</button>`,
    onOpen: (m, close) => {
      const res = m.querySelector('[data-res]');
      const show = (list) => {
        res.innerHTML = list.length ? list.map((c) => `<button class="btn block" style="justify-content:space-between;margin-bottom:6px" data-c='${esc(JSON.stringify({ id: c.id, name: c.name || '', phone: c.phone || '' }))}'>
          <span>${esc(c.name || '')} <span class="hint">${esc(c.phone || '')}</span></span>${c.debt > 0 ? `<span class="badge warn">qarz ${sum(c.debt)}</span>` : ''}</button>`).join('') : '<p class="hint">Topilmadi</p>';
        res.querySelectorAll('[data-c]').forEach((b) => b.onclick = () => {
          const c = JSON.parse(b.dataset.c);
          const addr = m.querySelector('[data-a]')?.value.trim();
          close({ ...c, address: addr || '' });
        });
      };
      let t = null;
      const search = () => { clearTimeout(t); t = setTimeout(async () => { try { show((await get('/api/customers?q=' + encodeURIComponent(m.querySelector('[data-q]').value))).customers); } catch { res.innerHTML = '<p class="hint">Internet yo\'q — yangi mijoz qo\'shing</p>'; } }, 200); };
      m.querySelector('[data-q]').addEventListener('input', search); search();
      m.querySelector('[data-new]').onclick = () => {
        const name = m.querySelector('[data-n]').value.trim(); const phone = m.querySelector('[data-p]').value.trim();
        if (!name && !phone) { toast('Ism yoki telefon kiriting', 'bad'); return; }
        close({ id: uid('c'), name, phone, address: m.querySelector('[data-a]')?.value.trim() || '' });
      };
      m.querySelector('[data-none]').onclick = () => close(null);
    },
  });
}

// ---- Hisob va to'lov ----
async function precheck() {
  const o = current(); if (!o) return;
  if (totals(o).unsent) await sendKitchen(true);
  try { dispatch('precheck', {}, o.id); } catch (e) { fail(e); return; }
  await print(receiptHTML(order(o.id), ctxPrint(), { pre: true }));
  toast('Hisob chop etildi');
  renderTicket(); if (ui.view === 'order') renderRail();
}

async function payment() {
  const id = ui.order; if (!id) return;
  // Botdan kelgan, hali qabul qilinmagan buyurtma — to'lovdan oldin qabul qilinadi (mijozga xabar boradi).
  const ob = order(id);
  if (isBot(ob) && ob.ext.status === 'new') { try { dispatch('ext', { status: 'accepted' }, id); } catch { /* */ } }
  if (totals(order(id)).unsent) await sendKitchen(true);
  const done = await openModal({
    title: 'To\'lov', size: 'wide', dismiss: false,
    body: `<div class="pay"><div>
        <div class="due"><div class="l" data-dl>To'lanishi kerak</div><div class="v" data-due></div></div>
        <div class="methods">${PAY_METHODS.map((m) => `<button data-m="${m}">${esc(PAY_NAMES[m])}</button>`).join('')}</div>
        <div class="payhint">Aralash to'lov: bir qismini yozing (masalan naqd 10 000) — qolgani uchun tugma chiqadi.</div>
        <div class="amount"><small data-ml>Summa</small><span data-amt>0</span></div>
        <div class="quick" data-quick></div>
        <div class="splitp"><span>Bo'lib to'lash:</span>${[2, 3, 4].map((n) => `<button data-per="${n}">${n} kishi</button>`).join('')}<button data-byitem>Taom bo'yicha</button></div>
        <div class="hint" data-perhint></div>
        <div data-cust class="hint" style="margin-top:10px"></div></div>
      <div><div class="pad" data-pad>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button data-d="${d}">${d}</button>`).join('')}<button class="fn" data-d="000">000</button><button data-d="0">0</button><button class="fn" data-d="del">${icon('back')}</button></div>
        <button class="btn block lg" data-add style="margin-top:10px">To'lovni qo'shish</button>
        <div class="splitrow" data-split hidden></div>
        <div class="paylist" data-list hidden></div><div class="change" data-change hidden></div></div></div>`,
    foot: `<button class="btn" data-x>Yopish</button><button class="btn ok lg" data-close disabled>${icon('check')}Buyurtmani yopish</button>`,
    onOpen: (m, close) => {
      let method = 'naqd'; let amt = ''; let prefilled = false; // to'liq summa qo'yilgan — birinchi raqam uni almashtiradi
      const typed = (d) => { amt = prefilled ? d.replace(/^0+/, '') : (amt + d).replace(/^0+/, '').slice(0, 11); prefilled = false; };
      const o = () => order(id);
      const draw = () => {
        const cur = o(); if (!cur) return close(false);
        const t = totals(cur);
        const over = t.paid - t.total;
        m.querySelector('[data-due]').textContent = over > 0 ? sum(over) : sum(t.due);
        m.querySelector('[data-dl]').textContent = over > 0 ? 'Ortiqcha to\'langan — to\'lovni ✕ bilan bekor qiling' : t.paid ? `Qoldi (jami ${sum(t.total)})` : 'To\'lanishi kerak';
        m.querySelector('.due').classList.toggle('over', over > 0);
        m.querySelectorAll('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === method));
        m.querySelector('[data-ml]').textContent = method === 'naqd' ? 'Mijoz berdi' : PAY_NAMES[method];
        m.querySelector('[data-amt]').textContent = sum(amt || 0);
        const q = method === 'naqd' ? [t.due, ...[10000, 50000, 100000, 200000].map((s) => Math.ceil(t.due / s) * s)].filter((v, i, a) => v > 0 && a.indexOf(v) === i).slice(0, 5) : [t.due];
        m.querySelector('[data-quick]').innerHTML = q.map((v, i) => `<button data-q="${v}">${i === 0 ? 'Aniq: ' : ''}${sum(v)}</button>`).join('');
        m.querySelectorAll('[data-q]').forEach((b) => b.onclick = () => { amt = b.dataset.q; draw(); });
        const pays = cur.payments.filter((p) => !p.void);
        const list = m.querySelector('[data-list]');
        list.hidden = !pays.length;
        list.innerHTML = pays.map((p) => `<div class="r"><span>${esc(PAY_NAMES[p.method])}${p.change ? ` <span class="hint">(berdi ${sum(p.received)})</span>` : ''}</span><span class="row"><b>${sum(p.amount)}</b><button class="icon-btn" data-unpay="${p.id}" aria-label="Bekor">${icon('x')}</button></span></div>`).join('');
        list.querySelectorAll('[data-unpay]').forEach((b) => b.onclick = async () => {
          const ap = await approve('To\'lovni bekor qilish uchun menejer ruxsati'); if (!ap) return;
          try { dispatch('unpay', { payment_id: b.dataset.unpay, approved_by: ap }, id); } catch (e) { fail(e); } draw();
        });
        // Kiritilgan, hali qo'shilmagan summa qoldiqni yopsa — "Buyurtmani yopish" darhol ishlaydi (avval "To'lovni qo'shish" shart emas).
        const a = Number(amt) || 0;
        const covers = t.due > 0 && a >= t.due;
        const change = pays.reduce((s, p) => s + (p.change || 0), 0) + (method === 'naqd' && a > t.due && t.due > 0 ? a - t.due : 0);
        m.querySelector('[data-change]').hidden = !change;
        m.querySelector('[data-change]').innerHTML = `<span>Qaytim</span><span>${sum(change)}</span>`;
        m.querySelector('[data-cust]').innerHTML = method === 'qarz' ? (cur.customer?.id ? `Qarzga yoziladi: <b>${esc(cur.customer.name || cur.customer.phone)}</b>` : 'Qarzga — mijoz tanlanadi') : '';
        // Aralash: kiritilgan summa qoldiqdan kam — qolganini boshqa turda bitta bosishda to'lab yopish.
        const split = m.querySelector('[data-split]');
        const rest = t.due - a;
        split.hidden = !(t.due > 0 && a > 0 && rest > 0);
        if (!split.hidden) {
          split.innerHTML = `<span>${esc(PAY_NAMES[method])} <b>${sum(a)}</b> · qolgan <b>${sum(rest)}</b> so'm:</span>`
            + PAY_METHODS.filter((x) => x !== method).map((x) => `<button data-rest="${x}">${esc(PAY_NAMES[x])}</button>`).join('');
          split.querySelectorAll('[data-rest]').forEach((b) => b.onclick = () => splitPay(b.dataset.rest));
        }
        m.querySelector('[data-close]').disabled = over > 0 || (t.due > 0 && !covers);
        m.querySelector('[data-add]').disabled = t.due <= 0;
      };
      m.querySelectorAll('[data-m]').forEach((b) => b.onclick = () => { method = b.dataset.m; amt = method === 'naqd' ? '' : String(totals(o()).due); prefilled = method !== 'naqd'; draw(); });
      m.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { const d = b.dataset.d; if (d === 'del') { amt = prefilled ? '' : amt.slice(0, -1); prefilled = false; } else typed(d); draw(); });
      const addPay = async () => {
        const cur = o(); const t = totals(cur);
        const a = Number(amt) || (method === 'naqd' ? 0 : t.due);
        if (!a) { toast('Summani kiriting', 'bad'); return false; }
        if (method !== 'naqd' && a > t.due) { toast('Qoldiqdan ko\'p — naqddan boshqa to\'lov aniq summada bo\'ladi', 'bad'); return false; }
        try {
          if (method === 'qarz' && !cur.customer?.id) {
            const c = await pickCustomer(false); if (!c) return false;
            // Yetkazish/bot buyurtmasining manzili va telefoni yo'qolmasin.
            dispatch('meta', { customer: { ...c, phone: c.phone || cur.customer?.phone || '', address: c.address || cur.customer?.address || '' } }, id);
          }
          dispatch('pay', { payment: { id: uid('y'), method, amount: Math.min(a, t.due), received: method === 'naqd' ? a : undefined } }, id);
          amt = ''; method = 'naqd';
        } catch (e) { fail(e); return false; } finally { draw(); }
        return true;
      };
      m.querySelector('[data-add]').onclick = () => addPay();
      m.querySelectorAll('[data-per]').forEach((b) => b.onclick = () => {
        const t = totals(o()); const n = Number(b.dataset.per);
        const per = Math.ceil(t.total / n / 100) * 100;
        amt = String(Math.min(t.due, per)); prefilled = true; draw();
        m.querySelector('[data-perhint]').textContent = `Har kishiga ${sum(per)} so'm — har biri o'z to'lovini «To'lovni qo'shish» bilan qo'shadi, oxirgisi qoldiqni to'laydi.`;
      });
      m.querySelector('[data-byitem]').onclick = async () => {
        const cur = o(); const list = await pickItems(cur, 'Kim nimani to\'laydi — taomlarni tanlang', { ok: 'Summani olish' }); if (!list) return;
        const t = totals(cur);
        const part = list.reduce((s_, x) => s_ + Math.round(cur.items.find((i) => i.id === x.id).price * x.qty), 0);
        const share = t.subtotal ? Math.round(part * t.total / t.subtotal) : part; // chegirma va xizmat haqi ulushi bilan
        amt = String(Math.min(t.due, share)); prefilled = true; draw();
        m.querySelector('[data-perhint]').textContent = `Tanlangan taomlar: ${sum(part)}${share !== part ? ` (xizmat haqi/chegirma bilan ${sum(share)})` : ''}`;
      };
      const finish = async () => {
        if (totals(o()).due > 0 && !(await addPay())) return;
        if (totals(o()).due > 0) { toast('Hali to\'lanmagan qism bor', 'bad'); return; }
        try { dispatch('close', { shift_id: shift()?.id }, id); } catch (e) { fail(e); return; }
        close(true);
      };
      let splitting = false;
      const splitPay = async (other) => {
        if (splitting) return; splitting = true;
        try {
          if (!(await addPay())) return;
          method = other; amt = String(totals(o()).due); prefilled = true;
          if (!(await addPay())) return;
          await finish();
        } finally { splitting = false; }
      };
      m.querySelector('[data-close]').onclick = finish;
      const key = (e) => {
        if (!document.body.contains(m)) { document.removeEventListener('keydown', key); return; }
        // Ustida boshqa oyna (menejer PIN, mijoz tanlash) ochiq bo'lsa yoki maydonga yozilayotgan bo'lsa — bu oynaga tegishli emas.
        if (!isTopModal(m) || e.ordoDone || e.target.closest?.('input,textarea')) return;
        if (/^\d$/.test(e.key)) { typed(e.key); draw(); }
        else if (e.key === 'Backspace') { amt = prefilled ? '' : amt.slice(0, -1); prefilled = false; draw(); }
        else if (e.key === 'Enter') m.querySelector('[data-close]').disabled ? m.querySelector('[data-add]').click() : m.querySelector('[data-close]').click();
      };
      document.addEventListener('keydown', key);
      draw();
    },
  });
  if (done) {
    const doc = S.recent.find((x) => x.id === id) || order(id);
    if (printCfg().receipt && doc) await print(receiptHTML(doc, ctxPrint()));
    const ch = doc ? doc.payments.filter((p) => !p.void).reduce((s, p) => s + (p.change || 0), 0) : 0;
    toast(ch ? `Yopildi · qaytim ${sum(ch)} so'm` : 'Buyurtma yopildi', 'ok');
    go(ui.back, { order: null, draft: null });
  } else if (ui.view === 'order') renderTicket();
}

// =================== Tarix ===================
async function viewHistory(v) {
  const sh = shift();
  v.innerHTML = `<div class="ph"><h1>Buyurtmalar</h1><span class="sub">${sh ? `Smena №${sh.number ?? ''} · ${dateTime(sh.opened_at)} dan` : 'Oxirgi yopilganlar'}</span></div><div class="card" id="hist"><div class="empty">Yuklanmoqda…</div></div>`;
  let list = S.recent.filter((o) => !sh || o.shift_id === sh.id);
  try { if (sh) list = (await get('/api/orders?shift_id=' + encodeURIComponent(sh.id))).orders; } catch { /* oflayn — mahalliy ro'yxat */ }
  if (ui.view !== 'tarix') return;
  const tot = list.filter((o) => o.status === 'closed').reduce((s, o) => s + totals(o).total, 0);
  $('#hist').innerHTML = list.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>№</th><th>Vaqti</th><th>Turi</th><th>Ofitsiant</th><th>To'lov</th><th class="r">Summa</th><th></th></tr></thead><tbody>
    ${list.map((o) => { const t = totals(o); return `<tr class="click" data-h="${o.id}"><td><b>${esc(o.number ?? '')}</b></td><td>${time(o.opened_at)}–${time(o.closed_at)}</td>
      <td>${esc(TYPE_NAMES[o.type])}${o.table_id ? ' · ' + esc(tableName(o.table_id)) : ''}</td><td>${esc(staffName(o.waiter_id))}</td>
      <td>${o.status === 'void' ? `<span class="badge bad">Bekor · ${esc(o.void_reason || '')}</span>` : [...new Set(o.payments.filter((p) => !p.void).map((p) => PAY_NAMES[p.method]))].join(', ')}</td>
      <td class="r"><b>${sum(t.total)}</b></td><td class="r">${icon('chev')}</td></tr>`; }).join('')}
    <tr class="total"><td colspan="5">Jami (yopilgan ${list.filter((o) => o.status === 'closed').length} ta)</td><td class="r">${sum(tot)}</td><td></td></tr></tbody></table></div>`
    : `<div class="empty">${icon('list')}<div>Hali yopilgan buyurtma yo'q</div></div>`;
  $$('#hist [data-h]').forEach((r) => r.onclick = () => showReceipt(list.find((o) => o.id === r.dataset.h)));
}

function showReceipt(o) {
  if (!o) return;
  const html = receiptHTML(o, ctxPrint());
  openModal({
    title: `Buyurtma № ${o.number ?? ''}`,
    body: `<iframe style="width:100%;height:520px;border:1px solid var(--line);border-radius:8px;background:#fff" data-f></iframe>`,
    foot: `<button class="btn" data-x>Yopish</button><button class="btn primary" data-p>${icon('print')}Qayta chop etish</button>`,
    onOpen: (m) => { m.querySelector('[data-f]').srcdoc = html; m.querySelector('[data-p]').onclick = () => print(html); },
  });
}

// =================== Smena ===================
async function ensureShift() {
  if (shift()) return true;
  return openShift();
}

async function openShift() {
  const cash = await numberBox({ title: 'Smenani ochish', hint: 'Kassadagi boshlang\'ich naqd pulni kiriting (sanab chiqing)', value: '', suffix: 'so\'m', ok: 'Smenani ochish' });
  if (cash === undefined) return false;
  try { dispatch('shift.open', { shift_id: uid('s'), cash }); } catch (e) { fail(e); return false; }
  toast('Smena ochildi', 'ok');
  renderTop();
  if (ui.view === 'smena') renderView();
  return true;
}

async function shiftReport(sh) {
  try { return (await get('/api/shift/report' + (sh?.id && !sh.pending ? '?id=' + encodeURIComponent(sh.id) : ''))).summary; } catch {
    const docs = S.recent.filter((o) => o.shift_id === sh.id);
    return { ...shiftSummary(sh, docs, []), offline: true };
  }
}

async function viewShift(v) {
  const sh = shift();
  if (!sh) {
    v.innerHTML = `<div class="card" style="max-width:520px;margin:40px auto"><div class="card-b" style="text-align:center;padding:40px">${icon('cash')}
      <h2 style="margin:10px 0 6px">Smena yopiq</h2><p class="hint" style="margin-bottom:18px">Sotuvni boshlash uchun smenani oching — kassadagi naqd pulni kiritasiz.</p>
      <button class="btn accent lg" data-open-shift>Smenani ochish</button></div></div>`;
    return;
  }
  v.innerHTML = `<div class="ph"><h1>Smena${sh.number ? ' №' + sh.number : ''}</h1><span class="sub">ochildi ${dateTime(sh.opened_at)} · ${esc(staffName(sh.opened_by))}</span></div>
    <div class="panel-grid"><div class="card"><div class="card-h"><h3>Joriy holat (X-hisobot)</h3><span class="grow"></span><button class="btn sm" data-xprint>${icon('print')}Chop etish</button></div><div class="card-b" id="xrep"><div class="empty">Yuklanmoqda…</div></div></div>
    <div><div class="actions">
      <button class="btn" data-cash="kirim">${icon('plus')}Kassaga pul qo'yish</button><button class="btn" data-cash="chiqim">${icon('minus')}Kassadan pul olish</button>
      <button class="btn" data-expense>${icon('wallet')}Rasxod (kassadan)</button><button class="btn" data-debtpay>${icon('book')}Qarz to'lovi</button>
      <button class="btn danger solid" data-close-shift style="grid-column:1/-1">${icon('lock')}Smenani yopish (Z-hisobot)</button></div>
      <p class="hint" style="margin-top:12px">Rasxod — kassadagi naqd puldan to'langan xarajat (masalan, bozorga, taksiga). U smena oxirida "kassada bo'lishi kerak" summasidan ayiriladi.</p></div></div>`;
  const s = await shiftReport(sh);
  if (ui.view !== 'smena' || !$('#xrep')) return;
  const row = (l, val, cls = '') => `<tr><td>${esc(l)}</td><td class="r ${cls}">${val}</td></tr>`;
  $('#xrep').innerHTML = `<div class="stats" style="margin-bottom:16px">
      <div class="stat accent"><div class="l">Savdo</div><div class="v">${sum(s.total)}</div><div class="s">${s.orders} ta buyurtma · o'rtacha ${sum(s.avg_check)}</div></div>
      <div class="stat"><div class="l">Kassada bo'lishi kerak</div><div class="v">${sum(s.expected_cash)}</div><div class="s">naqd pul</div></div></div>
    <table class="tbl">${row('Boshlang\'ich naqd', sum(sh.opening_cash))}
      ${PAY_METHODS.map((m) => s.by_method[m] ? row(PAY_NAMES[m], sum(s.by_method[m])) : '').join('')}
      ${s.debt_paid && Object.values(s.debt_paid).some(Boolean) ? row('Qarz to\'lovlari', sum(Object.values(s.debt_paid).reduce((a, b) => a + b, 0))) : ''}
      ${s.cash_in ? row('Kassaga qo\'yildi', sum(s.cash_in)) : ''}${s.cash_out ? row('Kassadan olindi', '−' + sum(s.cash_out), 'neg') : ''}
      ${s.expenses ? row('Rasxodlar', '−' + sum(s.expenses), 'neg') : ''}${s.supplier_paid ? row('Yetkazib beruvchiga', '−' + sum(s.supplier_paid), 'neg') : ''}
      ${row('Chegirmalar', s.discount ? '−' + sum(s.discount) : '0')}${row('Xizmat haqi', sum(s.service))}
      ${row('Bekor qilingan taomlar', `${s.cancelled_items} ta · ${sum(s.cancelled_sum)}`, s.cancelled_items ? 'neg' : '')}
      ${row('Bekor qilingan buyurtmalar', s.voided)}</table>
    ${s.offline ? '<p class="hint" style="margin-top:10px">Internet yo\'q — faqat shu kassadagi ma\'lumot ko\'rsatilmoqda.</p>' : ''}`;
  $('[data-xprint]').onclick = () => print(zReportHTML(sh, s, ctxPrint()));
}

async function cashMove(kind) {
  const sh = shift(); if (!sh) return;
  const r = await openModal({
    title: kind === 'kirim' ? 'Kassaga pul qo\'yish' : 'Kassadan pul olish',
    body: `<div class="field"><label>Summa</label><input class="input money" data-a inputmode="numeric" autofocus></div>
      <div class="field"><label>Izoh</label><input class="input" data-r placeholder="${kind === 'kirim' ? 'masalan: maydalash uchun' : 'masalan: egasiga topshirildi (inkassatsiya)'}"></div>`,
    foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
    onOpen: (m, close) => { const a = m.querySelector('[data-a]'); a.addEventListener('input', () => { const d = a.value.replace(/\D/g, ''); a.value = d ? sum(d) : ''; });
      m.querySelector('[data-ok]').onclick = () => { const v = Number(a.value.replace(/\D/g, '')); if (!v) { toast('Summani kiriting', 'bad'); return; } close({ v, r: m.querySelector('[data-r]').value.trim() }); }; },
  });
  if (!r) return;
  try { dispatch('shift.cash', { shift_id: sh.id, move_id: uid('m'), kind, amount: r.v, reason: r.r }); toast('Saqlandi', 'ok'); } catch (e) { fail(e); }
  setTimeout(() => ui.view === 'smena' && renderView(), 600);
}

async function expense() {
  const sh = shift(); if (!sh) return;
  let cats = ['Ish haqi', 'Ijara', 'Kommunal', 'Transport', 'Xo\'jalik mollari', 'Ta\'mirlash', 'Bozorlik', 'Boshqa'];
  try { cats = (await get('/api/expense-cats')).categories; } catch { /* */ }
  const r = await openModal({
    title: 'Rasxod (kassadan)',
    body: `<div class="field"><label>Turi</label><div class="chips" data-c>${cats.map((c) => `<button class="chip" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>
      <div class="field"><label>Summa</label><input class="input money" data-a inputmode="numeric"></div>
      <div class="field"><label>Izoh (nima uchun)</label><input class="input" data-n placeholder="masalan: gaz uchun to'lov"></div>`,
    foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
    onOpen: (m, close) => {
      let cat = '';
      m.querySelectorAll('[data-c] .chip').forEach((b) => b.onclick = () => { cat = b.dataset.v; m.querySelectorAll('[data-c] .chip').forEach((x) => x.classList.toggle('on', x === b)); });
      const a = m.querySelector('[data-a]'); a.addEventListener('input', () => { const d = a.value.replace(/\D/g, ''); a.value = d ? sum(d) : ''; });
      m.querySelector('[data-ok]').onclick = () => { const v = Number(a.value.replace(/\D/g, '')); if (!cat) { toast('Turini tanlang', 'bad'); return; } if (!v) { toast('Summani kiriting', 'bad'); return; } close({ cat, v, n: m.querySelector('[data-n]').value.trim() }); };
    },
  });
  if (!r) return;
  try { dispatch('expense', { expense_id: uid('e'), category: r.cat, amount: r.v, note: r.n, pay_from: 'kassa', shift_id: sh.id }); toast('Rasxod yozildi', 'ok'); } catch (e) { fail(e); }
  setTimeout(() => ui.view === 'smena' && renderView(), 600);
}

async function debtPay() {
  const sh = shift(); if (!sh) return;
  let list = [];
  try { list = (await get('/api/customers?q=')).customers.filter((c) => c.debt > 0); } catch { toast('Qarz to\'lovi uchun internet kerak', 'bad'); return; }
  const c = await openModal({
    title: 'Qarz to\'lovi — mijozni tanlang', size: 'wide',
    body: list.length ? `<table class="tbl">${list.map((x) => `<tr class="click" data-c="${esc(x.id)}"><td><b>${esc(x.name || '')}</b> <span class="hint">${esc(x.phone || '')}</span></td><td class="r neg"><b>${sum(x.debt)}</b></td></tr>`).join('')}</table>` : '<div class="empty">Qarzdor mijoz yo\'q</div>',
    onOpen: (m, close) => m.querySelectorAll('[data-c]').forEach((r) => r.onclick = () => close(list.find((x) => x.id === r.dataset.c))),
  });
  if (!c) return;
  const r = await openModal({
    title: `${c.name || c.phone} — qarz ${sum(c.debt)} so'm`,
    body: `<div class="seg" data-m style="margin-bottom:12px">${['naqd', 'karta', 'click', 'payme', 'uzum'].map((x, i) => `<button data-v="${x}" class="${i ? '' : 'on'}">${PAY_NAMES[x]}</button>`).join('')}</div>
      <div class="field"><label>Summa</label><input class="input money" data-a inputmode="numeric" value="${sum(c.debt)}"></div>`,
    foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Qabul qilish</button>`,
    onOpen: (m, close) => {
      let method = 'naqd';
      m.querySelectorAll('[data-m] button').forEach((b) => b.onclick = () => { method = b.dataset.v; m.querySelectorAll('[data-m] button').forEach((x) => x.classList.toggle('on', x === b)); });
      const a = m.querySelector('[data-a]'); a.addEventListener('input', () => { const d = a.value.replace(/\D/g, ''); a.value = d ? sum(d) : ''; });
      m.querySelector('[data-ok]').onclick = () => { const v = Number(a.value.replace(/\D/g, '')); if (!v || v > c.debt) { toast('Summa noto\'g\'ri (qarzdan ko\'p bo\'lmasin)', 'bad'); return; } close({ v, method }); };
    },
  });
  if (!r) return;
  try { dispatch('debt.pay', { customer_id: c.id, move_id: uid('m'), amount: r.v, method: r.method, shift_id: sh.id }); toast('Qarz to\'lovi qabul qilindi', 'ok'); } catch (e) { fail(e); }
  setTimeout(() => ui.view === 'smena' && renderView(), 800);
}

async function closeShift() {
  const sh = shift(); if (!sh) return;
  const open = openOrders();
  if (open.length) { toast(`Avval ochiq buyurtmalarni yoping (${open.length} ta)`, 'bad'); return; }
  if (S.outbox.length && !S.online) { toast('Internet yo\'q — smena yopilishi uchun ma\'lumot serverga yetib borishi kerak', 'bad'); return; }
  const s = await shiftReport(sh);
  const counted = await numberBox({ title: 'Smenani yopish', hint: `Kassadagi naqd pulni sanab kiriting. Tizim bo'yicha: ${sum(s.expected_cash)} so'm`, suffix: 'so\'m', ok: 'Yopish' });
  if (counted === undefined) return;
  const diff = counted - s.expected_cash;
  if (diff && !(await confirmBox(`Farq: ${sum(diff)} so'm (${diff < 0 ? 'kam' : 'ortiqcha'}). Shunday yopilsinmi?`, { ok: 'Yopish', danger: diff < 0 }))) return;
  try { dispatch('shift.close', { shift_id: sh.id, counted }); } catch (e) { fail(e); return; }
  await print(zReportHTML({ ...sh, closed_at: new Date().toISOString() }, { ...s, counted_cash: counted, diff }, ctxPrint(), { final: true }));
  toast('Smena yopildi', 'ok');
  go('smena');
}

// =================== Eslatmalar ===================
function viewNotes(v) {
  v.innerHTML = `<div class="ph"><h1>Eslatmalar</h1><span class="sub">Smenalar o'rtasida: bron, buyurtma, nima tugadi, nima qilish kerak</span></div>
    <div class="panel-grid"><div class="card" id="notes"></div>
    <div class="card"><div class="card-b"><div class="field"><label>Yangi eslatma</label><textarea class="input" id="ntext" rows="4" placeholder="masalan: Bugun 19:00 da 12 kishilik bron, VIP 2"></textarea></div>
      <button class="btn primary block" id="nadd">${icon('plus')}Qo'shish</button></div></div></div>`;
  renderNotesList();
  $('#nadd').onclick = () => {
    const t = $('#ntext').value.trim(); if (!t) return;
    try { dispatch('note.add', { note_id: uid('n'), text: t }); $('#ntext').value = ''; renderNotesList(); renderRail(); } catch (e) { fail(e); }
  };
}

function renderNotesList() {
  const box = $('#notes'); if (!box) return;
  const list = notes();
  box.innerHTML = list.length ? list.map((n) => `<div class="note"><div class="tx">${esc(n.text)}<div class="mt">${esc(staffName(n.user_id))} · ${dateTime(n.at)}</div></div>
    <button class="btn sm" data-done="${esc(n.id)}">${icon('check')}Bajarildi</button></div>`).join('') : `<div class="empty">${icon('note')}<div>Eslatma yo'q</div></div>`;
  $$('[data-done]', box).forEach((b) => b.onclick = () => { try { dispatch('note.done', { note_id: b.dataset.done }); renderNotesList(); renderRail(); } catch (e) { fail(e); } });
}

// =================== Qulf (PIN) ===================
// Egasi yoki menejer kassada PIN kiritsa — boshqaruv uchun ham sessiya shu zahoti olinadi:
// kassadagi «Boshqaruv» tugmasi panelni qayta PIN so'ramasdan ochadi.
let MGR = null;
function getMgrSession(u, pin) {
  MGR = null;
  post('/api/pin', { user_id: u.id, pin }).then((r) => { if (S.user?.id === u.id) MGR = { t: r.token, u: r.user }; }).catch(() => {});
}
function openAdmin() {
  window.open(MGR ? '/boshqaruv#kirish=' + encodeURIComponent(JSON.stringify(MGR)) : '/boshqaruv', '_blank');
}

let lockEl = null;
function lock() {
  S.user = null; MGR = null;
  if (lockEl) lockEl.remove();
  lockEl = document.createElement('div');
  lockEl.className = 'lock';
  const staff = S.boot?.staff || [];
  const draw = () => {
    const d = new Date(Date.now() + 5 * 3600e3);
    const days = ['Yakshanba', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba'];
    const months = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
    lockEl.querySelector('.ctime').textContent = time(new Date());
    lockEl.querySelector('.cdate').textContent = `${days[d.getUTCDay()]}, ${d.getUTCDate()}-${months[d.getUTCMonth()]}`;
  };
  lockEl.innerHTML = `<div class="top"><div class="logo"><span class="mk">${MARK}</span><b>ordo</b></div><span style="opacity:.7">${esc(S.boot?.settings?.name || S.boot?.company?.name || '')}</span></div>
    <div class="ctime"></div><div class="cdate"></div><div class="who" data-who>
    ${staff.map((u) => `<button data-u="${u.id}">${avatar(u, 48)}<span class="nm">${esc(u.name)}</span><span class="rl">${esc(ROLE_NAMES[u.role])}</span></button>`).join('')}</div>
    <div class="pinbox" data-pin hidden></div><img class="orda" src="/img/xudoyorxon-orda.svg?v=3" alt="">`;
  document.body.appendChild(lockEl);
  draw();
  const clock = setInterval(() => { if (!document.body.contains(lockEl)) clearInterval(clock); else draw(); }, 10000);
  lockEl.querySelectorAll('[data-u]').forEach((b) => b.onclick = () => askPin(staff.find((u) => u.id === Number(b.dataset.u))));
}

function askPin(u) {
  const box = lockEl.querySelector('[data-pin]');
  lockEl.querySelector('[data-who]').hidden = true;
  box.hidden = false; lockEl.classList.add('pin');
  let pin = '';
  box.innerHTML = `${avatar(u, 56)}<div style="margin-top:10px;font-size:18px;font-weight:500">${esc(u.name)}</div><div class="dots" data-dots>${'<i></i>'.repeat(4)}</div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button data-d="${d}">${d}</button>`).join('')}<button class="fn" data-d="back">Orqaga</button><button data-d="0">0</button><button class="fn" data-d="del">${icon('back')}</button></div>`;
  const dots = box.querySelector('[data-dots]');
  const drawDots = () => { const n = Math.max(4, pin.length); dots.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join(''); };
  let busy = false; let wrongT = null;
  const wrong = () => { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); pin = ''; drawDots(); };
  const check = async () => {
    if (busy) return; busy = true;
    const tried = pin;
    const ok = sameHex(await pinHash(tried, u.pin_salt), u.pin_hash);
    busy = false;
    if (ok) { document.removeEventListener('keydown', key); if (MANAGER_ROLES.includes(u.role)) getMgrSession(u, tried); unlock(u); return; }
    if (pin !== tried) { if (pin.length >= 4) check(); return; } // tekshirilayotganda davomi terildi
    // PIN 4–6 raqam: 6 ta bo'lsa darhol, aks holda bir oz kutib (davomi terilmasa) xato ko'rsatiladi.
    if (tried.length >= 6) wrong(); else { clearTimeout(wrongT); wrongT = setTimeout(() => { if (pin === tried) wrong(); }, 1100); }
  };
  const put = (d) => {
    clearTimeout(wrongT);
    if (d === 'back') { document.removeEventListener('keydown', key); lockEl.querySelector('[data-who]').hidden = false; box.hidden = true; lockEl.classList.remove('pin'); return; }
    if (d === 'del') pin = pin.slice(0, -1); else if (pin.length < 6) pin += d;
    drawDots();
    if (pin.length >= 4) check();
  };
  const key = (e) => { if (/^\d$/.test(e.key)) put(e.key); else if (e.key === 'Backspace') put('del'); else if (e.key === 'Escape') put('back'); };
  document.addEventListener('keydown', key);
  box.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => put(b.dataset.d));
}

function unlock(u) {
  S.user = u;
  lockEl?.remove(); lockEl = null;
  idle();
  mount();
}

let idleT = null;
function idle() {
  clearTimeout(idleT);
  const min = Number(localStorage.getItem('ordo.lockmin') || 10);
  if (min > 0) idleT = setTimeout(() => { if (!document.querySelector('.modal')) lock(); else idle(); }, min * 60e3);
}

// =================== Sozlamalar (qurilma) ===================
async function meMenu() {
  const a = await openModal({
    title: S.user.name,
    body: `<div class="actions"><button class="btn" data-a="lock">${icon('lock')}Qulflash</button><button class="btn" data-a="smena">${icon('cash')}Smena</button>
      ${isManager() ? `<button class="btn" data-a="admin">${icon('gear')}Boshqaruv paneli</button>` : ''}
      <button class="btn" data-a="device">${icon('print')}Chek va printer</button><button class="btn" data-a="reload">${icon('wifi')}Menyuni yangilash</button>
      ${S.failed.length ? `<button class="btn" data-a="failed">${icon('alert')}Rad etilgan amallar</button>` : ''}</div>`,
    onOpen: (m, close) => m.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => close(b.dataset.a)),
  });
  if (a === 'lock') lock();
  else if (a === 'smena') go('smena');
  else if (a === 'admin') openAdmin();
  else if (a === 'device') deviceSettings();
  else if (a === 'reload') { try { await refreshBoot(); toast('Menyu yangilandi', 'ok'); renderView(); } catch (e) { fail(e); } }
  else if (a === 'failed') showFailed();
}

function deviceSettings() {
  const c = printCfg();
  openModal({
    title: 'Chek va printer (shu kassa)',
    body: `<div class="field"><label>Chop etish</label><div class="seg" data-mode><button data-v="browser">Printer orqali</button><button data-v="off">O'chiq</button></div>
        <p class="hint">Chrome'ni <code>--kiosk-printing</code> bilan ochsangiz chek oynasiz, darhol bosiladi.</p></div>
      <div class="field"><label>Qog'oz eni</label><div class="seg" data-paper><button data-v="80">80 mm</button><button data-v="58">58 mm</button></div></div>
      <label class="row" style="margin-bottom:10px"><input type="checkbox" data-k ${c.kitchen ? 'checked' : ''}> Oshxonaga yuborilganda sex cheki chiqsin</label>
      <label class="row" style="margin-bottom:10px"><input type="checkbox" data-r ${c.receipt ? 'checked' : ''}> To'lovdan keyin mijoz cheki chiqsin</label>
      <div class="field"><label>Faolsizlikda qulflash (daqiqa, 0 — o'chiq)</label><input class="input" data-lock inputmode="numeric" value="${esc(localStorage.getItem('ordo.lockmin') || 10)}"></div>`,
    foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
    onOpen: (m, close) => {
      const seg = (sel, val) => m.querySelectorAll(sel + ' button').forEach((b) => { b.classList.toggle('on', b.dataset.v === val); b.onclick = () => { m.querySelectorAll(sel + ' button').forEach((x) => x.classList.toggle('on', x === b)); }; });
      seg('[data-mode]', c.mode); seg('[data-paper]', c.paper);
      m.querySelector('[data-ok]').onclick = () => {
        setPrintCfg({ mode: m.querySelector('[data-mode] .on').dataset.v, paper: m.querySelector('[data-paper] .on').dataset.v, kitchen: m.querySelector('[data-k]').checked, receipt: m.querySelector('[data-r]').checked });
        const lm = Number(String(m.querySelector('[data-lock]').value).replace(',', '.').replace(/\s/g, ''));
        if (!Number.isFinite(lm) || lm < 0) { toast('Qulflash vaqti son bo\'lsin, masalan 10', 'bad'); return; }
        localStorage.setItem('ordo.lockmin', String(lm));
        idle(); close(true); toast('Saqlandi', 'ok');
      };
    },
  });
}

const OP_NAMES = { open: 'Buyurtma ochish', add: 'Taom qo\'shish', qty: 'Sonini o\'zgartirish', remove: 'Taomni o\'chirish', send: 'Oshxonaga yuborish',
  cancel: 'Taomni bekor qilish', discount: 'Chegirma', service: 'Xizmat haqi', move: 'Stolni almashtirish', meta: 'Mijoz / izoh', pay: 'To\'lov',
  unpay: 'To\'lovni bekor qilish', close: 'Buyurtmani yopish', void: 'Buyurtmani bekor qilish', ext: 'Bot holati', 'shift.open': 'Smena ochish',
  'shift.close': 'Smena yopish', 'shift.cash': 'Kassa puli', expense: 'Rasxod', 'debt.pay': 'Qarz to\'lovi' };

function showFailed() {
  openModal({
    title: 'Server rad etgan amallar', size: 'wide',
    body: `<p class="hint" style="margin-bottom:12px">Bu amallar boshqa kassada o'zgartirilgan buyurtmaga to'g'ri kelmadi yoki ruxsat yo'q edi. Buyurtmaning to'g'ri holati ekranda.</p>
      <table class="tbl">${S.failed.map((f) => `<tr><td>${dateTime(f.at)}</td><td>${esc(OP_NAMES[f.op?.type] || f.op?.type || '')}</td><td>${esc(f.message || f.error)}</td></tr>`).join('')}</table>`,
    foot: `<button class="btn" data-clear>Tozalash</button><button class="btn primary" data-x>Yopish</button>`,
    onOpen: (m, close) => m.querySelector('[data-clear]').onclick = () => { S.failed = []; try { localStorage.removeItem('ordo.failed'); } catch { /* */ } renderTop(); close(); },
  });
}

// =================== Hodisalar ===================
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button,[data-line],[data-h],[data-order]');
  if (!t || !S.user || t.closest('.modal') || t.closest('.lock')) return;
  const d = t.dataset;
  idle();
  if (d.nav) {
    if (d.nav === 'lock') return lock();
    if (d.nav === 'admin') return openAdmin();
    return go(d.nav, { order: null, draft: null });
  }
  if ('back' in d) return go(ui.back, { order: null, draft: null });
  if ('openShift' in d) return openShift();
  if ('me' in d) return meMenu();
  if ('failed' in d) return showFailed();
  if (d.hall) { ui.hall = Number(d.hall); return renderView(); }
  if (d.table) {
    if (!(await ensureShift())) return;
    return go('order', { back: 'zal', order: null, draft: { type: 'zal', table_id: Number(d.table), guests: 0, waiter_id: S.user.id } });
  }
  if (d.bacc) { e.stopPropagation(); return botAccept(d.bacc); }
  if (d.bway) { e.stopPropagation(); return botMove(d.bway, 'onway'); }
  if (d.qsend || d.qpay) {
    e.stopPropagation();
    const o = order(d.qsend || d.qpay); if (!o) return;
    go('order', { back: listType(o) === 'olib' ? 'olib' : 'yetkazish', order: o.id, draft: null });
    return d.qsend ? sendKitchen() : payment();
  }
  if (d.order) { const o = order(d.order); return go('order', { back: o?.type === 'zal' ? 'zal' : o && listType(o) === 'olib' ? 'olib' : 'yetkazish', order: d.order, draft: null }); }
  if ('customer' in d) {
    const o = current(); const base = o || ui.draft; if (!base) return;
    const c = base.type === 'zal' ? await pickCustomer(false) : await contactBox(base.type, base.customer || {});
    if (c === undefined) return;
    try { if (o) dispatch('meta', { customer: c }, o.id); else ui.draft.customer = c; } catch (er) { fail(er); }
    return renderTicket();
  }
  if (d.new) {
    if (!(await ensureShift())) return;
    let customer = null;
    if (d.new === 'olib' || d.new === 'yetkazish') { customer = await contactBox(d.new); if (customer === undefined) return; }
    return go('order', { back: d.new, order: null, draft: { type: d.new, customer, waiter_id: S.user.id } });
  }
  if (d.cat) { ui.cat = Number(d.cat); ui.search = ''; const s = $('#psearch'); if (s) s.value = ''; $$('#ctabs [data-cat]').forEach((b) => b.classList.toggle('on', b === t)); return renderProducts(); }
  if (d.p) {
    const p = S.boot.products.find((x) => x.id === Number(d.p)); if (!p) return;
    const n = Number(ui.buf) || 0; ui.buf = '';
    if (modsOf(p.id).length && !(S.stop.has(p.id) || p.stop)) {
      const r = await modPicker(p, { qty: n && p.unit !== 'kg' ? n : 1 }); if (!r) return renderTicket();
      return addProduct(p, { qty: p.unit === 'kg' ? undefined : r.qty, mods: r.mods });
    }
    addProduct(p, n && p.unit !== 'kg' ? { qty: n } : {}); return;
  }
  if (d.k) return padKey(d.k);
  if (d.inc || d.dec) {
    const o = current(); const it = o?.items.find((i) => i.id === (d.inc || d.dec)); if (!it) return;
    try { if (d.dec && it.qty <= 1) dispatch('remove', { item_id: it.id }, o.id); else dispatch('qty', { item_id: it.id, qty: it.qty + (d.inc ? 1 : -1) }, o.id); } catch (er) { fail(er); }
    renderTicket(); renderCounts(); return;
  }
  if (d.line) { if (ui.sel === d.line) return lineMenu(d.line); ui.sel = d.line; return renderTicket(); }
  if ('send' in d) return sendKitchen();
  if ('precheck' in d) return precheck();
  if ('pay' in d) return payment();
  if ('omenu' in d) return orderMenu();
  if ('guests' in d) return setGuests(current());
  if ('waiter' in d) return setWaiter(current());
  if ('ocomment' in d) { const o = current(); const c = await commentBox(o?.comment, 'Buyurtmaga izoh'); if (c != null && o) { dispatch('meta', { comment: c }, o.id); renderTicket(); } return; }
  if (d.cash) return cashMove(d.cash);
  if ('expense' in d) return expense();
  if ('debtpay' in d) return debtPay();
  if ('closeShift' in d) return closeShift();
});

// Shtrix-kod skaneri: klaviatura kabi tez raqamlar + Enter.
let scan = ''; let scanAt = 0;
document.addEventListener('keydown', (e) => {
  if (!S.user || document.querySelector('.modal') || e.target.matches('input,textarea')) return;
  const now = Date.now();
  if (now - scanAt > 80) scan = '';
  scanAt = now;
  if (/^\d$/.test(e.key)) { scan += e.key; return; }
  if (e.key === 'Enter' && scan.length >= 6) {
    const code = scan; scan = '';
    const p = S.boot.products.find((x) => x.barcode === code);
    if (!p) { toast(`Shtrix-kod topilmadi: ${code}`, 'bad'); return; }
    if (ui.view === 'order') addProduct(p);
    else { go('order', { back: 'olib', order: null, draft: { type: 'olib', waiter_id: S.user.id } }); addProduct(p); }
  }
});
document.addEventListener('pointerdown', () => idle(), { passive: true });
setInterval(() => { const c = $('#clock'); if (c) c.textContent = time(new Date()); const cd = $('#cdate'); if (cd) cd.textContent = dayLabel(); if (ui.view === 'zal' && S.user && !document.querySelector('.modal')) renderView(); }, 30000);

// =================== Telegram bot buyurtmalari ===================
// Kassa har 8 soniyada serverdan botni so'ratadi; yangi buyurtma kelsa oyna ochiladi va
// qabul qilinmaguncha ovoz chalinadi. Qabul qilinsa — oshxonaga yuboriladi, mijozga botdan xabar boradi.
let botTimer = null;
function botPoll(ms = 8000) {
  clearTimeout(botTimer);
  if (setting('bot_on') !== '1') return;
  botTimer = setTimeout(async () => {
    try {
      const r = await post('/api/bot/pull', {});
      S.botError = r.error || '';
      if (r.created || r.changed || r.sent) flushSoon(10);
    } catch { /* internet yo'q — keyingi safar */ }
    botPoll();
  }, ms);
}

const botNew = () => openOrders().filter((o) => isBot(o) && o.ext.status === 'new').sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at));
let audioCtx = null; let ringTimer = null; let botModal = null; let botMuteUntil = 0; const botSnooze = new Map();
// Brauzer ovozni faqat foydalanuvchi ekranga tekkandan keyin ruxsat beradi — birinchi teginishda ovoz tayyorlab qo'yiladi.
const unlockAudio = () => { try { audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch { /* */ } };
document.addEventListener('pointerdown', unlockAudio, { once: true, capture: true });
document.addEventListener('keydown', unlockAudio, { once: true, capture: true });
function ring() {
  if (Date.now() < botMuteUntil) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime;
    [[880, 0], [1175, 0.18], [1568, 0.36], [1175, 0.9], [1568, 1.08]].forEach(([f, d]) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + d); g.gain.exponentialRampToValueAtTime(0.35, t0 + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d + 0.3);
      o.connect(g).connect(audioCtx.destination); o.start(t0 + d); o.stop(t0 + d + 0.32);
    });
  } catch { /* ovoz qo'llanmaydi */ }
}
function botWatch() {
  const list = botNew();
  if (!list.length) { clearInterval(ringTimer); ringTimer = null; return; }
  if (!ringTimer) { ring(); ringTimer = setInterval(() => (botNew().length ? ring() : (clearInterval(ringTimer), ringTimer = null)), 4000); }
  const lk = document.querySelector('.lock');
  if (lk && !lk.querySelector('.botbar')) lk.insertAdjacentHTML('afterbegin', `<div class="botbar">${icon('send')}Botdan yangi buyurtma — kassaga kiring</div>`);
  const due = list.filter((o) => !(botSnooze.get(o.id) > Date.now()));
  // Kassir to'lov yoki boshqa oynada bo'lsa — ustidan ochilmaydi (ovoz baribir chalinadi), oyna yopilgach chiqadi.
  if (S.user && !lk && !botModal && due.length && !document.querySelector('.modal')) showBotOrder(due[0]);
}

function botOrderHTML(o) {
  const t = totals(o);
  const live = o.items.filter((i) => i.status !== 'cancelled');
  return `<div class="botord">
    <div class="bo-h"><div><div class="bo-n">Bot №${esc(o.ext.number)}</div><div class="hint">${esc(o.ext.delivery === 'pickup' ? 'Olib ketadi' : 'Yetkazib berish')} · ${time(o.ext.at || o.opened_at)} · ${since(o.ext.at || o.opened_at)} oldin</div></div>
      <div class="bo-t">${sum(t.total)} <small>so'm</small></div></div>
    <div class="bo-c">${o.customer?.name ? `<div>${icon('user')}<b>${esc(o.customer.name)}</b>${o.ext.username ? ` <span class="hint">@${esc(o.ext.username)}</span>` : ''}</div>` : ''}
      ${o.customer?.phone ? `<div>${icon('phone')}<b>${esc(o.customer.phone)}</b></div>` : ''}
      ${o.customer?.address ? `<div>${icon('truck')}${esc(o.customer.address)}</div>` : ''}
      <div>${icon('card')}${o.ext.pay === 'karta' ? 'Kartaga o\'tkazdi — chek botda' : 'Naqd to\'laydi'}</div>
      ${o.comment ? `<div class="hint">${esc(o.comment)}</div>` : ''}</div>
    <ul class="bo-l">${live.map((i) => `<li><b>${qty(i.qty)}×</b><span>${esc(i.name)}${i.comment ? ` <i>${esc(i.comment)}</i>` : ''}</span><span>${i.price ? sum(lineSum(i)) : '0'}</span></li>`).join('')}</ul>
    ${t.discount ? `<div class="bo-r"><span>Chegirma (${esc(o.discount?.reason || '')})</span><span>−${sum(t.discount)}</span></div>` : ''}
  </div>`;
}

async function showBotOrder(o) {
  botModal = o.id;
  const left = botNew().length - 1;
  const r = await openModal({
    title: 'Botdan buyurtma', size: 'wide', dismiss: false,
    body: botOrderHTML(o) + (left > 0 ? `<p class="hint" style="margin-top:10px">Yana ${left} ta yangi buyurtma kutmoqda</p>` : ''),
    foot: `<button class="btn danger" data-rej>Rad etish</button><button class="btn" data-later>Keyinroq</button><button class="btn accent lg" data-acc>${icon('check')}Qabul qilish — oshxonaga</button>`,
    onOpen: (m, close) => {
      m.querySelector('[data-acc]').onclick = () => close('acc');
      m.querySelector('[data-later]').onclick = () => close('later');
      m.querySelector('[data-rej]').onclick = () => close('rej');
      m.querySelector('.box')?.classList.add('bot-pop');
    },
  });
  botModal = null;
  if (r === 'acc') await botAccept(o.id);
  else if (r === 'rej') await botReject(o.id);
  else if (r === 'later') { botSnooze.set(o.id, Date.now() + 60000); botMuteUntil = Date.now() + 60000; setTimeout(() => { botMuteUntil = 0; botWatch(); }, 60500); toast('1 daqiqadan keyin yana eslatiladi'); return; }
  setTimeout(botWatch, 300);
}

async function botAccept(id) {
  const o = order(id); if (!isBot(o)) return;
  if (!shift()) { const ok = await ensureShift(); if (!ok) return; }
  try { dispatch('ext', { status: 'accepted' }, id); } catch (e) { fail(e); return; }
  await sendKitchen(true, id);
  toast(`Bot №${o.ext.number} qabul qilindi — mijozga xabar boradi`, 'ok');
  refresh();
}

async function botMove(id, to) {
  const o = order(id); if (!isBot(o)) return;
  try { dispatch('ext', { status: to }, id); } catch (e) { fail(e); return; }
  toast(o.ext.delivery === 'pickup' ? 'Mijozga "buyurtma tayyor" xabari boradi' : 'Mijozga "buyurtma yo\'lda" xabari boradi', 'ok');
  refresh();
}

async function botReject(id) {
  const o = order(id); if (!isBot(o)) return;
  const reason = await commentBox('', 'Rad etish sababi (mijozga bekor qilindi deb boradi)', ['Mahsulot tugagan', 'Yetkazib bera olmaymiz', 'Ish vaqti tugagan', 'Mijoz javob bermadi', 'Mijoz bekor qildi']);
  if (!reason) { setTimeout(botWatch, 300); return; }
  try { dispatch('void', { reason, shift_id: shift()?.id || null }, id); } catch (e) { fail(e); return; }
  toast(`Bot №${o.ext.number} rad etildi`);
  refresh();
}

// =================== Ishga tushirish ===================
(async () => {
  on(() => { if (S.user) refresh(); botWatch(); });
  if (!S.boot) {
    document.body.innerHTML += '<div class="lock"><div class="ctime" style="font-size:22px">Yuklanmoqda…</div></div>';
    try { await refreshBoot(); } catch (e) { document.body.innerHTML = `<div class="empty" style="padding:80px">${esc(e.message)}. Internetni tekshiring va sahifani yangilang.</div>`; return; }
    document.querySelector('.lock')?.remove();
  } else refreshBoot().catch(() => {});
  start();
  lock();
  botPoll(1500);
  setInterval(async () => {
    if (!S.online || document.querySelector('.modal') || ui.view === 'order') return;
    const wasBot = setting('bot_on') === '1';
    try { await refreshBoot(); } catch { return; }
    if (!wasBot && setting('bot_on') === '1') botPoll(1500);
    if (S.user) renderView();
  }, 5 * 60e3);
})();
