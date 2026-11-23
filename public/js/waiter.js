/**
 * ordo — ofitsiant ilovasi (telefon).
 * Ofitsiant stolni tanlaydi, taom qo'shadi (qo'shimchalari bilan), oshxonaga yuboradi va hisob so'raydi.
 * To'lov kassada olinadi. Buyurtma kassa bilan bir xil yadro (core.js) va navbat (store.js) orqali ketadi —
 * kassada darrov ko'rinadi, oshxona ekraniga tushadi.
 */
import { totals, lineSum, modsText, modsKey, modSum } from './core.js';
import { S, on, start, refreshBoot, dispatch, openOrders, order, shift, nextNumber, tableName, hallOf } from './store.js';
import { deviceToken, post } from './api.js';
import { $, $$, esc, sum, qty, time, since, uid, initials, icon, toast, openModal, numberBox, MARK } from './ui.js';
import { modsFor, pickMods } from './mods.js';

if (!deviceToken()) location.replace('/?qurilma=1&keyin=/ofitsiant');

const ui = { view: 'tables', hall: null, order: null, draft: null, cat: null, search: '', sheet: false };
const NOTES = ['Piyozsiz', 'Achchiqroq', 'Achchiq emas', 'Tuzsiz', 'Tezroq', 'Muzsiz', 'Shakarsiz', 'Yaxshi pishgan'];
const fail = (e) => toast(e?.message || 'Xatolik', 'bad');
const products = () => S.boot?.products || [];
const cats = () => S.boot?.categories || [];
const mine = (o) => o.waiter_id === S.user?.id;
const readyCount = (o) => o.items.filter((i) => i.status === 'sent' && i.ready_at).length;
const LSK = 'ordo.w.user';

// =================== Kirish (PIN) ===================
function lock() {
  S.user = null; try { localStorage.removeItem(LSK); } catch { /* */ }
  const staff = (S.boot?.staff || []);
  $('#app').innerHTML = `<div class="w-lock"><div class="lg">${MARK}<b>ordo</b><span>ofitsiant</span></div>
    <p>Kim ishlayapti?</p><div class="who">${staff.map((u) => `<button data-u="${u.id}"><span class="av" style="background:${esc(u.color || '#3d4a63')}">${esc(initials(u.name))}</span><span>${esc(u.name)}</span></button>`).join('')
      || '<div class="hint">Xodimlar yuklanmadi — internetni tekshiring</div>'}</div><div class="pinbox" id="pinbox" hidden></div></div>`;
  $$('[data-u]').forEach((b) => b.onclick = () => askPin(staff.find((u) => u.id === Number(b.dataset.u))));
}

function askPin(u) {
  const box = $('#pinbox'); $('.w-lock .who').hidden = true; box.hidden = false;
  let pin = ''; let busy = false;
  const draw = () => { box.querySelector('[data-dots]').innerHTML = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join(''); };
  box.innerHTML = `<div class="nm">${esc(u.name)}</div><div class="dots" data-dots></div>
    <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button data-d="${d}">${d}</button>`).join('')}<button class="fn" data-d="back">Orqaga</button><button data-d="0">0</button><button class="fn" data-d="ok">Kirish</button></div>`;
  draw();
  const check = async () => {
    if (busy || pin.length < 4) return; busy = true;
    try {
      await post('/api/pin', { user_id: u.id, pin });
      S.user = u; try { localStorage.setItem(LSK, String(u.id)); } catch { /* */ }
      mount();
    } catch (e) { pin = ''; draw(); toast(e.message || 'PIN noto\'g\'ri', 'bad'); } finally { busy = false; }
  };
  box.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => {
    const d = b.dataset.d;
    if (d === 'back') { box.hidden = true; $('.w-lock .who').hidden = false; return; }
    if (d === 'ok') return check();
    if (pin.length < 6) pin += d;
    draw();
    if (pin.length === 4 || pin.length === 6) check();
  });
}

// =================== Qobiq ===================
function mount() {
  $('#app').innerHTML = `<header class="w-top" id="top"></header><main class="w-main" id="main"></main>
    <nav class="w-nav" id="nav"></nav><div class="w-sheet" id="sheet" hidden></div>`;
  render();
}

function render() {
  if (!S.user || !$('#main')) return;
  renderTop(); renderNav();
  if (ui.view === 'order') renderOrder(); else if (ui.view === 'mine') renderMine(); else renderTables();
  if (ui.sheet) renderSheet();
}

function renderTop() {
  const sh = shift();
  const o = ui.view === 'order' ? (order(ui.order) || ui.draft) : null;
  const title = o ? `Stol ${tableName(o.table_id)}` : ui.view === 'mine' ? 'Mening stollarim' : 'Stollar';
  const sync = !S.online ? `<span class="sync off">${icon('offline')}Internet yo'q</span>` : S.outbox.length ? `<span class="sync wait">${icon('wifi')}${S.outbox.length}</span>` : '';
  $('#top').innerHTML = `${o ? `<button class="ib" data-back aria-label="Orqaga">${icon('back')}</button>` : `<span class="mk">${MARK}</span>`}
    <div class="t"><b>${esc(title)}</b><small>${o && order(ui.order) ? `№ ${esc(order(ui.order).number ?? '')} · ${time(order(ui.order).opened_at)} dan` : sh ? `Smena ochiq · ${esc(S.user.name)}` : 'Smena yopiq — kassir ochadi'}</small></div>
    ${sync}<button class="ib" data-lock aria-label="Chiqish">${icon('lock')}</button>`;
}

function renderNav() {
  const my = openOrders().filter((o) => o.type === 'zal' && mine(o));
  const ready = my.reduce((s, o) => s + readyCount(o), 0);
  $('#nav').innerHTML = `<button data-go="tables" class="${ui.view === 'tables' ? 'on' : ''}">${icon('table')}Stollar</button>
    <button data-go="mine" class="${ui.view === 'mine' ? 'on' : ''}">${icon('user')}Mening stollarim${my.length ? `<i>${my.length}</i>` : ''}${ready ? `<em>${ready}</em>` : ''}</button>`;
}

// =================== Stollar ===================
function renderTables() {
  const halls = S.boot?.halls || [];
  if (!ui.hall || !halls.some((h) => h.id === ui.hall)) ui.hall = halls[0]?.id;
  const byTable = new Map(openOrders().filter((o) => o.type === 'zal').map((o) => [o.table_id, o]));
  const tables = (S.boot?.tables || []).filter((t) => t.hall_id === ui.hall);
  $('#main').innerHTML = `${halls.length > 1 ? `<div class="w-seg">${halls.map((h) => `<button data-hall="${h.id}" class="${h.id === ui.hall ? 'on' : ''}">${esc(h.name)}</button>`).join('')}</div>` : ''}
    <div class="w-tables">${tables.map((t) => {
      const o = byTable.get(t.id);
      if (!o) return `<button class="tb free" data-table="${t.id}"><b>${esc(t.name)}</b><span>bo'sh · ${t.seats} o'rin</span></button>`;
      const r = readyCount(o);
      return `<button class="tb ${o.precheck_at ? 'bill' : 'busy'} ${mine(o) ? 'mine' : ''}" data-order="${o.id}"><b>${esc(t.name)}</b>
        <span>${sum(totals(o).total)}</span><span class="tm">${icon('clock')}${since(o.opened_at)}</span>${r ? `<em>${r} tayyor</em>` : ''}${o.precheck_at ? '<em class="b">hisob</em>' : ''}</button>`;
    }).join('') || '<div class="hint">Bu zalda stol yo\'q</div>'}</div>`;
}

function renderMine() {
  const list = openOrders().filter((o) => o.type === 'zal' && mine(o)).sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at));
  $('#main').innerHTML = list.length ? `<div class="w-list">${list.map((o) => { const r = readyCount(o); const t = totals(o);
    return `<button class="w-card" data-order="${o.id}"><div class="h"><b>Stol ${esc(tableName(o.table_id))}</b><span>№ ${esc(o.number ?? '')} · ${since(o.opened_at)}</span></div>
      <div class="r"><span>${t.items} ta taom${t.unsent ? ` · <i class="new">${t.unsent} yuborilmagan</i>` : ''}${r ? ` · <i class="ok">${r} tayyor</i>` : ''}</span><b>${sum(t.total)}</b></div></button>`; }).join('')}</div>`
    : `<div class="w-empty">${icon('table')}<p>Hozir ochiq stolingiz yo'q.<br>«Stollar»dan bo'sh stolni tanlang.</p></div>`;
}

// =================== Buyurtma ===================
const current = () => (ui.order ? order(ui.order) : null);

function renderOrder() {
  const o = current(); const base = o || ui.draft;
  if (!base) { ui.view = 'tables'; return renderTables(); }
  const items = o?.items || [];
  const t = o ? totals(o) : { total: 0, unsent: 0, items: 0 };
  const line = (it) => {
    const st = it.status === 'cancelled' ? '<span class="st bad">bekor</span>' : it.status === 'new' ? '<span class="st new">yangi</span>'
      : it.ready_at ? '<span class="st ok">tayyor — olib boring</span>' : `<span class="st">oshxonada · ${time(it.sent_at)}</span>`;
    return `<div class="w-line ${it.status} ${it.ready_at ? 'ready' : ''}" data-line="${it.id}">
      <span class="q">${it.unit === 'kg' ? qty(it.qty, 'kg') : qty(it.qty) + '×'}</span><span class="nm">${esc(it.name)}${it.mods?.length ? `<small>${esc(modsText(it))}</small>` : ''}${it.comment ? `<small class="cm">${esc(it.comment)}</small>` : ''}</span>
      <span class="sm">${sum(lineSum(it))}</span>${st}
      ${it.status === 'new' && it.unit !== 'kg' ? `<span class="qc"><button data-dec="${it.id}">${icon('minus')}</button><button data-inc="${it.id}">${icon('plus')}</button></span>` : ''}</div>`;
  };
  $('#main').innerHTML = `<div class="w-meta"><button data-guests>${icon('users')}${base.guests || 0} mehmon</button>${o?.comment ? `<span>${icon('note')}${esc(o.comment)}</span>` : ''}</div>
    <div class="w-lines">${items.length ? items.map(line).join('') : `<div class="w-empty">${icon('receipt')}<p>Hali taom yo'q.<br>Pastdagi «Taom qo'shish» tugmasini bosing.</p></div>`}</div>
    <div class="w-bar"><div class="tot"><span>Jami</span><b>${sum(t.total)}</b></div>
      <button class="btn lg add" data-sheet>${icon('plus')}Taom qo'shish</button>
      <div class="two"><button class="btn lg kitchen" data-send ${!t.unsent ? 'disabled' : ''}>${icon('send')}Oshxonaga${t.unsent ? ` · ${t.unsent}` : ''}</button>
        <button class="btn lg" data-bill ${!t.items || t.unsent ? 'disabled' : ''}>${icon('receipt')}${o?.precheck_at ? 'Hisob so\'raldi' : 'Hisob so\'rash'}</button></div></div>`;
}

async function startOrder() {
  const sh = shift();
  if (!sh) { toast('Smena ochilmagan — kassir kassada smenani ochsin', 'bad'); return null; }
  const d = ui.draft; const id = uid('o');
  dispatch('open', { type: 'zal', number: nextNumber(sh.id), shift_id: sh.id, waiter_id: S.user.id, guests: d.guests || 0, table_id: d.table_id,
    service_pct: Number(hallOf(d.table_id)?.service_pct ?? S.boot?.settings?.service_pct ?? 0) || 0 }, id);
  ui.order = id; ui.draft = null;
  return id;
}

async function addProduct(p, { qty: q = 1, mods = [] } = {}) {
  if (S.stop.has(p.id) || p.stop) { toast(`${p.name} — tugagan`, 'bad'); return false; }
  if (p.unit === 'kg') { q = await numberBox({ title: `${p.name} — og'irligi`, decimal: true, suffix: 'kg', value: '' }); if (!q) return false; }
  try {
    if (!ui.order && !(await startOrder())) return false;
    const o = current();
    const same = p.unit !== 'kg' && o.items.find((i) => i.status === 'new' && i.product_id === p.id && !i.comment && modsKey(i.mods) === modsKey(mods));
    if (same) dispatch('qty', { item_id: same.id, qty: same.qty + q }, o.id);
    else {
      const cat = cats().find((c) => c.id === p.category_id);
      dispatch('add', { item: { id: uid('i'), product_id: p.id, name: p.name, base: p.price, price: p.price + modSum(mods), mods, qty: q, unit: p.unit, station_id: p.station_id || cat?.station_id || null } }, o.id);
    }
    if (navigator.vibrate) navigator.vibrate(15);
    return true;
  } catch (e) { fail(e); return false; }
}

// ---- Menyu varag'i ----
function renderSheet() {
  const sh = $('#sheet'); sh.hidden = false;
  const list = cats();
  if (!ui.cat || !list.some((c) => c.id === ui.cat)) ui.cat = list[0]?.id;
  const o = current();
  const added = (o?.items || []).filter((i) => i.status === 'new').reduce((s, i) => s + (i.unit === 'kg' ? 1 : i.qty), 0);
  if (!sh.dataset.built) {
    sh.dataset.built = 1;
    sh.innerHTML = `<div class="sh-top"><label class="srch">${icon('search')}<input id="ws" placeholder="Taom qidirish" autocomplete="off"></label><button class="btn" data-close>Tayyor</button></div>
      <div class="sh-cats" id="wcats"></div><div class="sh-list" id="wlist"></div>`;
    $('#ws').addEventListener('input', (e) => { ui.search = e.target.value; renderSheet(); });
    // Rasm yuklanmasa (internet yo'q) qator rasmsiz ko'rinishga qaytadi — `error` yuqoriga ko'tarilmaydi, capture kerak.
    $('#wlist').addEventListener('error', (e) => { if (e.target.tagName === 'IMG') { e.target.closest('.pr')?.classList.remove('pic'); e.target.remove(); } }, true);
  }
  $('#wcats').innerHTML = ui.search ? '' : list.map((c) => `<button data-cat="${c.id}" class="${c.id === ui.cat ? 'on' : ''}" style="--c:${esc(c.color || '#475569')}">${esc(c.name)}</button>`).join('');
  const q = ui.search.trim().toLowerCase();
  const ps = q ? products().filter((p) => p.name.toLowerCase().includes(q)) : products().filter((p) => p.category_id === ui.cat);
  const cnt = new Map(); for (const i of o?.items || []) if (i.status !== 'cancelled') cnt.set(i.product_id, (cnt.get(i.product_id) || 0) + (i.unit === 'kg' ? 1 : i.qty));
  $('#wlist').innerHTML = ps.map((p) => `<button class="pr ${p.image ? 'pic' : ''} ${S.stop.has(p.id) || p.stop ? 'stop' : ''}" data-p="${p.id}">${p.image ? `<img class="th" src="${esc(p.image)}" alt="" loading="lazy" decoding="async" draggable="false">` : ''}<span class="nm">${esc(p.name)}${modsFor(S.boot, p.id).length ? '<small>qo\'shimcha bor</small>' : ''}</span>
      <span class="pc">${sum(p.price)}${p.unit === 'kg' ? '/kg' : ''}</span>${cnt.get(p.id) ? `<i>${qty(cnt.get(p.id))}</i>` : ''}<span class="pl">${icon('plus')}</span></button>`).join('')
    || '<div class="hint" style="padding:20px">Topilmadi</div>';
  sh.querySelector('[data-close]').textContent = added ? `Tayyor · ${added} ta yangi` : 'Yopish';
}

function closeSheet() { ui.sheet = false; ui.search = ''; const sh = $('#sheet'); sh.hidden = true; sh.innerHTML = ''; delete sh.dataset.built; render(); }

// ---- Satr amallari ----
async function lineMenu(id) {
  const o = current(); const it = o?.items.find((i) => i.id === id); if (!it) return;
  if (it.status !== 'new') { toast(it.status === 'cancelled' ? 'Bekor qilingan' : 'Oshxonaga ketgan taomni bekor qilish — kassada, menejer ruxsati bilan'); return; }
  const p = products().find((x) => x.id === it.product_id);
  const a = await openModal({
    title: it.name,
    body: `<div class="w-acts">${p && modsFor(S.boot, p.id).length ? `<button class="btn lg" data-a="mods">${icon('plus')}Qo'shimchalar</button>` : ''}
      <button class="btn lg" data-a="note">${icon('note')}Izoh (piyozsiz, achchiq…)</button>
      <button class="btn lg" data-a="qty">${icon('edit')}Soni</button><button class="btn lg danger" data-a="del">${icon('trash')}O'chirish</button></div>`,
    onOpen: (m, close) => m.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => close(b.dataset.a)),
  });
  try {
    if (a === 'mods') { const r = await pickMods(S.boot, { ...p, price: it.base ?? p.price }, { current: it.mods || [] }); if (r) dispatch('mods', { item_id: it.id, mods: r.mods }, o.id); }
    else if (a === 'note') {
      const c = await openModal({
        title: 'Izoh', body: `<div class="chips" style="margin-bottom:10px">${NOTES.map((x) => `<button class="chip" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div><textarea class="input" data-t rows="2">${esc(it.comment || '')}</textarea>`,
        foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
        onOpen: (m, close) => {
          const ta = m.querySelector('[data-t]');
          m.querySelectorAll('[data-v]').forEach((b) => b.onclick = () => { ta.value = ta.value.trim() ? `${ta.value.trim()}, ${b.dataset.v}` : b.dataset.v; });
          m.querySelector('[data-ok]').onclick = () => close(ta.value.trim());
        },
      });
      if (c != null) dispatch('comment', { item_id: it.id, comment: c }, o.id);
    } else if (a === 'qty') { const n = await numberBox({ title: 'Soni', value: String(it.qty), suffix: it.unit === 'kg' ? 'kg' : 'ta', decimal: it.unit === 'kg' }); if (n > 0) dispatch('qty', { item_id: it.id, qty: n }, o.id); }
    else if (a === 'del') dispatch('remove', { item_id: it.id }, o.id);
  } catch (e) { fail(e); }
  render();
}

// =================== Hodisalar ===================
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button,[data-line]');
  if (!t || !S.user || t.closest('.modal') || t.closest('.w-lock')) return;
  const d = t.dataset;
  if (d.go) { Object.assign(ui, { view: d.go, order: null, draft: null }); return render(); }
  if ('lock' in d) return lock();
  if ('back' in d) { Object.assign(ui, { view: 'tables', order: null, draft: null }); return render(); }
  if (d.hall) { ui.hall = Number(d.hall); return render(); }
  if (d.table) {
    if (!shift()) { toast('Smena ochilmagan — kassir kassada smenani ochsin', 'bad'); return; }
    Object.assign(ui, { view: 'order', order: null, draft: { type: 'zal', table_id: Number(d.table), guests: 0 } });
    render(); ui.sheet = true; return renderSheet();
  }
  if (d.order) { Object.assign(ui, { view: 'order', order: d.order, draft: null }); return render(); }
  if ('sheet' in d) { ui.sheet = true; return renderSheet(); }
  if ('close' in d) return closeSheet();
  if (d.cat) { ui.cat = Number(d.cat); return renderSheet(); }
  if (d.p) {
    const p = products().find((x) => x.id === Number(d.p)); if (!p) return;
    let ok;
    if (modsFor(S.boot, p.id).length && !(S.stop.has(p.id) || p.stop)) { const r = await pickMods(S.boot, p); if (!r) return; ok = await addProduct(p, { qty: r.qty, mods: r.mods }); }
    else ok = await addProduct(p);
    if (ok) { t.classList.remove('hit'); void t.offsetWidth; t.classList.add('hit'); renderSheet(); renderTop(); }
    return;
  }
  if (d.inc || d.dec) {
    const o = current(); const it = o?.items.find((i) => i.id === (d.inc || d.dec)); if (!it) return;
    try { if (d.dec && it.qty <= 1) dispatch('remove', { item_id: it.id }, o.id); else dispatch('qty', { item_id: it.id, qty: it.qty + (d.inc ? 1 : -1) }, o.id); } catch (er) { fail(er); }
    return render();
  }
  if (d.line) return lineMenu(d.line);
  if ('guests' in d) {
    const v = await numberBox({ title: 'Mehmonlar soni', value: String((current() || ui.draft)?.guests || ''), suffix: 'kishi' });
    if (v === undefined) return;
    try { if (current()) dispatch('guests', { guests: v }, current().id); else ui.draft.guests = v; } catch (er) { fail(er); }
    return render();
  }
  if ('send' in d) {
    const o = current(); const fresh = o?.items.filter((i) => i.status === 'new') || [];
    if (!fresh.length) return;
    try { dispatch('send', { item_ids: fresh.map((i) => i.id) }, o.id); toast(`Oshxonaga yuborildi · ${fresh.length} ta`, 'ok'); } catch (er) { fail(er); }
    return render();
  }
  if ('bill' in d) {
    const o = current(); if (!o) return;
    try { dispatch('precheck', {}, o.id); toast('Kassaga «hisob» so\'rovi ketdi', 'ok'); } catch (er) { fail(er); }
    return render();
  }
});

// Oshxonada tayyor bo'lgan taom — ofitsiantga xabar (titrash + yozuv).
const seenReady = new Set();
let firstPass = true;
function watchReady() {
  if (!S.user) return;
  for (const o of openOrders()) {
    if (!mine(o)) continue;
    for (const it of o.items) {
      if (it.status !== 'sent' || !it.ready_at || seenReady.has(it.id)) continue;
      seenReady.add(it.id);
      if (!firstPass) { toast(`Stol ${tableName(o.table_id)}: ${it.name} tayyor`, 'ok'); if (navigator.vibrate) navigator.vibrate([120, 80, 120]); }
    }
  }
  firstPass = false;
}

// =================== Boshlash ===================
on(() => { watchReady(); if (!document.querySelector('.modal') && !ui.sheet) render(); else if (S.user) renderTop(); });
(async () => {
  if (!S.boot) { try { await refreshBoot(); } catch (e) { $('#app').innerHTML = `<div class="w-empty" style="padding-top:80px">${esc(e.message)}<p>Internetni tekshirib, sahifani yangilang.</p></div>`; return; } }
  else refreshBoot().catch(() => {});
  start();
  const saved = Number(localStorage.getItem(LSK));
  const u = (S.boot?.staff || []).find((x) => x.id === saved);
  if (u) { S.user = u; mount(); } else lock();
  setInterval(() => { refreshBoot().then(() => S.user && render()).catch(() => {}); }, 5 * 60e3);
})();
