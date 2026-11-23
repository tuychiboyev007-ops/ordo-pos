/**
 * ordo — boshqaruv paneli (egasi va menejer).
 * Bo'limlar: bosh sahifa, savdo hisoboti, moddiy hisobot, ombor (qoldiq, bugun, hujjatlar),
 * menyu va texnologik karta, nasiya, yetkazib beruvchilar, rasxodlar, smenalar, xodimlar,
 * zal va stollar, sozlamalar.
 */
import { get, post, deviceToken, sessionToken, setSession, sessionUser, postsInFlight } from './api.js';
import { $, $$, esc, sum, som, qty, time, date, dateTime, today, dayShift, icon, toast, openModal, confirmBox, moneyInput, moneyVal, numVal, initials, qtyParse, qtyVal, MARK } from './ui.js';
import { ROLES, ROLE_NAMES, PAY_NAMES, PAY_METHODS, TYPE_NAMES, totals, botStatusName } from './core.js';
import { pinHash, sameHex } from './pin.js';

const A = { page: 'dash', boot: null, user: sessionUser(), range: { from: today(), to: today() } };
const fail = (e) => toast(e?.message || 'Xatolik', 'bad');
const S = (p) => get(p, { auth: 'session' });
const P = (p, b) => post(p, b, { auth: 'session' });
const UNIT = { kg: 'kg', l: 'litr', dona: 'dona' };
const KIND = { kirim: 'Kirim', utilizatsiya: 'Utilizatsiya', inventar: 'Inventarizatsiya', tayyorlash: 'Tayyorlash' };
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** Boshqaruv — bo'limlar va ularning sahifalari; hammasi yon panelda doim ko'rinib turadi. */
const SECTIONS = [
  ['dash', 'home', 'Bosh sahifa', [['dash', 'Bosh sahifa']]],
  ['rep', 'chart', 'Hisobotlar', [['profit', 'Foyda'], ['analytics', 'Analitika'], ['orders', 'Buyurtmalar (cheklar)'], ['sales', 'Savdo'], ['shifts', 'Smenalar'], ['material', 'Moddiy hisobot']]],
  ['stock', 'box', 'Ombor', [['stock', 'Elementlar'], ['preps', 'Zagotovkalar'], ['docs', 'Kirim'], ['waste', 'Utilizatsiya'], ['inv', 'Inventarizatsiya'], ['today', 'Bugungi harakat']]],
  ['menu', 'list', 'Menyu', [['menu', 'Menyu'], ['mods', 'Qo\'shimchalar'], ['cats', 'Toifalar va sexlar']]],
  ['money', 'wallet', 'Pul', [['expenses', 'Rasxod'], ['debts', 'Nasiya'], ['suppliers', 'Yetkazib beruvchilar']]],
  ['set', 'gear', 'Sozlamalar', [['settings', 'Restoran, bot, parol'], ['staff', 'Xodimlar'], ['halls', 'Zal va stollar']]],
];
const sectionOf = (page) => SECTIONS.find(([, , , pages]) => pages.some(([k]) => k === page));

// =================== Kirish ===================
/** Boshqaruvga kirish — kassadagidek: xodimni bosasiz, PIN-kodni raqam tugmalari bilan terasiz, o'zi kiradi. */
async function login() {
  if (!deviceToken()) { location.replace('/?qurilma=1&keyin=/boshqaruv'); return; }
  let boot;
  try { boot = await get('/api/boot'); } catch (e) { $('#app').innerHTML = `<div class="empty" style="padding:80px">${esc(e.message)}</div>`; return; }
  A.boot = boot;
  const mgrs = boot.staff.filter((u) => ['owner', 'admin'].includes(u.role));
  $('#app').innerHTML = `<div class="login"><div class="card">
    <div class="logo"><span class="mk">${MARK}</span><b>ordo</b></div>
    <h2 style="margin-top:18px;font-size:22px">Boshqaruv paneli</h2><p class="hint">${esc(boot.settings?.name || boot.company?.name || '')}</p>
    <div class="who-grid" id="who">${mgrs.map((u) => `<button data-u="${u.id}"><span class="av" style="background:${esc(u.color || '#3d4a63')}">${esc(initials(u.name))}</span><span>${esc(u.name)}</span><small class="dim">${esc(ROLE_NAMES[u.role])}</small></button>`).join('')}</div>
    <div class="pinpad" id="pinrow" hidden><div class="pn" id="pname"></div><div class="dots" id="dots"></div>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button data-d="${d}">${d}</button>`).join('')}<button class="fn" data-d="back">${mgrs.length > 1 ? 'Orqaga' : ''}</button><button data-d="0">0</button><button class="fn" data-d="del">${icon('back')}</button></div>
      <p class="err" id="perr" hidden></p></div>
    <a class="btn ghost tokassa" href="/kassa">${icon('cash')}Kassaga o'tish</a></div></div>`;
  let who = null; let pin = ''; let busy = false; let wrongT = null;
  const dots = $('#dots');
  const drawDots = () => { const n = Math.max(4, pin.length); dots.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join(''); };
  const choose = (u) => { who = u; pin = ''; drawDots(); $('#perr').hidden = true; $('#pname').textContent = u.name; $('#who').hidden = true; $('#pinrow').hidden = false; };
  const wrong = (msg = 'PIN noto\'g\'ri') => { dots.classList.remove('shake'); void dots.offsetWidth; dots.classList.add('shake'); pin = ''; drawDots(); $('#perr').textContent = msg; $('#perr').hidden = false; };
  const check = async () => {
    if (busy) return; busy = true; const tried = pin;
    // Avval shu yerning o'zida tekshiriladi — noto'g'ri urinish serverga bormaydi (qulflanib qolmasin).
    const ok = who.pin_hash ? sameHex(await pinHash(tried, who.pin_salt), who.pin_hash) : true;
    if (!ok && pin !== tried) { busy = false; if (pin.length >= 4) check(); return; } // tekshirilayotganda davomi terildi
    if (!ok) { busy = false; if (tried.length >= 6) wrong(); else { clearTimeout(wrongT); wrongT = setTimeout(() => { if (pin === tried) wrong(); }, 1100); } return; }
    try {
      const r = await post('/api/pin', { user_id: who.id, pin: tried });
      if (!['owner', 'admin'].includes(r.user.role)) throw new Error('Boshqaruv faqat egasi va menejer uchun');
      document.removeEventListener('keydown', key);
      setSession(r.token, r.user); A.user = r.user; shell();
    } catch (e) { wrong(e.message); } finally { busy = false; }
  };
  const put = (d) => {
    clearTimeout(wrongT);
    if (d === 'back') { if (mgrs.length > 1) { $('#pinrow').hidden = true; $('#who').hidden = false; who = null; } return; }
    if (!who) return;
    $('#perr').hidden = true;
    if (d === 'del') pin = pin.slice(0, -1); else if (pin.length < 6) pin += d;
    drawDots();
    if (pin.length >= 4) check();
  };
  const key = (e) => { if (!who) return; if (/^\d$/.test(e.key)) put(e.key); else if (e.key === 'Backspace') put('del'); else if (e.key === 'Escape') put('back'); };
  document.addEventListener('keydown', key);
  $$('[data-u]').forEach((b) => b.onclick = () => choose(mgrs.find((u) => u.id === Number(b.dataset.u))));
  $$('#pinrow [data-d]').forEach((b) => b.onclick = () => put(b.dataset.d));
  if (mgrs.length === 1) choose(mgrs[0]);
}

// "Saqlash"ni ikki marta bosish — ikkita kirim, ikkita taom bo'lib yozilardi.
let lastOkClick = 0;
document.addEventListener('click', (e) => {
  const b = e.target.closest('.modal [data-ok], .modal [data-again]');
  if (!b) return;
  if (postsInFlight() > 0 || Date.now() - lastOkClick < 800) { e.stopImmediatePropagation(); e.preventDefault(); return; }
  lastOkClick = Date.now();
}, true);

// =================== Qobiq ===================
function shell() {
  const page = location.hash.slice(1);
  if (sectionOf(page)) A.page = page;
  $('#app').innerHTML = `<button class="a-burger" id="burger" aria-label="Menyu">${icon('list')}<span>Menyu</span></button><div class="a-shade" id="shade"></div><div class="a-shell"><aside class="a-side" id="side">
    <div class="brand"><div class="logo" id="home" role="button" tabindex="0" title="Bosh sahifa"><span class="mk">${MARK}</span><b>ordo</b></div><small>${esc(A.boot?.settings?.name || A.boot?.company?.name || '')}</small></div>
    <nav class="a-nav" id="nav"></nav>
    <div class="a-foot"><span class="av" style="background:var(--ink)">${esc(initials(A.user?.name))}</span><span class="nm">${esc(A.user?.name || '')}<small>${esc(ROLE_NAMES[A.user?.role] || '')}</small></span>
      <a class="icon-btn" href="/kassa" title="Kassaga o'tish">${icon('cash')}</a><button class="icon-btn" id="out" title="Chiqish">${icon('out')}</button></div></aside><main class="a-main" id="main"></main></div>`;
  $('#out').onclick = () => { setSession(null); login(); };
  const side = (open) => { $('#side').classList.toggle('open', open); $('#shade').classList.toggle('on', open); };
  $('#burger').onclick = () => side(!$('#side').classList.contains('open'));
  $('#shade').onclick = () => side(false);
  $('#nav').addEventListener('click', (e) => { if (e.target.closest('[data-page]')) side(false); });
  // Logo — istalgan sahifadan Bosh sahifaga.
  const home = () => { side(false); show('dash'); };
  $('#home').onclick = home; $('#home').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); home(); } };
  $('#main').addEventListener('click', (e) => { const b = e.target.closest('[data-sub]'); if (b) show(b.dataset.sub); });
  nav(); show(A.page);
  // Manzildagi #bo'lim qo'lda o'zgartirilsa yoki "orqaga" bosilsa ham o'sha bo'lim ochilsin.
  if (!shell.bound) { shell.bound = true; window.addEventListener('hashchange', () => { const p = location.hash.slice(1); if (sectionOf(p) && p !== A.page && $('#main')) show(p); }); }
}

function nav() {
  const cur = sectionOf(A.page)?.[0];
  $('#nav').innerHTML = SECTIONS.map(([k, ic, l, pages]) => pages.length === 1
    ? `<button data-page="${pages[0][0]}" class="${A.page === pages[0][0] ? 'on' : ''}">${icon(ic)}${esc(l)}</button>`
    : `<div class="ngrp ${cur === k ? 'cur' : ''}"><div class="nh">${icon(ic)}${esc(l)}</div>${pages.map(([pg, pl]) => `<button class="sub ${A.page === pg ? 'on' : ''}" data-page="${pg}">${esc(pl)}</button>`).join('')}</div>`).join('');
  $$('#nav [data-page]').forEach((b) => b.onclick = () => show(b.dataset.page));
}

async function show(page) {
  A.page = page; history.replaceState(null, '', '#' + page); nav();
  const m = $('#main');
  if (A.shown !== page) m.innerHTML = '<div class="empty">Yuklanmoqda…</div>';
  A.shown = page;
  try { await PAGES[page](m); } catch (e) {
    if (e.status === 401) { setSession(null); return login(); }
    m.innerHTML = `<div class="empty">${icon('alert')}<div>${esc(e.message)}</div></div>`;
  }
}

function head(title, sub = '', act = '') {
  return `<div class="ph"><div><h1>${esc(title)}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div><div class="act">${act}</div></div>`;
}

/** Sana oralig'i: Bugun / Kecha / 7 kun / Shu oy / O'tgan oy / ixtiyoriy. */
function rangeBar(onChange) {
  const t = today();
  const month = t.slice(0, 8) + '01';
  const prevEnd = dayShift(month, -1); const prevStart = prevEnd.slice(0, 8) + '01';
  const P_ = [['Bugun', t, t], ['Kecha', dayShift(t, -1), dayShift(t, -1)], ['7 kun', dayShift(t, -6), t], ['Shu oy', month, t], ['O\'tgan oy', prevStart, prevEnd]];
  const cur = A.range;
  const html = `<div class="range noprint">${P_.map(([l, f, to]) => `<button class="chip ${cur.from === f && cur.to === to ? 'on' : ''}" data-f="${f}" data-t="${to}">${l}</button>`).join('')}
    <input type="date" data-rf value="${cur.from}"> — <input type="date" data-rt value="${cur.to}"></div>`;
  setTimeout(() => {
    $$('.range [data-f]').forEach((b) => b.onclick = () => { A.range = { from: b.dataset.f, to: b.dataset.t }; onChange(); });
    $$('.range [data-rf], .range [data-rt]').forEach((i) => i.onchange = () => {
      const f = $('.range [data-rf]').value; const to = $('.range [data-rt]').value;
      if (f && to && f <= to) { A.range = { from: f, to }; onChange(); }
    });
  });
  return html;
}
const rq = () => `from=${A.range.from}&to=${A.range.to}`;
const rlabel = () => (A.range.from === A.range.to ? date(A.range.from + 'T12:00:00Z') : `${date(A.range.from + 'T12:00:00Z')} — ${date(A.range.to + 'T12:00:00Z')}`);

function csv(name, header, rows) {
  const q = (v) => { const s = String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = '﻿' + [header, ...rows].map((r) => r.map(q).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = name + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const xlBtn = (id) => `<button class="btn sm" id="${id}">${icon('print')}Excel</button>`;

const stat = (l, v, s = '', cls = '') => `<div class="stat ${cls}"><div class="l">${esc(l)}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;
const bars = (rows, key = 'sum', lab = 'h') => {
  const max = Math.max(1, ...rows.map((r) => r[key]));
  const peak = rows.reduce((a, r) => (r[key] > (a?.[key] || 0) ? r : a), null);
  return `<div class="bars">${rows.map((r) => `<div class="b ${r === peak ? 'peak' : ''}" title="${esc(sum(r[key]))}"><i style="height:${Math.max(2, (r[key] / max) * 140)}px"></i><span>${esc(r[lab])}</span></div>`).join('')}</div>`;
};
const hbars = (rows, label, val, fmt = sum) => {
  const max = Math.max(1, ...rows.map(val));
  return rows.map((r) => `<div class="hbar"><div class="t"><span>${label(r)}</span><b>${fmt(val(r))}</b></div><div class="track"><i style="width:${(val(r) / max) * 100}%"></i></div></div>`).join('') || '<div class="empty">Ma\'lumot yo\'q</div>';
};

// =================== Sahifalar ===================
const PAGES = {};

/** Foyda — har taom: nechta sotildi, tushum, tannarx, foyda. */
PAGES.profit = async (m) => {
  const d = await S('/api/reports/profit?' + rq());
  const t = d.totals;
  const mpct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  m.innerHTML = head('Foyda', `${rlabel()} · har taom: sotuv narxi − tannarx = foyda`, xlBtn('xl')) + rangeBar(() => show('profit'))
    + (t.no_cost ? `<div class="card mt" style="border-color:#f0cf86;background:#fffbf1;padding:12px 16px">${icon('alert')} <b>${t.no_cost} ta taomning tannarxi noma'lum</b> — ularning tannarxi 0 deb hisoblandi. Menyu → Taomlar'da taomni ochib <b>Tannarx</b>ni yozing (Cola kabi tayyor mahsulot) yoki Ombor → Kirim qiling (texkartali taom).</div>` : '')
    + `<div class="stats mt">${stat('Tushum', sum(t.revenue), `${t.orders} ta buyurtma${t.discount ? ` · chegirma −${sum(t.discount)}` : ''}`)}${stat('Tannarx', sum(t.cost), 'sotilgan taomlarniki')}
      ${stat('Yalpi foyda', sum(t.gross), `tushumning ${mpct(t.gross, t.revenue)}%`)}${stat('Rasxod va utilizatsiya', sum(t.expenses + t.waste))}
      ${stat('Sof foyda', `<span class="${t.net < 0 ? 'neg' : ''}">${sum(t.net)}</span>`, 'yalpi foyda − rasxod − utilizatsiya', 'accent')}</div>
    <div class="card mt"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Taom</th><th class="r">Sotildi</th><th class="r">Tushum</th><th class="r">1 dona tannarxi</th><th class="r">Jami tannarx</th><th class="r">Foyda</th><th class="r">Foyda %</th></tr></thead><tbody>
    ${d.items.map((x) => `<tr><td><b>${esc(x.name)}</b>${x.no_cost ? ' <span class="badge warn">tannarx yo\'q</span>' : x.src === 'qolda' ? ' <span class="dim">· qo\'lda</span>' : ''}</td>
      <td class="r">${qty(x.qty, x.unit === 'kg' ? 'kg' : '')}</td><td class="r">${sum(x.revenue)}</td><td class="r">${x.unit_cost ? sum(x.unit_cost) : '—'}</td><td class="r">${sum(x.cost)}</td>
      <td class="r">${x.no_cost ? '<span class="dim">—</span>' : `<b class="${x.profit < 0 ? 'neg' : ''}">${sum(x.profit)}</b>`}</td><td class="r">${x.revenue && !x.no_cost ? `<span class="badge ${mpct(x.profit, x.revenue) < 30 ? 'warn' : 'ok'}">${mpct(x.profit, x.revenue)}%</span>` : ''}</td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Bu davrda savdo yo\'q</div></td></tr>'}
    ${d.items.length ? `<tr class="tot"><td>Jami</td><td></td><td class="r">${sum(t.items_revenue)}</td><td></td><td class="r">${sum(t.cost)}</td><td class="r">${sum(t.items_revenue - t.cost)}</td><td></td></tr>` : ''}
    </tbody></table></div></div>
    <p class="hint mt">Taom foydasi chegirmagacha hisoblanadi; umumiy foydada chegirma ayirilgan. Tannarx — sotilgan paytdagi: texkarta bo'lsa elementlarning kirim narxidan, bo'lmasa qo'lda yozilganidan.</p>`;
  $('#xl').onclick = () => csv(`foyda_${A.range.from}_${A.range.to}`, ['Taom', 'Sotildi', 'Tushum', '1 dona tannarxi', 'Jami tannarx', 'Foyda'],
    d.items.map((x) => [x.name, x.qty, x.revenue, x.unit_cost, x.cost, x.profit]));
};

PAGES.dash = async (m) => {
  const day = A.dashDay || today();
  const d = await S('/api/dashboard?day=' + day);
  const s = d.sales;
  // Tannarxi noma'lum taomlar (element kirim qilinmagan yoki tannarx yozilmagan) — foyda ko'p ko'rinadi.
  const pf = await S(`/api/reports/profit?from=${day}&to=${day}`).catch(() => null);
  const nc = (pf?.items || []).filter((i) => i.no_cost);
  const hours = Array.from({ length: 24 }, (_, h) => ({ h: String(h).padStart(2, '0'), sum: d.hours.find((x) => x.h === h)?.sum || 0 })).filter((x, i, a) => x.sum || (i >= 9 && i <= 23));
  m.innerHTML = head('Bosh sahifa', date(day + 'T12:00:00Z'), `<div class="seg"><button data-d="${today()}" class="${day === today() ? 'on' : ''}">Bugun</button><button data-d="${dayShift(today(), -1)}" class="${day === dayShift(today(), -1) ? 'on' : ''}">Kecha</button></div>`)
    + (nc.length ? `<div class="card" style="border-color:#f0cf86;background:#fffbf1;padding:12px 16px;margin-bottom:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap">
        <span>${icon('alert')} <b>${nc.length} ta sotilgan taomning tannarxi noma'lum</b> (${esc(nc.slice(0, 4).map((i) => i.name).join(', '))}${nc.length > 4 ? '…' : ''}) — foyda haqiqiydan ko'p ko'rinyapti. Elementlar kirim qilinsa yoki tannarx yozilsa, to'g'ri bo'ladi.</span>
        <span class="grow"></span><button class="btn sm" data-go="docs">${icon('truckin')}Kirim qilish</button><button class="btn sm" data-go="menu">Taomlar</button></div>` : '')
    + `<div class="quick noprint"><button class="btn sm" data-go="menu">${icon('plus')}Menyuga taom yoki tovar</button><button class="btn sm" data-go="stock">${icon('plus')}Element</button><button class="btn sm" data-go="docs">${icon('truckin')}Kirim</button><button class="btn sm" data-go="preps">${icon('flame')}Zagotovka</button><button class="btn sm" data-go="analytics">${icon('chart')}Analitika</button></div>
    <div class="stats">${stat('Savdo', sum(s.total), `${s.orders} ta buyurtma`, 'accent')}${stat('O\'rtacha chek', sum(s.avg), `${s.guests} mehmon`)}
      ${stat('Tannarx (texkarta)', sum(d.food_cost), s.total ? `savdoning ${pct(d.food_cost, s.total)}%` : '')}${stat('Rasxod', sum(d.expenses))}
      ${stat('Utilizatsiya', sum(d.waste))}${stat('Taxminiy foyda', `<span class="${d.profit < 0 ? 'neg' : ''}">${sum(d.profit)}</span>`, nc.length ? 'tannarxi noma\'lum taomlar hisobga olinmagan' : 'savdo − tannarx − rasxod − utilizatsiya')}</div>
    <div class="cols2 mt"><div class="card"><div class="card-h"><h3>Soatlar bo'yicha savdo</h3></div><div class="card-b">${bars(hours)}</div></div>
      <div class="card"><div class="card-h"><h3>To'lov turlari</h3></div><div class="card-b">${hbars(d.methods, (r) => esc(PAY_NAMES[r.method] || r.method), (r) => r.sum)}</div></div></div>
    <div class="cols2 mt"><div class="card"><div class="card-h"><h3>Eng ko'p sotilgan taomlar</h3></div><div class="card-b">${hbars(d.top, (r) => `${esc(r.name)} <span class="dim">· ${qty(r.qty, r.unit === 'kg' ? 'kg' : '')}</span>`, (r) => r.sum)}</div></div>
      <div class="card"><div class="card-h"><h3>Diqqat talab qiladi</h3></div><div class="card-b">
        <div class="hbar"><div class="t"><span>Hozir ochiq buyurtmalar</span><b>${d.open.n} ta · ${sum(d.open.sum)}</b></div></div>
        <div class="hbar"><div class="t"><span>Bekor qilingan taomlar (oshxonaga ketgandan keyin)</span><b class="${d.cancels.n ? 'neg' : ''}">${d.cancels.n} ta · ${sum(d.cancels.v)}</b></div></div>
        <div class="hbar"><div class="t"><span>Mijozlar qarzi (nasiya)</span><b>${d.debts.n} ta · ${sum(d.debts.v)}</b></div></div>
        <div class="hbar"><div class="t"><span>Yetkazib beruvchilarga qarzimiz</span><b>${sum(d.supplier_debt)}</b></div></div>
        <div class="lbl" style="margin:14px 0 6px">Kam qolgan elementlar</div>
        ${d.low.length ? `<table class="tbl">${d.low.map((l) => `<tr><td>${esc(l.name)}</td><td class="r ${l.stock < 0 ? 'neg' : ''}">${qty(l.stock, l.unit)}</td><td class="r dim">min ${qty(l.min_stock, l.unit)}</td></tr>`).join('')}</table>` : '<p class="hint">Hammasi yetarli</p>'}
      </div></div></div>`;
  $$('[data-d]', m).forEach((b) => b.onclick = () => { A.dashDay = b.dataset.d; show('dash'); });
  $$('[data-go]', m).forEach((b) => b.onclick = () => show(b.dataset.go));
};

PAGES.sales = async (m) => {
  const d = await S('/api/reports/summary?' + rq());
  const t = d.totals; const U = (id) => d.users[id] || '—';
  m.innerHTML = head('Savdo hisoboti', rlabel(), xlBtn('xl')) + rangeBar(() => show('sales'))
    + `<div class="stats mt">${stat('Savdo', sum(t.total), `${t.orders} ta buyurtma`, 'accent')}${stat('O\'rtacha chek', sum(t.avg_check), `${t.guests} mehmon`)}
      ${stat('Chegirmalar', sum(t.discount))}${stat('Xizmat haqi', sum(t.service))}${stat('Tannarx', sum(t.cost), t.total ? `${pct(t.cost, t.total)}%` : '')}
      ${stat('Bekor qilingan', sum(t.cancelled_sum), `${d.cancels.length} ta taom · ${t.voids} ta buyurtma`)}</div>
    <div class="cols2 mt"><div class="card"><div class="card-h"><h3>Kunlar bo'yicha</h3></div><div class="card-b">${bars(d.days.map((x) => ({ ...x, h: x.day.slice(8) })))}</div></div>
      <div class="card"><div class="card-h"><h3>To'lov turlari</h3></div><div class="card-b">${hbars(d.methods, (r) => esc(PAY_NAMES[r.method] || r.method), (r) => r.sum)}
        <div class="lbl" style="margin:14px 0 4px">Buyurtma turi</div>${hbars(d.types, (r) => esc(TYPE_NAMES[r.type] || r.type), (r) => r.sum)}</div></div></div>
    <div class="cols2 mt"><div class="card"><div class="card-h"><h3>Taomlar</h3><span class="grow"></span><span class="dim">${d.items.length} ta</span></div><div class="tbl-wrap" style="max-height:520px">
      <table class="tbl"><thead><tr><th>Taom</th><th class="r">Soni</th><th class="r">Summa</th><th class="r">Ulushi</th></tr></thead><tbody>
      ${d.items.map((i) => `<tr><td>${esc(i.name)}</td><td class="r">${qty(i.qty, i.unit === 'kg' ? 'kg' : '')}</td><td class="r">${sum(i.sum)}</td><td class="r dim">${pct(i.sum, t.subtotal)}%</td></tr>`).join('')}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Ofitsiantlar</h3></div><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Xodim</th><th class="r">Buyurtma</th><th class="r">Mehmon</th><th class="r">Savdo</th><th class="r">Xizmat haqi</th></tr></thead><tbody>
      ${d.waiters.map((w) => `<tr><td>${esc(w.name || '—')}</td><td class="r">${w.orders}</td><td class="r">${w.guests || 0}</td><td class="r">${sum(w.sum)}</td><td class="r">${sum(w.service)}</td></tr>`).join('')}</tbody></table></div></div></div>
    <div class="card mt"><div class="card-h"><h3>Bekor qilingan taomlar</h3><span class="hint">oshxonaga yuborilgandan keyin — kim kiritdi, kim ruxsat berdi</span></div><div class="tbl-wrap">
      ${d.cancels.length ? `<table class="tbl"><thead><tr><th>Vaqt</th><th>№</th><th>Taom</th><th class="r">Soni</th><th class="r">Summa</th><th>Sabab</th><th>Kiritgan</th><th>Ruxsat bergan</th></tr></thead><tbody>
      ${d.cancels.map((c) => `<tr><td>${dateTime(c.closed_at)}</td><td>${esc(c.number ?? '')}</td><td>${esc(c.name)}</td><td class="r">${qty(c.qty)}</td><td class="r neg">${sum(c.sum)}</td><td>${esc(c.reason || '')}</td><td>${esc(U(c.added_by))}</td><td>${esc(U(c.cancelled_by))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Bekor qilingan taom yo\'q</div>'}</div></div>
    <div class="cols2 even mt"><div class="card"><div class="card-h"><h3>Chegirmalar</h3></div><div class="tbl-wrap">
      ${d.discounts.length ? `<table class="tbl"><thead><tr><th>Vaqt</th><th>№</th><th>Chegirma</th><th>Sabab</th><th>Bergan</th></tr></thead><tbody>
      ${d.discounts.map((x) => `<tr><td>${dateTime(x.closed_at)}</td><td>${esc(x.number ?? '')}</td><td class="r">${sum(x.sum)}${x.kind === 'pct' ? ` <span class="dim">(${x.value}%)</span>` : ''}</td><td>${esc(x.reason || '')}</td><td>${esc(U(x.by))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Chegirma berilmagan</div>'}</div></div>
      <div class="card"><div class="card-h"><h3>Bekor qilingan buyurtmalar</h3></div><div class="tbl-wrap">
      ${d.voids.length ? `<table class="tbl"><thead><tr><th>Vaqt</th><th>№</th><th>Sabab</th><th>Ruxsat</th></tr></thead><tbody>
      ${d.voids.map((x) => `<tr><td>${dateTime(x.closed_at)}</td><td>${esc(x.number ?? '')}</td><td>${esc(x.reason || '')}</td><td>${esc(U(x.by))}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Yo\'q</div>'}</div></div></div>`;
  $('#xl').onclick = () => csv(`savdo_${A.range.from}_${A.range.to}`, ['Taom', 'Soni', 'Birlik', 'Summa'], d.items.map((i) => [i.name, String(i.qty).replace('.', ','), i.unit, i.sum]));
};

// =================== Analitika ===================
const DOW = ['', 'Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba'];
const DOW_S = ['', 'Du', 'Se', 'Cho', 'Pa', 'Ju', 'Sha', 'Yak'];
const dm = (day) => `${day.slice(8)}.${day.slice(5, 7)}`;
/** O'zgarish belgisi: +12,4% (yashil) / −8% (qizil). `inverse` — oshishi yomon bo'lgan ko'rsatkich. Oldin 0 bo'lsa foiz yo'q. */
function delta(now, was, inverse = false) {
  if (!was) return now ? '<span class="delta new">yangi</span>' : '';
  const p = Math.round(((now - was) / Math.abs(was)) * 1000) / 10;
  if (!p) return '<span class="delta">0%</span>';
  const good = inverse ? p < 0 : p > 0;
  return `<span class="delta ${good ? 'up' : 'down'}">${p > 0 ? '+' : '−'}${String(Math.abs(p)).replace('.', ',')}%</span>`;
}
const kpi = (l, now, was, fmt = sum, extra = '', cls = '') => `<div class="stat ${cls}"><div class="l">${esc(l)}</div><div class="v">${fmt(now)}</div>
  <div class="s">${delta(now, was)} <span>oldin ${fmt(was)}</span>${extra ? ` · ${extra}` : ''}</div></div>`;

/** Juft ustunlar: kulrang — oldingi davr, to'q — tanlangan davr. Kun ko'p bo'lsa bir necha kun bitta ustunga yig'iladi. */
function bars2(cur, old) {
  const step = Math.max(1, Math.ceil(cur.length / 31));
  const pack = (rows) => { const out = []; for (let i = 0; i < rows.length; i += step) { const ch = rows.slice(i, i + step); out.push({ day: ch[0].day, to: ch[ch.length - 1].day, sum: ch.reduce((s, r) => s + r.sum, 0) }); } return out; };
  const a = pack(cur); const b = pack(old);
  const max = Math.max(1, ...a.map((r) => r.sum), ...b.map((r) => r.sum));
  const h = (v) => Math.max(2, (v / max) * 150);
  return `<div class="bars two">${a.map((r, i) => `<div class="b" title="${esc(dm(r.day))}${step > 1 ? '–' + esc(dm(r.to)) : ''}: ${esc(sum(r.sum))} · oldin ${esc(sum(b[i]?.sum || 0))}">
    <div class="pair"><i class="old" style="height:${h(b[i]?.sum || 0)}px"></i><i style="height:${h(r.sum)}px"></i></div><span>${esc(r.day.slice(8))}</span></div>`).join('')}</div>
    <div class="legend"><span><i></i>Tanlangan davr</span><span><i class="old"></i>Oldingi davr</span></div>`;
}

/** Hafta kuni × soat: qaysi kuni, qaysi soatda savdo ko'p. Rang to'qligi — summaga qarab. */
function heatmap(heat) {
  if (!heat.length) return '<div class="empty">Ma\'lumot yo\'q</div>';
  const hs = heat.map((r) => r.h); const h0 = Math.min(...hs); const h1 = Math.max(...hs);
  const max = Math.max(1, ...heat.map((r) => r.sum));
  const at = new Map(heat.map((r) => [r.dow + ':' + r.h, r]));
  const cols = []; for (let h = h0; h <= h1; h++) cols.push(h);
  return `<div class="heat-wrap"><div class="heat" style="grid-template-columns:44px repeat(${cols.length},minmax(26px,1fr))">
    <span></span>${cols.map((h) => `<span class="hh">${String(h).padStart(2, '0')}</span>`).join('')}
    ${[1, 2, 3, 4, 5, 6, 7].map((d) => `<span class="hd">${DOW_S[d]}</span>${cols.map((h) => {
      const r = at.get(d + ':' + h); if (!r) return '<i class="c"></i>';
      const k = r.sum / max;
      return `<i class="c ${k > 0.55 ? 'hot' : ''}" style="background:rgba(228,87,46,${(0.1 + k * 0.9).toFixed(2)})" title="${DOW[d]} ${String(h).padStart(2, '0')}:00 — ${esc(sum(r.sum))}, ${r.n} ta buyurtma">${k > 0.3 ? r.n : ''}</i>`;
    }).join('')}`).join('')}</div></div><div class="hint" style="margin-top:8px">Katakdagi son — buyurtmalar soni. Rang qancha to'q bo'lsa, savdo shuncha ko'p.</div>`;
}

/** Raqamlardan oddiy tilda xulosa. */
function insights(d) {
  const out = []; const c = d.cur; const o = d.old;
  const add = (kind, text) => out.push(`<li class="${kind}"><i></i><div>${text}</div></li>`);
  if (!c.orders) { add('info', 'Bu davrda yopilgan buyurtma yo\'q.'); return out; }
  if (o.revenue) {
    const diff = c.revenue - o.revenue; const p = Math.abs(Math.round((diff / o.revenue) * 1000) / 10);
    if (diff > 0) add('good', `Savdo oldingi davrga nisbatan <b>${String(p).replace('.', ',')}%</b> oshdi — <b>${sum(diff)}</b> so'm ko'p.`);
    else if (diff < 0) add('bad', `Savdo oldingi davrga nisbatan <b>${String(p).replace('.', ',')}%</b> kamaydi — <b>${sum(-diff)}</b> so'm kam.`);
    if (o.orders && c.orders !== o.orders && o.avg_check) {
      const oc = c.orders - o.orders; const ac = c.avg_check - o.avg_check;
      add('info', `Buyurtmalar ${oc >= 0 ? 'ko\'paydi' : 'kamaydi'}: ${o.orders} → <b>${c.orders}</b>; o'rtacha chek ${ac >= 0 ? 'oshdi' : 'tushdi'}: ${sum(o.avg_check)} → <b>${sum(c.avg_check)}</b>.`);
    }
  } else add('info', 'Oldingi davrda savdo bo\'lmagan — solishtirib bo\'lmaydi.');
  const wd = d.weekdays.filter((w) => w.days);
  if (d.days_n >= 7 && wd.length > 1) {
    const best = wd.reduce((a, w) => (w.avg > a.avg ? w : a)); const worst = wd.reduce((a, w) => (w.avg < a.avg ? w : a));
    if (best.avg > 0) add('good', `Eng yaxshi kun — <b>${DOW[best.dow]}</b>: kuniga o'rtacha ${sum(best.avg)} so'm.`);
    if (worst.dow !== best.dow) add('info', `Eng sust kun — <b>${DOW[worst.dow]}</b>: kuniga o'rtacha ${sum(worst.avg)} so'm.`);
  }
  if (d.hours.length) {
    const ph = d.hours.reduce((a, h) => (h.sum > a.sum ? h : a));
    add('info', `Eng band soat — <b>${String(ph.h).padStart(2, '0')}:00–${String(ph.h + 1).padStart(2, '0')}:00</b>: ${ph.n} ta buyurtma, ${sum(ph.sum)} so'm.`);
  }
  if (d.items.length) {
    const top = d.items[0];
    add('good', `Eng ko'p pul keltirgan taom — <b>${esc(top.name)}</b>: ${sum(top.revenue)} so'm (savdoning ${String(top.share).replace('.', ',')}%).`);
    if (d.items.length >= 5) add('info', `Savdoning 80 foizini <b>${d.abc.A.n} ta</b> taom beryapti (jami ${d.items.length} ta taom sotilgan).`);
  }
  const cat = d.categories.filter((x) => x.profit > 0).sort((a, b) => b.profit - a.profit)[0];
  if (cat && d.categories.length > 1) add('good', `Eng ko'p foyda keltirgan toifa — <b>${esc(cat.name)}</b>: ${sum(cat.profit)} so'm.`);
  const loss = d.items.filter((i) => !i.no_cost && i.profit < 0);
  if (loss.length) add('bad', `<b>${loss.length} ta</b> taom tannarxidan arzon sotilyapti: ${loss.slice(0, 3).map((i) => esc(i.name)).join(', ')}${loss.length > 3 ? '…' : ''}.`);
  if (d.dead_n) add('bad', `Menyudagi ${d.menu_n} ta taomdan <b>${d.dead_n} tasi</b> bu davrda bir marta ham sotilmadi.`);
  if (c.no_cost) add('info', `<b>${c.no_cost} ta</b> taomning tannarxi yozilmagan — foyda aslidan ko'p ko'rinishi mumkin (Menyu → Taomlar va texkarta).`);
  return out;
}

PAGES.analytics = async (m) => {
  const d = await S('/api/reports/analytics?' + rq());
  const c = d.cur; const o = d.old;
  const moved = d.items.map((i) => ({ ...i, diff: i.revenue - i.prev_revenue }));
  const up = moved.filter((i) => i.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 8);
  const down = [...moved.filter((i) => i.diff < 0), ...d.gone.map((g) => ({ ...g, revenue: 0, qty: 0, diff: -g.prev_revenue }))].sort((a, b) => a.diff - b.diff).slice(0, 8);
  const mv = (rows, empty) => (rows.length ? `<table class="tbl"><thead><tr><th>Taom</th><th class="r">Oldin</th><th class="r">Hozir</th><th class="r">Farq</th></tr></thead><tbody>
    ${rows.map((i) => `<tr><td>${esc(i.name)}</td><td class="r dim">${sum(i.prev_revenue)}</td><td class="r">${sum(i.revenue)}</td><td class="r ${i.diff > 0 ? 'pos' : 'neg'}">${i.diff > 0 ? '+' : '−'}${sum(Math.abs(i.diff))}</td></tr>`).join('')}</tbody></table>` : `<div class="empty">${empty}</div>`);
  const ABC_T = { A: 'Asosiy — savdoning 80%', B: 'O\'rtacha — keyingi 15%', C: 'Kam sotiladi — oxirgi 5%' };
  const wmax = Math.max(1, ...d.weekdays.map((w) => w.avg));

  m.innerHTML = head('Analitika', `${rlabel()} · oldingi davr bilan solishtirilgan: ${dm(d.prev.from)}${d.prev.from === d.prev.to ? '' : ' — ' + dm(d.prev.to)}`, xlBtn('xl')) + rangeBar(() => show('analytics'))
    + `<div class="stats mt">${kpi('Savdo', c.revenue, o.revenue, sum, '', 'accent')}${kpi('Buyurtmalar', c.orders, o.orders, (v) => String(v))}
      ${kpi('O\'rtacha chek', c.avg_check, o.avg_check)}${kpi('Yalpi foyda', c.gross, o.gross, sum, `marja ${String(c.margin).replace('.', ',')}%`)}
      ${kpi('Sof foyda', c.net, o.net, sum, 'rasxod va utilizatsiyadan keyin')}</div>
    <div class="cols2 mt"><div class="card"><div class="card-h"><h3>Kunlar bo'yicha savdo</h3><span class="hint">oldingi davr bilan yonma-yon</span></div><div class="card-b">${bars2(d.days, d.prev_days)}</div></div>
      <div class="card"><div class="card-h"><h3>Xulosa</h3></div><div class="card-b"><ul class="ins">${insights(d).join('')}</ul></div></div></div>
    <div class="cols2 mt"><div class="card"><div class="card-h"><h3>Qaysi kuni, qaysi soatda</h3><span class="hint">Toshkent vaqti</span></div><div class="card-b">${heatmap(d.heat)}</div></div>
      <div class="card"><div class="card-h"><h3>Hafta kunlari</h3><span class="hint">kuniga o'rtacha</span></div><div class="card-b">
        ${d.weekdays.map((w) => `<div class="hbar"><div class="t"><span>${DOW[w.dow]} <span class="dim">· ${w.days ? w.n + ' ta buyurtma' : 'davrda yo\'q'}</span></span><b>${sum(w.avg)}</b></div><div class="track"><i style="width:${(w.avg / wmax) * 100}%"></i></div></div>`).join('')}
        <div class="lbl" style="margin:16px 0 4px">Soatlar bo'yicha</div>${d.hours.length ? bars(d.hours.map((x) => ({ ...x, h: String(x.h).padStart(2, '0') }))) : '<div class="empty">Ma\'lumot yo\'q</div>'}</div></div></div>
    <div class="cols2 mt"><div class="card"><div class="card-h"><h3>Toifalar</h3><span class="hint">savdodagi ulushi va foydasi</span></div><div class="tbl-wrap">
      ${d.categories.length ? `<table class="tbl"><thead><tr><th>Toifa</th><th class="r">Taom</th><th class="r">Savdo</th><th class="r">Ulushi</th><th class="r">Foyda</th><th class="r">Marja</th></tr></thead><tbody>
      ${d.categories.map((x) => `<tr><td>${esc(x.name)}<div class="track sm"><i style="width:${x.share}%"></i></div></td><td class="r">${x.n}</td><td class="r">${sum(x.revenue)}</td><td class="r dim">${String(x.share).replace('.', ',')}%</td>
        <td class="r ${x.profit < 0 ? 'neg' : ''}">${sum(x.profit)}</td><td class="r dim">${String(x.margin).replace('.', ',')}%</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Ma\'lumot yo\'q</div>'}</div></div>
      <div class="card"><div class="card-h"><h3>ABC tahlil</h3><span class="hint">taomlar savdoga qo'shgan hissasi bo'yicha</span></div><div class="card-b">
        ${['A', 'B', 'C'].map((k) => `<div class="abc-row"><span class="abc ${k}">${k}</span><div><b>${d.abc[k].n} ta taom</b><div class="dim">${ABC_T[k]}</div></div><b class="v">${sum(d.abc[k].revenue)}</b></div>`).join('')}
        <div class="hint" style="margin-top:10px">A — bularni hech qachon tugatib qo'ymang. C — menyudan olib tashlash yoki narxini qayta ko'rish kerak bo'lgan taomlar.</div></div></div></div>
    <div class="card mt"><div class="card-h"><h3>Taomlar</h3><span class="grow"></span><span class="dim">${d.items.length} ta</span></div><div class="tbl-wrap" style="max-height:560px">
      ${d.items.length ? `<table class="tbl"><thead><tr><th></th><th>Taom</th><th>Toifa</th><th class="r">Soni</th><th class="r">Savdo</th><th class="r">Ulushi</th><th class="r">Foyda</th><th class="r">Marja</th><th class="r">Oldingi davr</th><th class="r">O'zgarish</th></tr></thead><tbody>
      ${d.items.map((i) => `<tr><td><span class="abc ${i.cls}">${i.cls}</span></td><td>${esc(i.name)}</td><td class="dim">${esc(i.category || '')}</td><td class="r">${qty(i.qty, i.unit === 'kg' ? 'kg' : '')}</td><td class="r">${sum(i.revenue)}</td>
        <td class="r dim">${String(i.share).replace('.', ',')}%</td><td class="r ${i.profit < 0 ? 'neg' : ''}">${i.no_cost ? '<span class="dim">tannarx yo\'q</span>' : sum(i.profit)}</td><td class="r dim">${i.no_cost ? '' : String(i.margin).replace('.', ',') + '%'}</td>
        <td class="r dim">${sum(i.prev_revenue)}</td><td class="r">${delta(i.revenue, i.prev_revenue)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Bu davrda sotilgan taom yo\'q</div>'}</div></div>
    <div class="cols2 even mt"><div class="card"><div class="card-h"><h3>Eng ko'p o'sgan taomlar</h3></div><div class="tbl-wrap">${mv(up, 'O\'sgan taom yo\'q')}</div></div>
      <div class="card"><div class="card-h"><h3>Eng ko'p pasaygan taomlar</h3></div><div class="tbl-wrap">${mv(down, 'Pasaygan taom yo\'q')}</div></div></div>
    <div class="card mt"><div class="card-h"><h3>Sotilmagan taomlar</h3><span class="hint">menyuda bor, lekin bu davrda bir marta ham sotilmagan</span><span class="grow"></span><span class="dim">${d.dead_n} ta</span></div><div class="tbl-wrap" style="max-height:420px">
      ${d.dead.length ? `<table class="tbl"><thead><tr><th>Taom</th><th>Toifa</th><th class="r">Narxi</th><th>Oxirgi marta sotilgan</th></tr></thead><tbody>
      ${d.dead.map((x) => `<tr><td>${esc(x.name)}${x.stop ? ' <span class="badge warn">stopda</span>' : ''}</td><td class="dim">${esc(x.category || '')}</td><td class="r">${sum(x.price)}</td><td>${x.last_sold ? date(x.last_sold) : '<span class="dim">180 kundan beri sotilmagan</span>'}</td></tr>`).join('')}</tbody></table>
      ${d.dead_n > d.dead.length ? `<div class="hint" style="padding:10px 14px">Ro'yxatda birinchi ${d.dead.length} tasi ko'rsatilgan.</div>` : ''}` : '<div class="empty">Menyudagi hamma taom sotilgan</div>'}</div></div>`;
  $('#xl').onclick = () => csv(`analitika_${A.range.from}_${A.range.to}`, ['ABC', 'Taom', 'Toifa', 'Soni', 'Savdo', 'Ulushi %', 'Tannarx', 'Foyda', 'Marja %', 'Oldingi davr savdosi'],
    d.items.map((i) => [i.cls, i.name, i.category || '', String(i.qty).replace('.', ','), i.revenue, String(i.share).replace('.', ','), i.cost, i.profit, String(i.margin).replace('.', ','), i.prev_revenue]));
};

PAGES.material = async (m) => {
  const d = await S('/api/reports/material?' + rq());
  const groups = new Map();
  for (const r of d.rows) { const g = r.grp || 'Boshqa'; groups.set(g, [...(groups.get(g) || []), r]); }
  const cell = (q, v, u, cls = '') => `<td class="r ${cls}">${q ? qty(q, u) : '<span class="dim">—</span>'}</td><td class="r ${cls}">${v ? sum(v) : '<span class="dim">—</span>'}</td>`;
  const t = d.totals; const mo = d.money;
  m.innerHTML = head('Moddiy hisobot', `${rlabel()} · boshida + kirim − sarf − utilizatsiya ± inventarizatsiya = oxirida`, xlBtn('xl') + `<button class="btn sm" onclick="print()">${icon('print')}Chop etish</button>`) + rangeBar(() => show('material'))
    + (mo ? `<div class="sec-t mt">Pul xulosasi</div>
    <div class="stats">${stat('Savdo', sum(mo.revenue), `${mo.orders} ta buyurtma`)}
      ${stat('Sof foyda', `<span class="${mo.net < 0 ? 'neg' : ''}">${sum(mo.net)}</span>`, `savdo − tannarx ${sum(mo.cost)} − rasxod ${sum(mo.expenses)} − utilizatsiya`, 'accent')}
      ${stat('Utilizatsiya', sum(mo.waste), 'yaroqsiz bo\'lib chiqarilgan')}
      ${stat('Xodimlar oldi', sum(mo.staff), mo.expenses - mo.staff ? `ish haqi · boshqa rasxod ${sum(mo.expenses - mo.staff)}` : 'ish haqi (rasxoddan)')}
      ${stat('Kassada bor', mo.cash === null ? '<span class="dim">—</span>' : sum(mo.cash), mo.cash === null ? 'smena yopiq' : `hozir, naqd · Smena №${mo.shift_number ?? ''}`)}</div>
    <div class="sec-t mt">Ombor (elementlar)</div>` : '')
    + `<div class="stats${mo ? '' : ' mt'}">${stat('Davr boshida', sum(t.open_v))}${stat('Kirim', sum(t.in_v), '', 'accent')}${stat('Sarf (taomlarga)', sum(t.used_v))}${stat('Utilizatsiya', sum(t.waste_v))}${stat('Davr oxirida', sum(t.close_v))}</div>
    <div class="card mt"><div class="tbl-wrap"><table class="tbl"><thead>
      <tr><th rowspan="2">Element</th><th colspan="2" class="c">Davr boshida</th><th colspan="2" class="c">Kirim</th><th colspan="2" class="c">Sarf (sotuv)</th><th colspan="2" class="c">Utilizatsiya</th><th colspan="2" class="c">Inventar / farq</th><th colspan="2" class="c">Davr oxirida</th></tr>
      <tr>${'<th class="r">Miqdor</th><th class="r">Summa</th>'.repeat(6)}</tr></thead><tbody>
      ${[...groups].map(([g, rows]) => `<tr class="grp"><td colspan="13">${esc(g)}</td></tr>${rows.map((r) => `<tr class="click" data-ing="${r.id}"><td>${esc(r.name)} ${r.low ? '<span class="badge warn">kam</span>' : ''}</td>
        ${cell(r.open_q, r.open_v, r.unit)}${cell(r.in_q, r.in_v, r.unit)}${cell(r.used_q, r.used_v, r.unit)}${cell(r.waste_q, r.waste_v, r.unit)}${cell(r.inv_q, r.inv_v, r.unit, r.inv_q < 0 ? 'neg' : '')}${cell(r.close_q, r.close_v, r.unit, r.close_q < 0 ? 'neg' : '')}</tr>`).join('')}`).join('')}
      <tr class="total"><td>JAMI</td><td></td><td class="r">${sum(t.open_v)}</td><td></td><td class="r">${sum(t.in_v)}</td><td></td><td class="r">${sum(t.used_v)}</td><td></td><td class="r">${sum(t.waste_v)}</td><td></td><td class="r">${sum(t.inv_v)}</td><td></td><td class="r">${sum(t.close_v)}</td></tr>
      </tbody></table></div></div>
    <div class="card mt"><div class="card-h"><h3>Element qaysi taomga ketdi</h3><span class="hint">texnologik karta bo'yicha avtomatik ayirilgan</span></div><div class="tbl-wrap" style="max-height:480px">
      ${d.dishes.length ? `<table class="tbl"><thead><tr><th>Taom</th><th>Element</th><th class="r">Miqdor</th><th class="r">Tannarx</th></tr></thead><tbody>
      ${d.dishes.map((x) => `<tr><td>${esc(x.product || '—')}</td><td>${esc(x.ingredient)}</td><td class="r">${qty(x.q, x.unit)}</td><td class="r">${sum(x.v)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">Bu davrda texkarta bo\'yicha sarf yo\'q</div>'}</div></div>`;
  $$('[data-ing]', m).forEach((r) => r.onclick = () => movesModal(Number(r.dataset.ing), d.rows.find((x) => x.id === Number(r.dataset.ing))?.name));
  $('#xl').onclick = () => csv(`moddiy_hisobot_${A.range.from}_${A.range.to}`,
    ['Guruh', 'Element', 'Birlik', 'Boshida miqdor', 'Boshida summa', 'Kirim miqdor', 'Kirim summa', 'Sarf miqdor', 'Sarf summa', 'Utilizatsiya miqdor', 'Utilizatsiya summa', 'Farq miqdor', 'Farq summa', 'Oxirida miqdor', 'Oxirida summa'],
    [...d.rows.map((r) => [r.grp || '', r.name, r.unit, ...[r.open_q, r.open_v, r.in_q, r.in_v, r.used_q, r.used_v, r.waste_q, r.waste_v, r.inv_q, r.inv_v, r.close_q, r.close_v].map((v) => String(v).replace('.', ','))]),
      ...(mo ? [[], ['PUL XULOSASI'], ['', 'Savdo', '', mo.revenue], ['', 'Tannarx', '', mo.cost], ['', 'Rasxod (jami)', '', mo.expenses], ['', 'shundan xodimlar oldi (ish haqi)', '', mo.staff],
        ['', 'Utilizatsiya', '', mo.waste], ['', 'Sof foyda', '', mo.net], ['', 'Kassada bor (hozir, naqd)', '', mo.cash === null ? 'smena yopiq' : mo.cash]] : [])]);
};

async function movesModal(id, name, unit) {
  const from = dayShift(today(), -30);
  const d = await S(`/api/stock/moves?ingredient_id=${id}&from=${from}&to=${today()}`);
  openModal({
    title: `${name || 'Element'} — harakatlar (30 kun)`, size: 'xl',
    body: d.moves.length ? `<div class="tbl-wrap" style="max-height:60vh"><table class="tbl"><thead><tr><th>Vaqt</th><th>Turi</th><th>Nima</th><th class="r">Miqdor</th><th class="r">Narx</th><th class="r">Qoldiq</th><th>Kim</th></tr></thead><tbody>
      ${d.moves.map((x) => `<tr><td>${dateTime(x.at)}</td><td>${esc({ kirim: 'Kirim', sotuv: 'Sotuv', utilizatsiya: 'Utilizatsiya', inventar: 'Inventarizatsiya', bekor: 'Bekor qilindi', tayyorlash: x.qty > 0 ? 'Tayyorlandi' : 'Zagotovkaga ketdi' }[x.kind] || x.kind)}</td>
      <td>${x.product ? esc(x.product) : ''}${x.number ? ` <span class="dim">№${esc(x.number)}</span>` : ''}${x.doc_id ? ` <span class="dim">hujjat #${x.doc_id}</span>` : ''}${x.note ? ` <span class="dim">${esc(x.note)}</span>` : ''}</td>
      <td class="r ${x.qty < 0 ? 'neg' : 'okc'}">${x.qty > 0 ? '+' : ''}${qty(x.qty, unit)}</td><td class="r">${sum(x.cost)}</td><td class="r">${qty(x.balance, unit)}</td><td>${esc(x.user_name || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Harakat yo\'q</div>',
  });
}

// ---- Ombor ----
PAGES.stock = async (m) => {
  const d = await S('/api/stock/ingredients');
  const q = (A.stockQ || '').toLowerCase();
  const rows = d.ingredients.filter((i) => !q || i.name.toLowerCase().includes(q) || (i.grp || '').toLowerCase().includes(q));
  const total = d.ingredients.reduce((s, i) => s + Math.max(0, i.value), 0);
  const low = d.ingredients.filter((i) => i.low).length;
  const neg = d.ingredients.filter((i) => i.stock < 0).length;
  m.innerHTML = head('Ombor qoldig\'i', 'Elementlar — kirim bilan ko\'payadi, taom sotilganda texkarta bo\'yicha kamayadi',
    `<button class="btn" data-doc="kirim">${icon('truckin')}Kirim</button><button class="btn" data-doc="utilizatsiya">${icon('trash')}Utilizatsiya</button><button class="btn" data-doc="inventar">${icon('check')}Inventarizatsiya</button><button class="btn primary" id="add">${icon('plus')}Element</button>`)
    + `<div class="stats">${stat('Ombor qiymati (tannarxda)', sum(total), `${d.ingredients.length} ta element`, 'accent')}${stat('Kam qolgan', low, 'eng kam qoldiqdan past')}${stat('Manfiy qoldiq', `<span class="${neg ? 'neg' : ''}">${neg}</span>`, 'kirim kiritilmagan')}</div>
    <div class="card mt"><div class="card-h"><input class="input" id="q" placeholder="Qidirish: nomi yoki guruhi" value="${esc(A.stockQ || '')}" style="max-width:340px"><span class="grow"></span></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Element</th><th>Guruh</th><th class="r">Qoldiq</th><th class="r">Eng kam</th><th class="r">1 birlik narxi</th><th class="r">Qiymati</th><th class="r">Taomlarda</th><th></th></tr></thead><tbody>
    ${rows.map((i) => `<tr class="click" data-i="${i.id}"><td><b>${esc(i.name)}</b>${i.prep ? ' <span class="badge">zagotovka</span>' : ''}</td><td class="dim">${esc(i.grp || '')}</td>
      <td class="r ${i.stock < 0 ? 'neg' : ''}"><b>${qty(i.stock, i.unit)}</b> ${i.low ? '<span class="badge warn">kam</span>' : ''}</td><td class="r dim">${qty(i.min_stock, i.unit)}</td>
      <td class="r">${sum(i.cost)} <span class="dim">/ ${UNIT[i.unit]}</span></td><td class="r">${sum(i.value)}</td><td class="r dim">${i.dishes || '—'}</td>
      <td class="r"><button class="btn sm ghost" data-edit="${i.id}">${icon('edit')}</button></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">Element yo\'q — "+ Element" bilan qo\'shing</div></td></tr>'}
    </tbody></table></div></div>`;
  $('#q').oninput = (e) => { A.stockQ = e.target.value; clearTimeout(A.qt); A.qt = setTimeout(() => show('stock').then(() => { const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 250); };
  $('#add').onclick = () => ingredientForm();
  $$('[data-doc]', m).forEach((b) => b.onclick = () => docForm(b.dataset.doc));
  $$('[data-edit]', m).forEach((b) => b.onclick = async (e) => {
    e.stopPropagation(); const ig = d.ingredients.find((i) => i.id === Number(b.dataset.edit));
    if (ig.prep) prepForm((await S('/api/stock/preps')).preps.find((p) => p.id === ig.id)); else ingredientForm(ig);
  });
  $$('[data-i]', m).forEach((r) => { const ig = d.ingredients.find((i) => i.id === Number(r.dataset.i)); r.onclick = () => movesModal(ig.id, ig.name, ig.unit); });
};

const UNIT_HELP = { kg: 'go\'sht, sabzavot, un, sous…', l: 'yog\', sut, sharbat…', dona: 'bulochka, tuxum, Cola, stakan…' };
/** Nomiga qarab o'lchovni taxmin qiladi (egasi baribir o'zi tanlaydi). */
const guessUnit = (name) => {
  const n = String(name).toLowerCase();
  if (/bulochka|non\b|lavash|tuxum|stakan|paket|qopqoq|quti|banka|butilka|cola|pepsi|fanta|sprite|dona|qadoq|lepyoshka|bun|kotlet|sosiska|nagget|naget|tortil|pita\b|shokolad|chips|salfetka|somsa/.test(n)) return 'dona';
  if (/yog'|yog‘|sut\b|qaymoq|sharbat|sirop|suv\b|moy\b/.test(n)) return 'l';
  return 'kg';
};
const unitChips = (cur) => `<div class="uchips">${Object.entries(UNIT).map(([k, v]) => `<button type="button" class="uchip ${cur === k ? 'on' : ''}" data-uv="${k}"><b>${v}</b><small>${UNIT_HELP[k]}</small></button>`).join('')}</div>`;

/** Element qo'shish — nomi va o'lchovi; xohlasa shu yerning o'zida hozir bori va narxi (kirim o'zi yoziladi). */
async function ingredientForm(ing = null) {
  const all = (await S('/api/stock/ingredients')).ingredients;
  const groups = [...new Set(all.map((i) => i.grp).filter(Boolean))];
  let unit = ing?.unit || 'kg'; let touched = !!ing;
  return openModal({
    title: ing ? 'Elementni tahrirlash' : 'Yangi element',
    body: `<div class="field"><label>Nomi</label><input class="input" data-n value="${esc(ing?.name || '')}" placeholder="masalan: Mol go'shti, Pishloq, Bulochka" autofocus></div>
      <div class="field"><label>Qanday o'lchanadi?</label>${unitChips(unit)}</div>
      ${ing ? '' : `<div class="startbox"><div class="lbl" style="margin-bottom:8px">Hozir omborda bormi? <span class="dim" style="font-weight:400">— bo'lsa yozing, kirim o'zi yoziladi</span></div>
        <div class="grid2"><div class="field"><label>Miqdori</label><div class="unitbox"><input class="input" data-sq inputmode="decimal" placeholder="masalan 10"><span data-su>${UNIT[unit]}</span></div></div>
        <div class="field"><label>Jami necha pulga olingan (so'm)</label><input class="input money" data-sp inputmode="numeric" placeholder="masalan 850 000"></div></div>
        <p class="hint" data-sh></p></div>`}
      <details class="more" ${ing && (ing.grp || ing.min_stock) ? 'open' : ''}><summary>Qo'shimcha: guruh va eng kam qoldiq</summary>
        <div class="grid2" style="margin-top:10px"><div class="field"><label>Guruh</label><input class="input" data-g list="grps" value="${esc(ing?.grp || '')}" placeholder="Go'sht, Sabzavot…"><datalist id="grps">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></div>
        <div class="field"><label>Eng kam qoldiq (kam qolsa ogohlantiradi)</label><div class="unitbox"><input class="input" data-m inputmode="decimal" value="${ing?.min_stock ? String(ing.min_stock).replace('.', ',') : ''}" placeholder="masalan 2"><span data-mu>${UNIT[unit]}</span></div></div></div></details>`,
    foot: `${ing ? `<button class="btn danger" data-del>${icon('trash')}O'chirish</button><button class="btn ghost" data-toprep title="Bu element o'zi boshqa elementlardan tayyorlanadi (kotlet, sous…)">Zagotovka qilish</button><span class="grow"></span>` : ''}<button class="btn" data-x>Bekor</button>${ing ? '' : '<button class="btn" data-again>Saqlash va yana qo\'shish</button>'}<button class="btn primary" data-ok>Saqlash</button>`,
    onOpen: (mm, close) => {
      const nameI = mm.querySelector('[data-n]');
      const setUnit = (u) => { unit = u; $$('.uchip', mm).forEach((b) => b.classList.toggle('on', b.dataset.uv === u)); const su = mm.querySelector('[data-su]'); if (su) su.textContent = UNIT[u]; mm.querySelector('[data-mu]').textContent = UNIT[u]; hint(); };
      const hint = () => {
        const h = mm.querySelector('[data-sh]'); if (!h) return;
        const qp = qtyParse(mm.querySelector('[data-sq]').value, unit); const p = moneyVal(mm.querySelector('[data-sp]'));
        mm.querySelector('[data-sq]').classList.toggle('bad', !qp.ok);
        h.textContent = qp.ok && qp.v > 0 && p > 0 ? `1 ${UNIT[unit]} = ${sum(Math.round(p / qp.v))} so'm` : '';
      };
      $$('.uchip', mm).forEach((b) => b.onclick = () => { touched = true; setUnit(b.dataset.uv); });
      nameI.addEventListener('input', () => { if (!touched) setUnit(guessUnit(nameI.value)); });
      if (mm.querySelector('[data-sp]')) { moneyInput(mm.querySelector('[data-sp]')); mm.addEventListener('input', hint); }
      const save = async (again) => {
        const name = nameI.value.trim(); if (!name) { toast('Nomini yozing', 'bad'); nameI.focus(); return; }
        const sq = mm.querySelector('[data-sq]'); const qp = sq ? qtyParse(sq.value, unit) : { ok: true, v: 0 };
        if (!qp.ok) { toast('Miqdor son bo\'lsin: masalan 10, 0,5 yoki 500 g', 'bad'); sq.focus(); return; }
        const price = moneyVal(mm.querySelector('[data-sp]'));
        if (qp.v > 0 && !(price > 0)) { toast('Necha pulga olinganini yozing — tannarx shundan hisoblanadi', 'bad'); mm.querySelector('[data-sp]').focus(); return; }
        try {
          const mp = qtyParse(mm.querySelector('[data-m]').value, unit);
          if (!mp.ok) { toast('Eng kam qoldiq son bo\'lsin: masalan 2 yoki 500 g', 'bad'); mm.querySelector('[data-m]').focus(); return; }
          const r = await P('/api/stock/ingredient', { id: ing?.id, name, unit, grp: mm.querySelector('[data-g]').value, min_stock: mp.v });
          if (qp.v > 0) await P('/api/stock/doc', { kind: 'kirim', note: 'Boshlang\'ich qoldiq', lines: [{ ingredient_id: r.id, qty: qp.v, price: price / qp.v }] });
          toast(qp.v > 0 ? `${name} qo'shildi va omborga ${qty(qp.v, unit)} ${UNIT[unit]} kirim qilindi` : 'Saqlandi', 'ok');
          if (again) { nameI.value = ''; if (sq) sq.value = ''; const sp = mm.querySelector('[data-sp]'); if (sp) sp.value = ''; touched = false; setUnit('kg'); nameI.focus(); A.ingDirty = true; }
          else close(true);
        } catch (e) { fail(e); }
      };
      mm.querySelector('[data-ok]').onclick = () => save(false);
      mm.querySelector('[data-again]')?.addEventListener('click', () => save(true));
      mm.querySelector('[data-toprep]')?.addEventListener('click', () => { close(false); prepForm(null, ing); });
      mm.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmBox(`${ing.name} o'chirilsinmi? Texkartalardan ham olib tashlanadi.`, { danger: true, ok: 'O\'chirish' }))) return;
        try { await P('/api/stock/ingredient/remove', { id: ing.id }); toast('O\'chirildi', 'ok'); close(true); } catch (e) { fail(e); }
      });
    },
  }).then((res) => { if (res || A.ingDirty) { A.ingDirty = false; show(A.page); } });
}

/** Element tanlash maydoni (qidiruv bilan). */
function picker(list, value, placeholder = 'Element tanlang') {
  return `<div class="picker" data-pk><input class="input" data-pkq placeholder="${esc(placeholder)}" value="${esc(list.find((x) => x.id === value)?.name || '')}" data-id="${value || ''}" autocomplete="off"><div class="list" hidden></div></div>`;
}
function bindPickers(root, list, onPick, create = null) {
  $$('[data-pk]', root).forEach((pk) => {
    if (pk.dataset.bound) return; pk.dataset.bound = 1;
    const inp = pk.querySelector('[data-pkq]'); const box = pk.querySelector('.list');
    const pick = (x) => { inp.value = x.name; inp.dataset.id = x.id; box.hidden = true; onPick?.(pk, x); };
    const draw = () => {
      const raw = inp.value.trim(); const q = raw.toLowerCase();
      const res = list.filter((x) => !q || x.name.toLowerCase().includes(q)).slice(0, 40);
      const exact = list.some((x) => x.name.toLowerCase() === q);
      box.innerHTML = res.map((x) => `<button type="button" data-v="${x.id}"><span>${esc(x.name)}</span><span class="dim">${esc(x.hint || '')}</span></button>`).join('')
        + (create && raw && !exact ? `<button type="button" class="newi" data-new>${icon('plus')}<span>«${esc(raw)}» — yangi element qo'shish</span></button>` : '')
        + (!res.length && !(create && raw) ? '<div class="hint" style="padding:10px">Topilmadi</div>' : '');
      box.hidden = false;
      box.querySelectorAll('[data-v]').forEach((b) => b.onmousedown = (e) => { e.preventDefault(); pick(list.find((y) => y.id === Number(b.dataset.v))); });
      box.querySelector('[data-new]')?.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const g = guessUnit(raw);
        box.innerHTML = `<div class="newu"><div>«${esc(raw)}» qanday o'lchanadi?</div><div class="row" style="gap:6px;margin-top:8px">${Object.entries(UNIT).map(([k, v]) => `<button type="button" class="chip ${k === g ? 'on' : ''}" data-nu="${k}">${v}</button>`).join('')}</div><div class="hint" style="margin-top:6px">kg — go'sht, sabzavot · litr — yog', sut · dona — bulochka, tuxum</div></div>`;
        box.querySelectorAll('[data-nu]').forEach((b) => b.onmousedown = async (ev) => {
          ev.preventDefault();
          try { const x = await create(raw, b.dataset.nu); list.push(x); pick(x); toast(`${x.name} elementlarga qo'shildi`, 'ok'); }
          catch (er) { fail(er); }
        });
      });
    };
    inp.addEventListener('focus', draw); inp.addEventListener('input', () => { inp.dataset.id = ''; draw(); });
    inp.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  });
}
/** Tanlash maydonidan yangi element yaratish (kirim va texkarta uchun). */
const createIngredient = async (name, unit) => {
  const r = await P('/api/stock/ingredient', { name, unit });
  return { id: r.id, name, unit, cost: 0, stock: 0, hint: `0 · ${UNIT[unit]}` };
};

async function docForm(kind) {
  const ings = (await S('/api/stock/ingredients')).ingredients;
  const list = ings.map((i) => ({ id: i.id, name: i.name, unit: i.unit, hint: `${qty(i.stock, i.unit)} · ${UNIT[i.unit]}`, stock: i.stock, cost: i.cost }));
  let sups = []; let prods = [];
  if (kind === 'kirim') sups = (await S('/api/suppliers')).suppliers;
  if (kind === 'utilizatsiya') prods = (await S('/api/admin/menu')).products;
  const titles = { kirim: 'Kirim — omborga mahsulot keldi', utilizatsiya: 'Utilizatsiya — yaroqsiz mahsulotni hisobdan chiqarish', inventar: 'Inventarizatsiya — ombordagi haqiqiy qoldiqni sanash' };
  const lineRow = () => kind === 'kirim'
    ? `<div class="ln" data-ln>${picker(list)}<div class="unitbox"><input class="input" data-q inputmode="decimal" placeholder="masalan 10"><span data-u></span></div><input class="input money" data-p inputmode="numeric" placeholder="1 birlik narxi"><input class="input money" data-t inputmode="numeric" placeholder="yoki jami summa"><button class="icon-btn" data-rm type="button">${icon('x')}</button></div>`
    : `<div class="ln" data-ln>${picker([...list, ...prods.map((p) => ({ id: -p.id, name: p.name + ' (tayyor taom)', hint: 'texkarta bo\'yicha' }))], null, 'Element yoki tayyor taom')}<div class="unitbox"><input class="input" data-q inputmode="decimal" placeholder="Miqdor"><span data-u></span></div><span class="sum" data-s></span><button class="icon-btn" data-rm type="button">${icon('x')}</button></div>`;
  const body = kind === 'inventar'
    ? `<p class="hint" style="margin-bottom:12px">Faqat sanalgan elementlarga haqiqiy miqdorni yozing — bo'sh qoldirilganlari o'zgarmaydi. Farq hisobotda "Inventar / farq" ustunida chiqadi.</p>
      <input class="input" data-iq placeholder="Qidirish" style="margin-bottom:10px">
      <div class="lines inv" style="max-height:50vh;overflow:auto"><div class="ln h"><span>Element</span><span class="r">Tizimda</span><span>Haqiqiy (sanaldi)</span><span class="r">Farq</span></div>
      ${list.map((i) => `<div class="ln" data-inv="${i.id}"><span>${esc(i.name)}</span><span class="r dim">${qty(i.stock, i.unit)}</span><div class="unitbox"><input class="input" data-q inputmode="decimal"><span>${UNIT[i.unit]}</span></div><span class="sum" data-s></span></div>`).join('')}</div>`
    : `${kind === 'kirim' ? `<div class="grid3"><div class="field"><label>Yetkazib beruvchi</label><select class="input" data-sup><option value="">— tanlanmagan —</option>${sups.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Sana</label><input class="input" type="date" data-at value="${today()}" max="${today()}"></div><div class="field"><label>Izoh</label><input class="input" data-note placeholder="nakladnoy raqami…"></div></div>`
      : `<div class="field"><label>Sababi</label><div class="chips" data-r>${['Muddati o\'tdi', 'Buzildi', 'Tushib ketdi', 'Kuyib qoldi', 'Mijoz qaytardi'].map((x) => `<button type="button" class="chip" data-v="${esc(x)}">${esc(x)}</button>`).join('')}</div>
        <input class="input" data-rt placeholder="yoki o'zingiz yozing" style="margin-top:8px"></div>`}
      <div class="lines ${kind === 'kirim' ? '' : 'rec'}"><div class="ln h">${kind === 'kirim' ? '<span>Element <span class="dim" style="font-weight:400">— yo\'g\'ini shu yerda qo\'shsa bo\'ladi</span></span><span>Miqdor</span><span>Narxi — 1 kg / 1 dona uchun</span><span>Jami summa</span><span></span>' : '<span>Nima</span><span>Miqdor</span><span class="r">Tannarx</span><span></span>'}</div><div data-lines>${lineRow()}</div></div>
      <button class="btn sm" data-more type="button">${icon('plus')}Yana qator</button>
      ${kind === 'kirim' ? `<div class="grid3 mt"><div class="stat"><div class="l">Jami summa</div><div class="v" data-total>0</div></div>
        <div class="field"><label>Hozir to'landi</label><input class="input money" data-paid inputmode="numeric" placeholder="0 — hammasi qarzga"></div>
        <div class="field"><label>Qayerdan to'landi</label><select class="input" data-from><option value="kassa">Kassadan (naqd)</option><option value="karta">Karta</option><option value="bank">Bank (perechisleniye)</option><option value="boshqa">Boshqa (egasining cho'ntagidan)</option></select></div></div>
        <p class="hint">To'lanmagan qismi yetkazib beruvchiga qarzimiz bo'lib yoziladi (Pul → Yetkazib beruvchilar).</p>` : ''}`;
  await openModal({
    title: titles[kind], size: 'xl', body,
    foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>${icon('check')}Saqlash</button>`,
    onOpen: (mm, close) => {
      const unitOf = (id) => list.find((x) => x.id === id)?.unit;
      const recalc = () => {
        let tot = 0;
        $$('[data-ln]', mm).forEach((ln) => {
          const id = Number(ln.querySelector('[data-pkq]')?.dataset.id);
          const u = id > 0 ? unitOf(id) : 'dona';
          const su = ln.querySelector('[data-u]'); if (su) su.textContent = id ? (id > 0 ? UNIT[u] : 'porsiya') : '';
          const qi = ln.querySelector('[data-q]');
          const qp = qtyParse(qi.value, id > 0 ? u : 'dona');
          qi.classList.toggle('bad', !qp.ok);
          const q = qp.v;
          if (kind === 'kirim') {
            // Narx yoki jami summa — qaysi biri yozilsa, ikkinchisi o'zi hisoblanadi.
            const pr = ln.querySelector('[data-p]'); const tt = ln.querySelector('[data-t]');
            pr.placeholder = id ? `1 ${UNIT[u]} narxi` : '1 birlik narxi';
            if (ln.dataset.last === 't') { const t = moneyVal(tt); if (document.activeElement !== pr) pr.value = q > 0 && t ? sum(Math.round(t / q)) : ''; tot += t; }
            else { const t = Math.round(q * moneyVal(pr)); if (document.activeElement !== tt) tt.value = t ? sum(t) : ''; tot += t; }
          } else if (id > 0) ln.querySelector('[data-s]').textContent = q ? sum(q * (list.find((x) => x.id === id)?.cost || 0)) : '';
        });
        $$('[data-inv]', mm).forEach((ln) => {
          const v = ln.querySelector('[data-q]').value.trim(); const i = list.find((x) => x.id === Number(ln.dataset.inv));
          const qp = qtyParse(v, i.unit); ln.querySelector('[data-q]').classList.toggle('bad', !qp.ok);
          const diff = v === '' || !qp.ok ? null : qp.v - i.stock;
          ln.querySelector('[data-s]').innerHTML = diff == null ? '' : `<span class="${diff < 0 ? 'neg' : diff > 0 ? 'okc' : 'dim'}">${diff > 0 ? '+' : ''}${qty(Math.round(diff * 1000) / 1000, i.unit)}</span>`;
        });
        const t = mm.querySelector('[data-total]'); if (t) t.textContent = sum(tot);
      };
      const bind = () => { bindPickers(mm, kind === 'kirim' ? list : [...list, ...prods.map((p) => ({ id: -p.id, name: p.name + ' (tayyor taom)', hint: 'texkarta bo\'yicha' }))], recalc, kind === 'kirim' ? createIngredient : null);
        $$('[data-p],[data-t]', mm).forEach((i) => { if (!i.dataset.m) { i.dataset.m = 1; moneyInput(i); } }); };
      bind();
      mm.querySelector('[data-paid]') && moneyInput(mm.querySelector('[data-paid]'));
      mm.addEventListener('input', (e) => {
        const ln = e.target.closest('[data-ln]');
        if (ln && e.target.matches('[data-t]')) ln.dataset.last = 't'; else if (ln && e.target.matches('[data-p]')) ln.dataset.last = 'p';
        recalc();
      });
      mm.querySelector('[data-more]')?.addEventListener('click', () => { mm.querySelector('[data-lines]').insertAdjacentHTML('beforeend', lineRow()); bind(); });
      mm.addEventListener('click', (e) => { const rm = e.target.closest('[data-rm]'); if (rm && $$('[data-ln]', mm).length > 1) { rm.closest('[data-ln]').remove(); recalc(); } });
      let reason = '';
      $$('[data-r] .chip', mm).forEach((b) => b.onclick = () => { reason = b.dataset.v; $$('[data-r] .chip', mm).forEach((x) => x.classList.toggle('on', x === b)); });
      mm.querySelector('[data-iq]')?.addEventListener('input', (e) => { const q = e.target.value.toLowerCase(); $$('[data-inv]', mm).forEach((ln) => { ln.hidden = !ln.textContent.toLowerCase().includes(q); }); });
      mm.querySelector('[data-ok]').onclick = async () => {
        let lines = [];
        if (mm.querySelector('[data-q].bad')) { toast('Miqdor son bo\'lsin: masalan 10, 0,5 yoki 500 g', 'bad'); mm.querySelector('[data-q].bad').focus(); return; }
        if (kind === 'inventar') lines = $$('[data-inv]', mm).filter((ln) => ln.querySelector('[data-q]').value.trim() !== '').map((ln) => ({ ingredient_id: Number(ln.dataset.inv), qty: qtyVal(ln.querySelector('[data-q]'), unitOf(Number(ln.dataset.inv))) }));
        else {
          for (const ln of $$('[data-ln]', mm)) {
            const id = Number(ln.querySelector('[data-pkq]').dataset.id); const q = qtyVal(ln.querySelector('[data-q]'), id > 0 ? unitOf(id) : 'dona');
            if (!id && !q) continue;
            if (!id) { toast('Qatorda element tanlanmagan', 'bad'); return; }
            if (!(q > 0)) { toast('Miqdorni kiriting', 'bad'); ln.querySelector('[data-q]').focus(); return; }
            if (kind === 'kirim') {
              const t = moneyVal(ln.querySelector('[data-t]')); const p = moneyVal(ln.querySelector('[data-p]'));
              const price = ln.dataset.last === 't' ? t / q : p;
              if (!(price > 0)) { toast('Narxini yoki jami summasini yozing', 'bad'); ln.querySelector('[data-p]').focus(); return; }
              lines.push({ ingredient_id: id, qty: q, price });
            }
            else lines.push(id > 0 ? { ingredient_id: id, qty: q } : { product_id: -id, qty: q });
          }
        }
        if (!lines.length) { toast('Hech narsa kiritilmagan', 'bad'); return; }
        const b = { kind, lines };
        if (kind === 'kirim') Object.assign(b, { supplier_id: Number(mm.querySelector('[data-sup]').value) || null, note: mm.querySelector('[data-note]').value,
          at: mm.querySelector('[data-at]').value === today() ? undefined : mm.querySelector('[data-at]').value + 'T07:00:00Z', paid: moneyVal(mm.querySelector('[data-paid]')), pay_from: mm.querySelector('[data-from]').value });
        if (kind === 'utilizatsiya') { b.reason = mm.querySelector('[data-rt]').value.trim() || reason; if (!b.reason) { toast('Sababini tanlang', 'bad'); return; } }
        try { await P('/api/stock/doc', b); toast(`${KIND[kind]} saqlandi`, 'ok'); close(true); show(A.page); } catch (e) { fail(e); }
      };
    },
  });
}

PAGES.today = async (m) => {
  const day = A.todayDay || today();
  const d = await S('/api/stock/today?day=' + day);
  const t = d.totals;
  const active = d.rows.filter((r) => r.in_q || r.used_q || r.waste_q);
  m.innerHTML = head('Bugun omborda', `${date(day + 'T12:00:00Z')} · nima keldi, nima ishlatildi, qancha qoldi`,
    `<input type="date" class="input" style="height:40px" id="day" value="${day}" max="${today()}">`)
    + `<div class="stats">${stat('Keldi (kirim)', sum(t.in_v), '', 'accent')}${stat('Ishlatildi (taomlarga)', sum(t.used_v))}${stat('Utilizatsiya', sum(t.waste_v))}${stat('Hozir omborda', sum(t.stock_v), `${t.low} ta element kam`)}</div>
    <div class="card mt"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Element</th><th class="r">Keldi</th><th class="r">Summa</th><th class="r">Ishlatildi</th><th class="r">Tannarx</th><th class="r">Utilizatsiya</th><th class="r">Hozir qoldi</th></tr></thead><tbody>
    ${active.map((r) => `<tr class="click" data-i="${r.id}"><td><b>${esc(r.name)}</b></td><td class="r ${r.in_q ? 'okc' : 'dim'}">${r.in_q ? '+' + qty(r.in_q, r.unit) : '—'}</td><td class="r">${r.in_v ? sum(r.in_v) : ''}</td>
      <td class="r">${r.used_q ? qty(r.used_q, r.unit) : '<span class="dim">—</span>'}</td><td class="r">${r.used_v ? sum(r.used_v) : ''}</td><td class="r ${r.waste_q ? 'neg' : 'dim'}">${r.waste_q ? qty(r.waste_q, r.unit) : '—'}</td>
      <td class="r ${r.stock < 0 ? 'neg' : ''}"><b>${qty(r.stock, r.unit)}</b> ${r.low ? '<span class="badge warn">kam</span>' : ''}</td></tr>`).join('') || '<tr><td colspan="7"><div class="empty">Bu kunda ombor harakati yo\'q</div></td></tr>'}
    </tbody></table></div></div>`;
  $('#day').onchange = (e) => { A.todayDay = e.target.value; show('today'); };
  $$('[data-i]', m).forEach((r) => r.onclick = () => movesModal(Number(r.dataset.i), d.rows.find((x) => x.id === Number(r.dataset.i))?.name));
};

/** Utilizatsiya — alohida bo'lim: yaroqsiz element yoki tayyor taomni sababi bilan hisobdan chiqarish. */
PAGES.waste = (m) => PAGES.docs(m, 'waste');
// Inventarizatsiya — menyuda alohida: ilgari faqat «Kirim» sahifasidagi tugma ortida edi va egasi topolmadi.
PAGES.inv = (m) => PAGES.docs(m, 'inv');

PAGES.docs = async (m, mode = '') => {
  const waste = mode === 'waste'; const inv = mode === 'inv';
  const kind = waste ? 'utilizatsiya' : inv ? 'inventar' : A.docKind || '';
  const d = await S(`/api/stock/docs?${rq()}&kind=${kind}`);
  const wasteSum = waste ? d.docs.filter((x) => !x.cancelled_at).reduce((s_, x) => s_ + Number(x.total || 0), 0) : 0;
  m.innerHTML = (waste
    ? head('Utilizatsiya', `${rlabel()} · buzilgan, muddati o'tgan, kuygan yoki tushib ketgan mahsulot — sababi bilan`, `<button class="btn primary" data-doc="utilizatsiya">${icon('plus')}Utilizatsiya qilish</button>`)
    : inv ? head('Inventarizatsiya', `${rlabel()} · omborni sanab, haqiqiy qoldiqni kiriting — kamomad yoki ortiqcha o'zi hisoblanadi`, `<button class="btn primary" data-doc="inventar">${icon('check')}Inventarizatsiya qilish</button>`)
    : head('Kirim va hujjatlar', rlabel(), `<button class="btn primary" data-doc="kirim">${icon('truckin')}Kirim</button><button class="btn" data-doc="utilizatsiya">${icon('trash')}Utilizatsiya</button><button class="btn" data-doc="inventar">${icon('check')}Inventarizatsiya</button>`))
    + rangeBar(() => show(waste ? 'waste' : inv ? 'inv' : 'docs'))
    + (inv ? `<div class="card mt" style="padding:12px 16px;font-size:14px">Qanday qilinadi: <b>«Inventarizatsiya qilish»</b>ni bosing → ombordagi elementlarni sanab, haqiqiy miqdorini yozing (sanalmaganini bo'sh qoldiring) → Saqlash. Qoldiq shu songa tenglanadi, farq <b>Moddiy hisobot</b>dagi «Inventar / farq» ustunida ko'rinadi.</div>
      <div class="stats mt">${stat('Hujjatlar', d.docs.filter((x) => !x.cancelled_at).length, 'tanlangan davrda')}</div>`
      : waste ? `<div class="stats mt">${stat('Hujjatlar', d.docs.filter((x) => !x.cancelled_at).length)}${stat('Zarar (tannarxda)', sum(wasteSum), 'moddiy hisobotda alohida ustun')}</div>`
      : `<div class="seg mt" id="kinds">${[['', 'Hammasi'], ['kirim', 'Kirim'], ['utilizatsiya', 'Utilizatsiya'], ['inventar', 'Inventarizatsiya'], ['tayyorlash', 'Tayyorlash']].map(([k, l]) => `<button data-k="${k}" class="${kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>`)
    + `
    <div class="card mt"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Sana</th><th>Turi</th><th>Yetkazib beruvchi / sabab</th><th class="r">Qatorlar</th><th class="r">Summa</th><th class="r">To'landi</th><th>Kim</th></tr></thead><tbody>
    ${d.docs.map((x) => `<tr class="click" data-id="${x.id}" style="${x.cancelled_at ? 'opacity:.5' : ''}"><td>${x.id}</td><td>${dateTime(x.at)}</td><td><span class="badge ${x.kind === 'kirim' ? 'ok' : x.kind === 'utilizatsiya' ? 'bad' : ''}">${KIND[x.kind]}</span>${x.cancelled_at ? ' <span class="badge">bekor</span>' : ''}</td>
      <td>${esc(x.supplier || x.reason || '')}${x.note ? ` <span class="dim">· ${esc(x.note)}</span>` : ''}</td><td class="r">${x.lines}</td><td class="r"><b>${sum(x.total)}</b></td><td class="r">${x.kind === 'kirim' ? sum(x.paid) : ''}</td><td>${esc(x.user_name || '')}</td></tr>`).join('') || '<tr><td colspan="8"><div class="empty">Hujjat yo\'q</div></td></tr>'}
    </tbody></table></div></div>`;
  $$('[data-k]', m).forEach((b) => b.onclick = () => { A.docKind = b.dataset.k; show('docs'); });
  $$('[data-doc]', m).forEach((b) => b.onclick = () => docForm(b.dataset.doc));
  $$('[data-id]', m).forEach((r) => r.onclick = () => docView(Number(r.dataset.id)));
};

async function docView(id) {
  const d = await S('/api/stock/doc?id=' + id);
  const x = d.doc;
  openModal({
    title: `${KIND[x.kind]} #${x.id} — ${dateTime(x.at)}`, size: 'wide',
    body: `<p class="hint" style="margin-bottom:10px">${esc(x.supplier || x.reason || '')} ${x.note ? '· ' + esc(x.note) : ''} · ${esc(x.user_name || '')}${x.cancelled_at ? ` · <b class="neg">bekor qilingan ${dateTime(x.cancelled_at)}</b>` : ''}</p>
      <table class="tbl"><thead><tr><th>Element</th><th>Taom</th><th class="r">Miqdor</th><th class="r">Narx</th><th class="r">Summa</th></tr></thead><tbody>
      ${d.moves.map((mv) => `<tr style="${mv.kind === 'bekor' ? 'opacity:.55' : ''}"><td>${esc(mv.name)}${mv.kind === 'bekor' ? ' <span class="dim">(bekor)</span>' : ''}</td><td class="dim">${esc(mv.product || '')}</td><td class="r">${qty(mv.qty, mv.unit)}</td><td class="r">${sum(mv.cost)}</td><td class="r">${sum(mv.sum)}</td></tr>`).join('')}
      <tr class="total"><td colspan="4">Jami</td><td class="r">${sum(x.total)}</td></tr></tbody></table>
      ${x.kind === 'kirim' ? `<p style="margin-top:10px">To'landi: <b>${sum(x.paid)}</b>${x.total - x.paid > 0 ? ` · qarz: <b class="neg">${sum(x.total - x.paid)}</b>` : ''}</p>` : ''}`,
    foot: `${!x.cancelled_at ? `<button class="btn danger" data-c>${icon('trash')}Hujjatni bekor qilish</button><span class="grow"></span>` : ''}<button class="btn primary" data-x>Yopish</button>`,
    onOpen: (mm, close) => mm.querySelector('[data-c]')?.addEventListener('click', async () => {
      if (!(await confirmBox('Hujjat bekor qilinsinmi? Ombor qoldig\'i va yetkazib beruvchi qarzi orqaga qaytadi.', { danger: true, ok: 'Bekor qilish' }))) return;
      try { await P('/api/stock/doc/cancel', { id }); toast('Bekor qilindi', 'ok'); close(); show(A.page); } catch (e) { fail(e); }
    }),
  });
}

// =================== Zagotovkalar (yarim tayyor mahsulot) ===================
PAGES.preps = async (m) => {
  const d = await S('/api/stock/preps');
  const hist = (await S(`/api/stock/docs?from=${dayShift(today(), -30)}&to=${today()}&kind=tayyorlash`)).docs;
  const ready = d.preps.reduce((s, p) => s + Math.max(0, p.stock) * p.cost, 0);
  const unknown = d.preps.filter((p) => p.no_cost).length;
  m.innerHTML = head('Zagotovkalar', 'Yarim tayyor mahsulot: kotlet, sous, xamir, marinad… O\'zi elementlardan tayyorlanadi, taom texkartasiga bitta element bo\'lib qo\'yiladi',
    `<button class="btn" id="make" ${d.preps.length ? '' : 'disabled'}>${icon('flame')}Tayyorlash</button><button class="btn primary" id="add">${icon('plus')}Zagotovka</button>`)
    + `<div class="card" style="padding:12px 16px;font-size:14px;line-height:1.55"><b>Qanday ishlaydi.</b> 1) Zagotovkaning tarkibini yozing: nimadan tayyorlanadi va shu tarkibdan qancha chiqadi (masalan 1 kg qiyma + 100 g piyoz → 10 dona kotlet).
      2) Taom texkartasida uni oddiy elementdek tanlang («Kotlet — 1 dona»). 3) Taom sotilganda omborda <b>tayyori</b> bo'lsa o'shandan ayiriladi, bo'lmasa <b>tarkibidagi elementlar</b> o'zi ayiriladi.
      Oldindan ko'p tayyorlab qo'ysangiz «Tayyorlash»ni bosing — element ombordan chiqadi, tayyor zagotovka soni ko'rinib turadi.</div>
    <div class="stats mt">${stat('Zagotovkalar', d.preps.length, 'turi', 'accent')}${stat('Tayyor turgani (tannarxda)', sum(Math.round(ready)))}${stat('Narxi to\'liq emas', `<span class="${unknown ? 'neg' : ''}">${unknown}</span>`, 'tarkibidagi element kirim qilinmagan')}</div>
    <div class="card mt"><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Zagotovka</th><th>Tarkibi</th><th class="r">Chiqishi</th><th class="r">1 birlik tannarxi</th><th class="r">Tayyor (omborda)</th><th class="r">Taomlarda</th><th></th></tr></thead><tbody>
    ${d.preps.map((p) => `<tr class="click" data-p="${p.id}"><td><b>${esc(p.name)}</b>${p.grp ? `<div class="dim">${esc(p.grp)}</div>` : ''}</td>
      <td class="wrap">${p.lines.map((l) => `${esc(l.name)} <span class="dim">${qty(l.qty, l.unit)}</span>`).join(', ') || '<span class="neg">tarkibi yozilmagan</span>'}</td>
      <td class="r">${qty(p.yield, p.unit)}</td><td class="r">${p.cost ? sum(p.cost) : '<span class="dim">—</span>'} <span class="dim">/ ${UNIT[p.unit]}</span>${p.no_cost ? ' <span class="badge warn">chala</span>' : ''}</td>
      <td class="r"><b>${qty(p.stock, p.unit)}</b>${p.low ? ' <span class="badge warn">kam</span>' : ''}</td><td class="r dim">${p.dishes || '—'}</td>
      <td class="r" style="white-space:nowrap"><button class="btn sm" data-make="${p.id}">${icon('flame')}Tayyorlash</button> <button class="btn sm ghost" data-edit="${p.id}">${icon('edit')}</button></td></tr>`).join('')
      || '<tr><td colspan="7"><div class="empty">Zagotovka yo\'q — «+ Zagotovka» bilan qo\'shing</div></td></tr>'}
    </tbody></table></div></div>
    <div class="card mt"><div class="card-h"><h3>Tayyorlashlar</h3><span class="hint">so'nggi 30 kun</span></div><div class="tbl-wrap">
      ${hist.length ? `<table class="tbl"><thead><tr><th>#</th><th>Sana</th><th>Izoh</th><th class="r">Tannarxi</th><th>Kim</th></tr></thead><tbody>
      ${hist.map((x) => `<tr class="click" data-doc="${x.id}" style="${x.cancelled_at ? 'opacity:.5' : ''}"><td>${x.id}</td><td>${dateTime(x.at)}</td><td>${esc(x.note || '')}${x.cancelled_at ? ' <span class="badge">bekor</span>' : ''}</td><td class="r"><b>${sum(x.total)}</b></td><td>${esc(x.user_name || '')}</td></tr>`).join('')}</tbody></table>`
      : '<div class="empty">Hali tayyorlash yozilmagan — bu majburiy emas: yozilmasa, sotuvda elementlar o\'zi ayiriladi</div>'}</div></div>`;
  const P_ = (id) => d.preps.find((p) => p.id === Number(id));
  $('#add').onclick = () => prepForm();
  $('#make').onclick = () => produceForm(d.preps);
  $$('[data-make]', m).forEach((b) => b.onclick = (e) => { e.stopPropagation(); produceForm(d.preps, P_(b.dataset.make)); });
  $$('[data-edit]', m).forEach((b) => b.onclick = (e) => { e.stopPropagation(); prepForm(P_(b.dataset.edit)); });
  $$('[data-p]', m).forEach((r) => r.onclick = () => prepForm(P_(r.dataset.p)));
  $$('[data-doc]', m).forEach((r) => r.onclick = () => docView(Number(r.dataset.doc)));
};

/**
 * Zagotovka kartasi: nomi, o'lchovi, tarkibi va shu tarkibdan qancha chiqishi.
 * `base` — oddiy element: uni zagotovkaga aylantirish (qoldig'i va texkartalardagi o'rni saqlanadi).
 */
async function prepForm(p = null, base = null) {
  const all = (await S('/api/stock/ingredients')).ingredients;
  const self = p?.id || base?.id || 0;
  const raw = all.filter((i) => !i.prep && i.id !== self).map((i) => ({ id: i.id, name: i.name, unit: i.unit, cost: i.cost, stock: i.stock, hint: `${qty(i.stock, i.unit)} bor` }));
  const groups = [...new Set(all.map((i) => i.grp).filter(Boolean))];
  let unit = p?.unit || base?.unit || 'dona';
  const num = (v) => String(v).replace('.', ',');
  const line = (l = {}) => `<div class="ln" data-pl>${picker(raw, l.ingredient_id)}<div class="unitbox"><input class="input" data-q inputmode="decimal" value="${l.qty ? num(l.qty) : ''}" placeholder="0"><span data-u>${l.ingredient_id ? UNIT[raw.find((x) => x.id === l.ingredient_id)?.unit] || '' : ''}</span></div><span class="sum" data-s></span><button class="icon-btn" type="button" data-rm>${icon('x')}</button></div>`;
  const res = await openModal({
    title: p ? `${p.name} — zagotovka` : base ? `${base.name} — zagotovkaga aylantirish` : 'Yangi zagotovka', size: 'xl',
    body: `<div class="grid2"><div class="field"><label>Nomi</label><input class="input" data-n value="${esc(p?.name || base?.name || '')}" placeholder="masalan: Kotlet, Burger sousi, Xamir" autofocus></div>
        <div class="field"><label>Guruh</label><input class="input" data-g list="pgrps" value="${esc(p?.grp || base?.grp || '')}" placeholder="Zagotovka"><datalist id="pgrps">${groups.map((g) => `<option value="${esc(g)}">`).join('')}</datalist></div></div>
      <div class="field"><label>Tayyor zagotovka qanday o'lchanadi?</label>${unitChips(unit)}</div>
      <div class="lbl" style="margin:6px 0 6px">Tarkibi — nimadan tayyorlanadi <span class="dim" style="font-weight:400">— bir partiya uchun. Miqdor elementning o'z o'lchovida: 1 (kg), «500 g», 2 (dona)</span></div>
      <div class="lines rec"><div class="ln h"><span>Element</span><span>Miqdor</span><span class="r">Narxi</span><span></span></div><div data-pls>${(p?.lines?.length ? p.lines : [{}, {}]).map(line).join('')}</div></div>
      <button class="btn sm" type="button" data-more>${icon('plus')}Element qo'shish</button>
      <div class="field" style="margin-top:14px;max-width:420px"><label>Shu tarkibdan qancha tayyor zagotovka chiqadi?</label><div class="unitbox"><input class="input" data-y inputmode="decimal" value="${p ? num(p.yield) : ''}" placeholder="masalan 10"><span data-yu>${UNIT[unit]}</span></div></div>
      <div class="foodcost"><div>Partiya tannarxi<b data-bc>0</b></div><div>1 <span data-cu>${UNIT[unit]}</span> tannarxi<b data-uc>—</b></div><div>Omborda tayyori<b>${qty(p?.stock ?? base?.stock ?? 0, unit)}</b></div></div>
      <p class="hint" data-warn style="margin-top:8px"></p>
      <details class="more" ${p?.min_stock ? 'open' : ''}><summary>Qo'shimcha: eng kam qoldiq</summary>
        <div class="field" style="margin-top:10px;max-width:420px"><label>Tayyor zagotovka shundan kam qolsa ogohlantirsin</label><div class="unitbox"><input class="input" data-m inputmode="decimal" value="${p?.min_stock ? num(p.min_stock) : ''}" placeholder="masalan 10"><span data-mu>${UNIT[unit]}</span></div></div></details>`,
    foot: `${p ? `<button class="btn danger" data-del>${icon('trash')}O'chirish</button><button class="btn ghost" data-unset>Oddiy element qilish</button><span class="grow"></span>` : ''}<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>${icon('check')}Saqlash</button>`,
    onOpen: (mm, close) => {
      const box = mm.querySelector('[data-pls]');
      const read = () => $$('[data-pl]', mm).map((ln) => {
        const id = Number(ln.querySelector('[data-pkq]').dataset.id) || 0; const i = raw.find((x) => x.id === id);
        const qi = ln.querySelector('[data-q]'); const qp = qtyParse(qi.value, i?.unit || 'kg');
        return { ln, id, i, qi, qp, name: ln.querySelector('[data-pkq]').value.trim() };
      });
      const calc = () => {
        let batch = 0; let missing = 0;
        for (const r of read()) {
          r.ln.querySelector('[data-u]').textContent = r.i ? UNIT[r.i.unit] : '';
          r.qi.classList.toggle('bad', !r.qp.ok);
          const s = r.i && r.qp.v > 0 ? Math.round(r.qp.v * r.i.cost) : 0;
          if (r.i && r.qp.v > 0 && !(r.i.cost > 0)) missing++;
          r.ln.querySelector('[data-s]').textContent = s ? sum(s) : r.i && r.qp.v > 0 ? 'narxi yo\'q' : '';
          batch += s;
        }
        const yp = qtyParse(mm.querySelector('[data-y]').value, unit);
        mm.querySelector('[data-y]').classList.toggle('bad', !yp.ok);
        mm.querySelector('[data-bc]').textContent = sum(batch);
        mm.querySelector('[data-uc]').textContent = yp.v > 0 && batch ? sum(Math.round(batch / yp.v)) : '—';
        mm.querySelector('[data-warn]').textContent = missing ? `${missing} ta elementning narxi yo'q (hali kirim qilinmagan) — tannarx chala hisoblanadi. Ombor → Kirim orqali narxini kiriting.` : '';
      };
      const bind = () => {
        bindPickers(mm, raw, calc, createIngredient);
        $$('[data-rm]', mm).forEach((b) => b.onclick = () => { b.closest('[data-pl]').remove(); if (!box.children.length) box.insertAdjacentHTML('beforeend', line()); bind(); calc(); });
      };
      const setUnit = (u) => { unit = u; $$('.uchip', mm).forEach((b) => b.classList.toggle('on', b.dataset.uv === u)); for (const k of ['[data-yu]', '[data-cu]', '[data-mu]']) mm.querySelector(k).textContent = UNIT[u]; calc(); };
      $$('.uchip', mm).forEach((b) => b.onclick = () => setUnit(b.dataset.uv));
      mm.querySelector('[data-more]').onclick = () => { box.insertAdjacentHTML('beforeend', line()); bind(); box.lastElementChild.querySelector('[data-pkq]').focus(); };
      mm.addEventListener('input', calc);
      bind(); calc();
      mm.querySelector('[data-ok]').onclick = async () => {
        const name = mm.querySelector('[data-n]').value.trim(); if (!name) { toast('Nomini yozing', 'bad'); mm.querySelector('[data-n]').focus(); return; }
        const rows = read().filter((r) => r.name || r.qi.value.trim());
        if (!rows.length) { toast('Tarkibini yozing — zagotovka nimadan tayyorlanadi', 'bad'); return; }
        for (const r of rows) {
          if (!r.i) { toast(`«${r.name || '…'}» — ro'yxatdan elementni tanlang`, 'bad'); r.ln.querySelector('[data-pkq]').focus(); return; }
          if (!r.qp.ok || !(r.qp.v > 0)) { toast(`${r.i.name} — miqdorini yozing (masalan 1 yoki «500 g»)`, 'bad'); r.qi.focus(); return; }
        }
        if (new Set(rows.map((r) => r.id)).size !== rows.length) { toast('Bir element ikki marta yozilgan', 'bad'); return; }
        const yi = mm.querySelector('[data-y]'); const yp = qtyParse(yi.value, unit);
        if (!yp.ok || !(yp.v > 0)) { toast('Shu tarkibdan qancha chiqishini yozing (masalan 10)', 'bad'); yi.focus(); return; }
        const mp = qtyParse(mm.querySelector('[data-m]').value, unit);
        if (!mp.ok) { toast('Eng kam qoldiq son bo\'lsin', 'bad'); mm.querySelector('[data-m]').focus(); return; }
        try {
          await P('/api/stock/prep', { id: self || undefined, name, unit, grp: mm.querySelector('[data-g]').value, min_stock: mp.v, yield: yp.v, lines: rows.map((r) => ({ ingredient_id: r.id, qty: r.qp.v })) });
          toast('Zagotovka saqlandi', 'ok'); close(true);
        } catch (e) { fail(e); }
      };
      mm.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmBox(`${p.name} o'chirilsinmi? Taomlar texkartasidan ham olib tashlanadi.`, { danger: true, ok: 'O\'chirish' }))) return;
        try { await P('/api/stock/ingredient/remove', { id: p.id }); toast('O\'chirildi', 'ok'); close(true); } catch (e) { fail(e); }
      });
      mm.querySelector('[data-unset]')?.addEventListener('click', async () => {
        if (!(await confirmBox(`${p.name} oddiy element bo'lsinmi? Tarkibi o'chadi — sotuvda faqat o'zining qoldig'idan ayiriladi. Qoldig'i va texkartalardagi o'rni saqlanadi.`, { ok: 'Ha' }))) return;
        try { await P('/api/stock/prep/unset', { id: p.id }); toast('Oddiy element bo\'ldi', 'ok'); close(true); } catch (e) { fail(e); }
      });
    },
  });
  if (res) show(A.page === 'stock' ? 'stock' : 'preps');
}

/** Tayyorlash: N birlik zagotovka tayyorlandi — elementlar ombordan chiqadi, zagotovka kiradi. */
async function produceForm(preps, pre = null) {
  const ok_ = preps.filter((p) => p.lines.length);
  if (!ok_.length) { toast('Avval zagotovkaning tarkibini yozing', 'bad'); return; }
  let cur = pre?.lines.length ? pre : ok_.length === 1 ? ok_[0] : null;
  const res = await openModal({
    title: 'Tayyorlash — zagotovka tayyorlandi', size: 'wide',
    body: `<div class="grid2"><div class="field"><label>Qaysi zagotovka</label><select class="input" data-p><option value="">— tanlang —</option>${ok_.map((p) => `<option value="${p.id}" ${cur?.id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Qancha tayyorlandi</label><div class="unitbox"><input class="input" data-q inputmode="decimal" placeholder="masalan 50" autofocus><span data-u>${cur ? UNIT[cur.unit] : ''}</span></div></div></div>
      <div class="field"><label>Izoh</label><input class="input" data-note placeholder="ixtiyoriy: ertalabki partiya…"></div>
      <div data-need></div>`,
    foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>${icon('check')}Saqlash</button>`,
    onOpen: (mm, close) => {
      const qi = mm.querySelector('[data-q]');
      const draw = () => {
        cur = ok_.find((p) => p.id === Number(mm.querySelector('[data-p]').value)) || null;
        mm.querySelector('[data-u]').textContent = cur ? UNIT[cur.unit] : '';
        const qp = qtyParse(qi.value, cur?.unit || 'dona'); qi.classList.toggle('bad', !qp.ok);
        const box = mm.querySelector('[data-need]');
        if (!cur) { box.innerHTML = ''; return { q: 0, short: [] }; }
        const k = qp.v / cur.yield; const short = [];
        const rows = cur.lines.map((l) => { const need = Math.round(l.qty * k * 1000) / 1000; const lack = need > l.stock + 1e-9; if (lack && need > 0) short.push(l.name); return { ...l, need, lack }; });
        const cost = rows.reduce((s, l) => s + l.need * l.cost, 0);
        box.innerHTML = `<div class="lbl" style="margin:8px 0 6px">Ombordan chiqadi <span class="dim" style="font-weight:400">— ${qty(cur.yield, cur.unit)} uchun yozilgan tarkib bo'yicha</span></div>
          <table class="tbl"><thead><tr><th>Element</th><th class="r">Kerak</th><th class="r">Omborda bor</th><th class="r">Summa</th></tr></thead><tbody>
          ${rows.map((l) => `<tr><td>${esc(l.name)}</td><td class="r"><b>${qp.v > 0 ? qty(l.need, l.unit) : '—'}</b></td><td class="r ${l.lack && qp.v > 0 ? 'neg' : 'dim'}">${qty(l.stock, l.unit)}${l.lack && qp.v > 0 ? ' — yetmaydi' : ''}</td><td class="r">${qp.v > 0 ? sum(Math.round(l.need * l.cost)) : ''}</td></tr>`).join('')}
          <tr class="total"><td colspan="3">Partiya tannarxi${qp.v > 0 && cost ? ` · 1 ${UNIT[cur.unit]} = ${sum(Math.round(cost / qp.v))}` : ''}</td><td class="r">${qp.v > 0 ? sum(Math.round(cost)) : ''}</td></tr></tbody></table>
          <p class="hint" style="margin-top:8px">Hozir omborda tayyori: <b>${qty(cur.stock, cur.unit)}</b>${qp.v > 0 ? ` → saqlangach <b>${qty(cur.stock + qp.v, cur.unit)}</b>` : ''}</p>`;
        return { q: qp.ok ? qp.v : 0, short };
      };
      mm.querySelector('[data-p]').onchange = draw; qi.oninput = draw; draw();
      mm.querySelector('[data-ok]').onclick = async () => {
        const { q, short } = draw();
        if (!cur) { toast('Zagotovkani tanlang', 'bad'); return; }
        if (!(q > 0)) { toast('Qancha tayyorlanganini yozing', 'bad'); qi.focus(); return; }
        if (short.length && !(await confirmBox(`Omborda yetmaydi: ${short.join(', ')}. Baribir yozilsinmi? Bu elementlar qoldig'i manfiyga tushadi (kirim kiritilmagan bo'lishi mumkin).`, { ok: 'Ha, yozilsin' }))) return;
        try {
          await P('/api/stock/doc', { kind: 'tayyorlash', note: mm.querySelector('[data-note]').value, lines: [{ ingredient_id: cur.id, qty: q }] });
          toast(`${cur.name}: ${qty(q, cur.unit)} tayyorlandi — elementlar ombordan chiqdi`, 'ok'); close(true);
        } catch (e) { fail(e); }
      };
    },
  });
  if (res) show('preps');
}

// ---- Menyu ----
PAGES.menu = async (m) => {
  const d = await S('/api/admin/menu');
  const costs = (await S('/api/stock/recipe-costs')).costs;
  const q = (A.menuQ || '').toLowerCase();
  const st = Object.fromEntries(d.stations.map((s) => [s.id, s.name]));
  const noRecipe = d.products.filter((p) => !costs[p.id]?.cost).length;
  m.innerHTML = head('Menyu — taomlar va tovarlar', 'Taom — texnologik karta bo\'yicha elementlardan tayyorlanadi. Tayyor tovar (Cola, suv, tayyor kotlet) — donalab, omborda o\'zi hisoblanadi.',
    `<button class="btn" id="addg">${icon('plus')}Tayyor tovar</button><button class="btn primary" id="add">${icon('plus')}Taom</button>`)
    + `${noRecipe ? `<div class="card" style="border-color:#f0cf86;background:#fffbf1;padding:12px 16px;margin-bottom:14px">${icon('alert')} <b>${noRecipe} ta taomning tannarxi noma'lum</b> — foyda hisobida 0 deb olinadi. Taomni ochib <b>Tannarx</b>ni yozing (tayyor mahsulot) yoki <b>Texnologik karta</b>ni to'ldirib, elementlarni kirim qiling.</div>` : ''}
    <div class="card"><div class="card-h"><input class="input" id="q" placeholder="Qidirish" value="${esc(A.menuQ || '')}" style="max-width:320px"></div><div class="tbl-wrap"><table class="tbl">
    <thead><tr><th>Taom</th><th>Sex</th><th class="r">Narxi</th><th class="r">Tannarx</th><th class="r">Tannarx %</th><th class="r">Foyda</th><th>Texkarta</th><th class="c">Sotuvda</th></tr></thead><tbody>
    ${d.categories.map((c) => { const list = d.products.filter((p) => p.category_id === c.id && (!q || p.name.toLowerCase().includes(q))); if (!list.length) return '';
      return `<tr class="grp"><td colspan="8"><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${esc(c.color || '#999')};margin-right:8px"></span>${esc(c.name)}</td></tr>`
      + list.map((p) => { const cs = costs[p.id]?.cost ? costs[p.id] : null; const fc = cs ? pct(cs.cost, p.price) : null;
        return `<tr class="click" data-p="${p.id}"><td><span style="display:inline-block;width:34px;height:34px;border-radius:8px;vertical-align:middle;margin-right:10px;background:${p.image ? `url('${esc(p.image)}') center/cover` : 'var(--line-2)'}"></span><b>${esc(p.name)}</b>${p.unit === 'kg' ? ' <span class="badge">1 kg</span>' : ''}${p.goods_id ? ' <span class="badge">tovar</span>' : ''}</td><td class="dim">${esc(st[p.station_id || c.station_id] || '—')}</td>
          <td class="r"><b>${sum(p.price)}</b></td><td class="r">${cs ? `${sum(cs.cost)}${cs.src === 'qolda' ? '<div class="dim" style="font-size:12px">qo\'lda</div>' : ''}` : '<span class="badge warn">noma\'lum</span>'}</td>
          <td class="r">${fc == null ? '' : `<span class="badge ${fc > 40 ? 'bad' : fc > 30 ? 'warn' : 'ok'}">${fc}%</span>`}</td><td class="r">${cs ? sum(p.price - cs.cost) : ''}</td>
          <td>${p.goods_id ? `<span class="${(p.goods_stock || 0) <= 0 ? 'neg' : 'dim'}">omborda ${qty(p.goods_stock || 0, p.unit)}</span>` : costs[p.id]?.lines ? `<span class="dim">${costs[p.id].lines} ta element</span>` : '<span class="dim">—</span>'}</td>
          <td class="c"><label class="sw" data-stop="${p.id}"><input type="checkbox" ${p.stop ? '' : 'checked'}></label></td></tr>`; }).join(''); }).join('')}
    </tbody></table></div></div>`;
  $('#q').oninput = (e) => { A.menuQ = e.target.value; clearTimeout(A.qt); A.qt = setTimeout(() => show('menu').then(() => { const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 250); };
  $('#add').onclick = () => productForm(null, d);
  $('#addg').onclick = () => productForm(null, d, { goods: true });
  $$('[data-p]', m).forEach((r) => r.onclick = (e) => { if (e.target.closest('[data-stop]')) return; productForm(d.products.find((p) => p.id === Number(r.dataset.p)), d); });
  $$('[data-stop] input', m).forEach((c) => c.onchange = async () => { try { await post('/api/stop', { id: Number(c.closest('[data-stop]').dataset.stop), stop: !c.checked }); toast(c.checked ? 'Sotuvga qaytdi' : 'Stop-listga qo\'yildi', 'ok'); } catch (e) { fail(e); } });
};

async function productForm(p, d, opts = {}) {
  const ings = (await S('/api/stock/ingredients')).ingredients;
  // Tayyor tovar (Cola, suv, tayyor kotlet): omborda o'zi hisoblanadi — texkarta o'rniga «nechta bor, necha pulga olingan».
  const goods0 = p ? !!p.goods_id : !!opts.goods;
  const gIng = p?.goods_id ? ings.find((i) => i.id === p.goods_id) : null;
  const ilist = ings.map((i) => ({ id: i.id, name: i.name, unit: i.unit, cost: i.cost, hint: i.prep ? `zagotovka · ${UNIT[i.unit]}` : UNIT[i.unit] }));
  const rec = p ? await S('/api/stock/recipe?product_id=' + p.id) : { lines: [] };
  let createdId = null; // texkarta saqlanmay qolsa, qayta "Saqlash" ikkinchi taom yaratmasin
  const toInput = (l) => { const u = ilist.find((x) => x.id === l.ingredient_id)?.unit; return u === 'dona' ? String(l.qty).replace('.', ',') : String(Math.round(l.qty * 1000 * 10) / 10).replace('.', ','); };
  const small = (u) => (u === 'kg' ? 'g' : u === 'l' ? 'ml' : 'dona');
  const recLine = (l = {}) => `<div class="ln" data-rl>${picker(ilist, l.ingredient_id)}<div class="unitbox"><input class="input" data-q inputmode="decimal" value="${l.qty ? toInput(l) : ''}" placeholder="0"><span data-u>${l.ingredient_id ? small(ilist.find((x) => x.id === l.ingredient_id)?.unit) : ''}</span></div><span class="sum" data-s></span><button class="icon-btn" type="button" data-rm>${icon('x')}</button><div class="newing" data-nw hidden></div></div>`;
  // Texkartada miqdor: kg/litr element — gramm/ml da, dona — donada. Odam "10 gr", "30g", "0,03 kg", "1 dona" deb ham yozadi.
  const recQty = (raw, unit) => {
    const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(',', '.');
    if (!s) return { v: 0, ok: true };
    const m = /^(\d+(?:\.\d+)?|\.\d+)(kg|кг|kilo|gramm|gr|g|гр|г|litr|l|л|ml|мл|dona|ta|шт|x)?$/.exec(s);
    if (!m) return { v: 0, ok: false };
    let v = Number(m[1]);
    if (unit !== 'dona' && /^(kg|кг|kilo|litr|l|л)$/.test(m[2] || '')) v *= 1000;   // "0,03 kg" → 30 g
    return { v, ok: true };
  };
  await openModal({
    title: p ? p.name : goods0 ? 'Yangi tayyor tovar' : 'Yangi taom', size: 'xl',
    body: `<div class="tabs"><button class="on" data-t="main" type="button">Asosiy</button><button data-t="rec" type="button">Texnologik karta</button></div>
      <div data-tab="main"><div class="row" style="align-items:flex-start;gap:16px;margin-bottom:14px">
        <div data-imgbox style="width:132px;height:132px;border-radius:12px;border:1px dashed var(--line);background:var(--card-2) center/cover no-repeat;flex:none;display:flex;align-items:center;justify-content:center;color:var(--faint)">${icon('box')}</div>
        <div><div class="lbl" style="margin-bottom:6px">Rasm (kassa menyusida ko'rinadi)</div>
          <label class="btn sm" style="cursor:pointer">${icon('plus')}Rasm tanlash<input type="file" accept="image/*" data-file hidden></label>
          <button class="btn sm ghost" type="button" data-imgdel>${icon('trash')}Olib tashlash</button>
          <p class="hint" style="margin-top:6px">Kvadrat rasm yaxshi. O'zi 420 px gacha kichraytiriladi.</p></div></div>
        <div class="grid2"><div class="field"><label>Nomi</label><input class="input" data-n value="${esc(p?.name || '')}" autofocus></div>
        <div class="field"><label>Toifa</label><select class="input" data-c>${d.categories.map((c) => `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div></div>
        <label class="gcheck"><input type="checkbox" data-goods ${goods0 ? 'checked' : ''}><span><b>Tayyor tovar — donalab sotiladi</b><small>Cola, suv, non, tayyor kotlet… Omborda o'zi hisoblanadi: sotilganda ombordan ayiriladi, texnologik karta yozish shart emas.</small></span></label>
        <div class="startbox" data-gbox hidden><div class="lbl" style="margin-bottom:8px" data-gst></div>
          <div class="grid2"><div class="field"><label data-gql></label><div class="unitbox"><input class="input" data-gq inputmode="decimal" placeholder="masalan 24"><span data-gu>dona</span></div></div>
          <div class="field"><label>Jami necha pulga olingan (so'm)</label><input class="input money" data-gp inputmode="numeric" placeholder="masalan 132 000"></div></div>
          <p class="hint" data-gh></p></div>
        <div class="grid3"><div class="field"><label>Narxi (so'm)</label><input class="input money" data-pr inputmode="numeric" value="${p ? sum(p.price) : ''}"></div>
        <div class="field"><label>Sotish birligi</label><select class="input" data-u><option value="dona">Porsiya / dona</option><option value="kg" ${p?.unit === 'kg' ? 'selected' : ''}>Kilogramm (tarozida)</option></select></div>
        <div class="field"><label>Sex (oshxona cheki qayerga)</label><select class="input" data-st><option value="">Toifaniki</option>${d.stations.map((s) => `<option value="${s.id}" ${p?.station_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div></div>
        <div class="field" data-costfield><label>Tannarx — 1 dona necha pulga tushadi (so'm)</label><input class="input money" data-cost inputmode="numeric" value="${p?.cost ? sum(p.cost) : ''}" placeholder="masalan Cola uchun 8 000">
          <p class="hint" data-costhint style="margin-top:4px"></p></div>
        <div class="grid3"><div class="field"><label>Shtrix-kod</label><input class="input" data-b value="${esc(p?.barcode || '')}"></div><div class="field"><label>IKPU (soliq kodi)</label><input class="input" data-ik value="${esc(p?.ikpu || '')}" placeholder="keyin kerak bo'ladi"></div>
        <div class="field"><label>Tartib</label><input class="input" data-so inputmode="numeric" value="${p?.sort ?? 0}"></div></div></div>
      <div data-tab="rec" hidden><p class="hint" style="margin-bottom:12px">1 ${p?.unit === 'kg' ? 'kg' : 'porsiya'} uchun. Go'sht, sabzavot — <b>grammda</b>, suyuqlik — <b>ml</b>da, bulochka, tuxum — <b>dona</b>da yozing. Masalan: Burger — mol go'shti 170 g, pomidor 60 g, bodring 30 g, ketchup 10 g, mayonez 10 g, bulochka 1 dona.</p>
        <p class="hint" style="margin:-4px 0 12px">Ro'yxatda yo'q elementni shu yerning o'zida qo'shsa bo'ladi — nomini yozing, ostida chiqqan <b>gramm / ml / dona</b> dan o'lchovini tanlang. Miqdorga faqat son yoziladi (10 yoki «10 gr»).</p>
        <div class="lines rec"><div class="ln h"><span>Element</span><span>Miqdor</span><span class="r">Tannarx</span><span></span></div><div data-rls>${(rec.lines.length ? rec.lines : [{}]).map(recLine).join('')}</div></div>
        <button class="btn sm" type="button" data-more>${icon('plus')}Element qo'shish</button>
        <div class="card" data-np hidden style="padding:10px 14px;margin-top:12px;background:#fffbf1;border-color:#f0cf86;font-size:13.5px"></div>
        <div class="foodcost"><div>Tannarx<b data-fc>0</b></div><div>Sotuv narxi<b data-fp>0</b></div><div>Tannarx ulushi<b data-fpct>—</b></div><div>Foyda (1 porsiya)<b data-fm>—</b></div></div></div>`,
    foot: `${p ? `<button class="btn danger" data-del>${icon('trash')}O'chirish</button><span class="grow"></span>` : ''}<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
    onOpen: (mm, close) => {
      $$('.tabs button', mm).forEach((b) => b.onclick = () => { $$('.tabs button', mm).forEach((x) => x.classList.toggle('on', x === b)); $$('[data-tab]', mm).forEach((t) => { t.hidden = t.dataset.tab !== b.dataset.t; }); });
      moneyInput(mm.querySelector('[data-pr]')); moneyInput(mm.querySelector('[data-cost]'));
      let image; // undefined — o'zgarmaydi, '' — olib tashlanadi, data:image — yangi
      const box = mm.querySelector('[data-imgbox]');
      const showImg = (src) => { box.style.backgroundImage = src ? `url("${src}")` : ''; box.innerHTML = src ? '' : icon('box'); };
      showImg(p?.image);
      mm.querySelector('[data-file]').onchange = async (e) => {
        const f = e.target.files[0]; if (!f) return;
        try { image = await shrinkImage(f); showImg(image); } catch { toast('Rasmni o\'qib bo\'lmadi', 'bad'); }
      };
      mm.querySelector('[data-imgdel]').onclick = () => { image = ''; showImg(null); };
      const calc = () => {
        let cost = 0; let noPrice = 0;
        $$('[data-rl]', mm).forEach((ln) => {
          const inp = ln.querySelector('[data-pkq]'); const raw = inp.value.trim();
          let id = Number(inp.dataset.id);
          // Nomi ro'yxatdagi bilan aynan bir xil yozilgan bo'lsa (bosmasdan) — o'sha element.
          if (!id && raw) { const ex = ilist.find((x) => x.name.toLowerCase() === raw.toLowerCase()); if (ex) { inp.dataset.id = ex.id; id = ex.id; } }
          const i = ilist.find((x) => x.id === id);
          // Ro'yxatda yo'q nom: qatorning ostida o'lchov so'raladi (yozib bo'lingach — nom maydonidan chiqilganda).
          const nw = ln.querySelector('[data-nw]'); const need = !i && raw.length >= 2 && document.activeElement !== inp;
          ln.classList.toggle('isnew', need);
          if (need && nw.dataset.for !== raw) {
            nw.dataset.for = raw;
            // Hech biri oldindan belgilanmaydi: belgilangan ko'rinsa "tanlandi" deb o'ylanadi, aslida hali bosilmagan bo'ladi.
            nw.innerHTML = `<span>«${esc(raw)}» ro'yxatda yo'q — <b>yangi element</b>. Qanday o'lchanadi? Bittasini bosing:</span>
              <span class="nw-b">${[['kg', 'gramm (kg)'], ['l', 'ml (litr)'], ['dona', 'dona']].map(([k, t]) => `<button type="button" data-nwu="${k}">${t}</button>`).join('')}</span>`;
          }
          if (!need) nw.dataset.for = '';
          nw.hidden = !need;
          ln.querySelector('[data-u]').textContent = i ? small(i.unit) : '';
          const qI = ln.querySelector('[data-q]'); const qp = recQty(qI.value, i?.unit || 'kg'); qI.classList.toggle('bad', !qp.ok);
          const v = qp.v; const base = i ? (i.unit === 'dona' ? v : v / 1000) : 0;
          const c = i ? base * i.cost : 0; cost += c;
          ln.querySelector('[data-s]').innerHTML = i && v ? (i.cost ? sum(c) : '<span class="badge warn" title="Bu element hali kirim qilinmagan">narxi yo\'q</span>') : '';
          if (i && v && !i.cost) noPrice++;
        });
        const np = mm.querySelector('[data-np]');
        if (np) { np.hidden = !noPrice; np.innerHTML = `${icon('alert')} <b>${noPrice} ta elementning narxi yo'q</b> — ular hali kirim qilinmagan. Narx <b>Ombor → Kirim</b> qilinganda o'zi qo'yiladi. Shoshilinch bo'lsa «Asosiy» bo'limida tannarxni qo'lda yozing.`; }
        const price = moneyVal(mm.querySelector('[data-pr]'));
        mm.querySelector('[data-fc]').textContent = sum(cost); mm.querySelector('[data-fp]').textContent = sum(price);
        const manual = moneyVal(mm.querySelector('[data-cost]'));
        const use = cost > 0 ? cost : manual;
        mm.querySelector('[data-costhint]').innerHTML = cost > 0
          ? `Texkartadan hisoblandi: <b>${sum(cost)}</b> so'm — foyda hisobida shu ishlatiladi${price ? ` (foyda ${sum(price - cost)})` : ''}.`
          : `Texkarta bo'lmasa yoki element narxi kiritilmagan bo'lsa — shu raqam ishlatiladi${price && manual ? `. Foyda: <b>${sum(price - manual)}</b> so'm` : ''}.`;
        mm.querySelector('[data-fc]').textContent = sum(use);
        mm.querySelector('[data-fpct]').textContent = price ? pct(use, price) + '%' : '—'; mm.querySelector('[data-fm]').textContent = price ? sum(price - use) : '—';
      };
      const bind = () => bindPickers(mm, ilist, (pk) => { calc(); pk.closest('[data-rl]')?.querySelector('[data-q]')?.focus(); }, createIngredient);
      bind(); calc();
      mm.addEventListener('input', calc);
      const gC = mm.querySelector('[data-goods]'); const gQ = mm.querySelector('[data-gq]'); const gP = mm.querySelector('[data-gp]');
      const gUnit = () => (mm.querySelector('[data-u]').value === 'kg' ? 'kg' : 'dona');
      const gcalc = () => {
        const on = gC.checked; const u = gUnit();
        mm.querySelector('[data-gbox]').hidden = !on;
        mm.querySelector('.tabs [data-t="rec"]').hidden = on;
        mm.querySelector('[data-costfield]').hidden = on;
        if (!on) return;
        mm.querySelector('[data-gu]').textContent = UNIT[u];
        mm.querySelector('[data-gst]').innerHTML = gIng
          ? `Omborda hozir: <b class="${gIng.stock <= 0 ? 'neg' : ''}">${qty(gIng.stock, gIng.unit)}</b>${gIng.cost ? ` <span class="dim" style="font-weight:400">· 1 ${UNIT[gIng.unit]} tannarxi ${sum(Math.round(gIng.cost))} so'm</span>` : ' <span class="dim" style="font-weight:400">· narxi hali yo\'q</span>'}`
          : 'Hozir omborda bormi? <span class="dim" style="font-weight:400">— bo\'lsa yozing, kirim o\'zi yoziladi</span>';
        mm.querySelector('[data-gql]').textContent = gIng ? 'Yana keldi (ixtiyoriy)' : 'Nechta bor';
        const qp = qtyParse(gQ.value, u); const tp = moneyVal(gP); gQ.classList.toggle('bad', !qp.ok);
        const price = moneyVal(mm.querySelector('[data-pr]'));
        const unitCost = qp.v > 0 && tp > 0 ? Math.round(tp / qp.v) : Math.round(gIng?.cost || 0);
        mm.querySelector('[data-gh]').textContent = unitCost ? `1 ${UNIT[u]} tannarxi ${sum(unitCost)} so'm${price ? ` · sotuv narxi ${sum(price)} · foyda ${sum(price - unitCost)}` : ''}` : 'Necha pulga olinganini yozsangiz tannarx va foyda o\'zi hisoblanadi.';
      };
      moneyInput(gP); gC.onchange = gcalc; mm.addEventListener('input', gcalc); mm.addEventListener('change', gcalc); gcalc();
      // Nom maydonidan chiqilganda (ro'yxatdan tanlash 150 ms ichida tugaydi) — yangi nom bo'lsa o'lchov so'raladi.
      mm.addEventListener('focusout', (e) => { if (e.target.matches?.('[data-pkq]')) setTimeout(calc, 200); });
      mm.addEventListener('focusin', (e) => { if (e.target.matches?.('[data-pkq]')) calc(); });
      mm.addEventListener('click', async (e) => {
        const b = e.target.closest('[data-nwu]'); if (!b || b.disabled) return;
        const ln = b.closest('[data-rl]'); const inp = ln.querySelector('[data-pkq]'); const raw = inp.value.trim(); if (!raw) return;
        $$('[data-nwu]', ln).forEach((x) => { x.disabled = true; });
        try {
          const x = await createIngredient(raw, b.dataset.nwu); ilist.push(x); inp.value = x.name; inp.dataset.id = x.id;
          toast(`${x.name} elementlarga qo'shildi (${UNIT[x.unit]})`, 'ok'); calc(); ln.querySelector('[data-q]').focus();
        } catch (er) { $$('[data-nwu]', ln).forEach((x) => { x.disabled = false; }); fail(er); }
      });
      mm.querySelector('[data-more]').onclick = () => { mm.querySelector('[data-rls]').insertAdjacentHTML('beforeend', recLine()); bind(); };
      mm.addEventListener('click', (e) => { const rm = e.target.closest('[data-rm]'); if (rm) { if ($$('[data-rl]', mm).length > 1) rm.closest('[data-rl]').remove(); else { rm.closest('[data-rl]').querySelector('[data-pkq]').value = ''; rm.closest('[data-rl]').querySelector('[data-pkq]').dataset.id = ''; rm.closest('[data-rl]').querySelector('[data-q]').value = ''; } calc(); } });
      mm.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!(await confirmBox(`${p.name} menyudan olib tashlansinmi?`, { danger: true, ok: 'O\'chirish' }))) return;
        try { await P('/api/admin/remove', { kind: 'product', id: p.id }); toast('O\'chirildi', 'ok'); close(); show('menu'); } catch (e) { fail(e); }
      });
      mm.querySelector('[data-ok]').onclick = async () => {
        const body = { id: p?.id || createdId, name: mm.querySelector('[data-n]').value, category_id: Number(mm.querySelector('[data-c]').value), price: moneyVal(mm.querySelector('[data-pr]')),
          unit: mm.querySelector('[data-u]').value, station_id: Number(mm.querySelector('[data-st]').value) || null, barcode: mm.querySelector('[data-b]').value,
          ikpu: mm.querySelector('[data-ik]').value, sort: Number(mm.querySelector('[data-so]').value) || 0, stop: p?.stop || false, image,
          cost: moneyVal(mm.querySelector('[data-cost]')), goods: gC.checked };
        const goods = gC.checked; const gq = qtyParse(gQ.value, gUnit()); const gp = moneyVal(gP);
        if (goods) {
          if (!gq.ok) { toast('Miqdor son bo\'lsin: masalan 24', 'bad'); gQ.focus(); return; }
          if (gq.v > 0 && !(gp > 0)) { toast('Necha pulga olinganini yozing — tannarx shundan hisoblanadi', 'bad'); gP.focus(); return; }
          if (p && !p.goods_id && rec.lines.length && !(await confirmBox(`${p.name} tayyor tovar bo'lsinmi? Hozirgi texnologik kartasi (${rec.lines.length} ta element) o'chadi — omborda shu nomli bitta tovar bo'lib hisoblanadi.`, { ok: 'Ha' }))) return;
        }
        const lines = [];
        for (const ln of goods ? [] : $$('[data-rl]', mm)) {
          const inp = ln.querySelector('[data-pkq]'); const qI = ln.querySelector('[data-q]'); const raw = inp.value.trim();
          const id = Number(inp.dataset.id); const i = ilist.find((x) => x.id === id);
          const qp = recQty(qI.value, i?.unit || 'kg'); const v = qp.v;
          if (!raw && !qI.value.trim()) continue;
          const tab = () => mm.querySelector('.tabs [data-t="rec"]')?.click();
          if (!i) { tab(); calc(); toast(raw ? `«${raw}» — yangi element: qator ostidan o'lchovini tanlang (gramm, ml yoki dona)` : 'Texkartada element tanlanmagan qator bor', 'bad'); ln.scrollIntoView({ block: 'center' }); return; }
          if (!qp.ok || !(v > 0)) { tab(); toast(`«${i.name}» miqdori ${qp.ok ? 'yozilmagan' : 'noto\'g\'ri — faqat son yozing, masalan 10'}`, 'bad'); qI.focus(); return; }
          lines.push({ ingredient_id: id, qty: i.unit === 'dona' ? v : v / 1000 });
        }
        try {
          const r = await P('/api/admin/product', body);
          createdId = r.id; image = undefined;
          if (!goods) await P('/api/stock/recipe', { product_id: r.id, lines });
          else if (gq.v > 0) { await P('/api/stock/doc', { kind: 'kirim', note: 'Menyudan kirim', lines: [{ ingredient_id: r.goods_id, qty: gq.v, price: gp / gq.v }] }); gQ.value = ''; gP.value = ''; }
          toast(goods && gq.v > 0 ? `Saqlandi — omborga ${qty(gq.v, gUnit())} kirim qilindi` : 'Saqlandi', 'ok'); close(); show('menu');
        } catch (e) { fail(e); }
      };
    },
  });
}

/** Rasmni kvadratga qirqib 420 px gacha kichraytiradi (JPEG). */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.width, img.height); const size = Math.min(420, side);
      const cv = document.createElement('canvas'); cv.width = size; cv.height = size;
      cv.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      let q = 0.84; let out = cv.toDataURL('image/jpeg', q);
      while (out.length > 150000 && q > 0.4) { q -= 0.1; out = cv.toDataURL('image/jpeg', q); }
      URL.revokeObjectURL(img.src); resolve(out);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

PAGES.mods = async (m) => {
  const d = await S('/api/admin/mods');
  const menu = await S('/api/admin/menu');
  const ings = (await S('/api/stock/ingredients')).ingredients.map((i) => ({ id: i.id, name: i.name, unit: i.unit, hint: UNIT[i.unit] }));
  const pname = Object.fromEntries(menu.products.map((x) => [x.id, x.name]));
  m.innerHTML = head('Qo\'shimchalar', 'Taom bosilganda kassada chiqadigan tanlov: pishloq +5 000, qo\'shimcha kotlet, sous tanlash, piyozsiz. Element ko\'rsatilsa — sotilganda ombordan o\'zi yechiladi.',
    `<button class="btn primary" id="addG">${icon('plus')}Guruh</button>`)
    + (d.groups.length ? `<div class="card"><table class="tbl"><thead><tr><th>Guruh</th><th>Qo'shimchalar</th><th>Qaysi taomlarda</th><th>Tanlov</th></tr></thead><tbody>
      ${d.groups.map((g) => `<tr class="click" data-g="${g.id}"><td><b>${esc(g.name)}</b></td>
        <td>${g.mods.map((x) => `${esc(x.name)}${x.price ? ` <span class="dim">+${sum(x.price)}</span>` : ' <span class="dim">bepul</span>'}`).join(', ')}</td>
        <td>${g.product_ids.length ? `${g.product_ids.length} ta: <span class="dim">${esc(g.product_ids.slice(0, 3).map((id) => pname[id]).filter(Boolean).join(', '))}${g.product_ids.length > 3 ? '…' : ''}</span>` : '<span class="badge bad">taom tanlanmagan</span>'}</td>
        <td>${g.required ? '<span class="badge">majburiy</span> ' : ''}${g.multi ? 'bir nechta' : 'bittasi'}</td></tr>`).join('')}</tbody></table></div>`
    : `<div class="card"><div class="empty" style="padding:34px 20px">${icon('plus')}<div style="font-size:17px;font-weight:600;margin-top:6px">Hali qo'shimcha yo'q</div>
        <p class="hint" style="max-width:520px;margin:8px auto 14px">Masalan: «Qo'shimchalar» guruhi — Pishloq +5 000, Kotlet +15 000, Piyozsiz (bepul) — burgerlarga.
        «Sous» guruhi — Sirniy, Chesnochniy, Ketchup (majburiy, bittasi) — setlarga.</p><button class="btn primary" id="addG2">${icon('plus')}Birinchi guruhni qo'shish</button></div></div>`);
  const form = async (g) => {
    const row = (x = {}) => `<div class="ln" data-mid="${x.id || ''}"><input class="input" data-mn placeholder="Pishloq" value="${esc(x.name || '')}">
      <div class="unitbox"><input class="input" data-mp inputmode="numeric" placeholder="0" value="${x.price ? sum(x.price) : ''}"><span>so'm</span></div>
      ${picker(ings, x.ingredient_id, 'Element (ixtiyoriy)')}
      <div class="unitbox"><input class="input" data-mq inputmode="decimal" placeholder="—" value="${x.ingredient_qty ? String(x.ingredient_qty).replace('.', ',') : ''}"><span data-mu>${esc(UNIT[ings.find((i) => i.id === x.ingredient_id)?.unit] || '')}</span></div>
      <button class="icon-btn" data-drop aria-label="Ro'yxatdan chiqarish">${icon('x')}</button></div>`;
    const sel = new Set(g?.product_ids || []);
    const r = await openModal({
      title: g ? 'Qo\'shimcha guruhi' : 'Yangi qo\'shimcha guruhi', size: 'wide',
      body: `<div class="grid2"><div class="field"><label>Guruh nomi</label><input class="input" data-gn value="${esc(g?.name || '')}" placeholder="Qo'shimchalar, Sous, Non turi…" autofocus></div>
          <div class="field"><label>Tanlov</label><div class="row" style="gap:16px;flex-wrap:wrap;margin-top:8px">
            <label class="chk"><input type="checkbox" data-req ${g?.required ? 'checked' : ''}> Majburiy (kassir tanlamasdan qo'sha olmaydi)</label>
            <label class="chk"><input type="checkbox" data-multi ${g ? (g.multi ? 'checked' : '') : 'checked'}> Bir nechtasini tanlash mumkin</label></div></div></div>
        <h3 style="font-size:15px;margin:6px 0 8px">Qo'shimchalar</h3>
        <div class="lines mods"><div class="ln h"><span>Nomi</span><span>Narxiga qo'shiladi</span><span>Ombordan yechiladi</span><span>Miqdori (1 taomga)</span><span></span></div>
          <div data-rows>${(g?.mods?.length ? g.mods : [{}, {}]).map(row).join('')}</div></div>
        <button class="btn sm" data-addm>${icon('plus')}Qo'shimcha</button>
        <h3 style="font-size:15px;margin:18px 0 8px">Qaysi taomlarda chiqadi</h3>
        <div class="pchk">${menu.categories.map((c) => { const ps = menu.products.filter((x) => x.category_id === c.id); if (!ps.length) return '';
          return `<div class="pc"><label class="chk b"><input type="checkbox" data-allc="${c.id}"> ${esc(c.name)}</label>
            <div class="pl">${ps.map((x) => `<label class="chk"><input type="checkbox" data-pid="${x.id}" data-cat="${c.id}" ${sel.has(x.id) ? 'checked' : ''}> ${esc(x.name)}</label>`).join('')}</div></div>`; }).join('')}</div>`,
      foot: `${g ? `<button class="btn danger" data-del>O'chirish</button><span class="grow"></span>` : ''}<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
      onOpen: (mm, close) => {
        const rows = mm.querySelector('[data-rows]');
        const bind = () => {
          bindPickers(rows, ings, (pk, x) => { pk.closest('.ln').querySelector('[data-mu]').textContent = UNIT[x.unit] || ''; }, async (name, unit) => { const x = await createIngredient(name, unit); x.hint = UNIT[unit]; return x; });
          $$('[data-drop]', rows).forEach((b) => b.onclick = () => { b.closest('.ln').outerHTML = ''; });
          $$('[data-mp]', rows).forEach((i) => { if (!i.dataset.mb) { i.dataset.mb = 1; moneyInput(i); } });
        };
        bind();
        mm.querySelector('[data-addm]').onclick = () => { rows.insertAdjacentHTML('beforeend', row()); bind(); rows.lastElementChild.querySelector('[data-mn]').focus(); };
        const syncAll = () => $$('[data-allc]', mm).forEach((a) => { const xs = $$(`[data-cat="${a.dataset.allc}"]`, mm); a.checked = xs.length && xs.every((x) => x.checked); });
        $$('[data-allc]', mm).forEach((a) => a.onchange = () => { $$(`[data-cat="${a.dataset.allc}"]`, mm).forEach((x) => { x.checked = a.checked; }); });
        $$('[data-pid]', mm).forEach((x) => x.onchange = syncAll); syncAll();
        mm.querySelector('[data-del]')?.addEventListener('click', () => close({ del: true }));
        mm.querySelector('[data-ok]').onclick = () => {
          const name = mm.querySelector('[data-gn]').value.trim();
          if (!name) { toast('Guruh nomini yozing', 'bad'); mm.querySelector('[data-gn]').focus(); return; }
          const mods = [];
          for (const ln of $$('.ln[data-mid]', rows)) {
            const n = ln.querySelector('[data-mn]').value.trim(); if (!n) continue;
            const iid = Number(ln.querySelector('[data-pkq]').dataset.id) || null;
            const q = numVal(ln.querySelector('[data-mq]'));
            if (iid && !(q > 0)) { toast(`«${n}» — element miqdorini yozing (masalan 0,02 kg)`, 'bad'); ln.querySelector('[data-mq]').focus(); return; }
            mods.push({ id: Number(ln.dataset.mid) || null, name: n, price: moneyVal(ln.querySelector('[data-mp]')) || 0, ingredient_id: iid, ingredient_qty: iid ? q : 0 });
          }
          if (!mods.length) { toast('Kamida bitta qo\'shimcha yozing', 'bad'); return; }
          const product_ids = $$('[data-pid]', mm).filter((x) => x.checked).map((x) => Number(x.dataset.pid));
          close({ name, required: mm.querySelector('[data-req]').checked, multi: mm.querySelector('[data-multi]').checked, mods, product_ids });
        };
      },
    });
    if (!r) return;
    try {
      if (r.del) { if (!(await confirmBox(`«${g.name}» guruhi o'chirilsinmi? Kassada boshqa chiqmaydi.`, { danger: true, ok: 'O\'chirish' }))) return; await P('/api/admin/modgroup/remove', { id: g.id }); }
      else await P('/api/admin/modgroup', { id: g?.id, sort: g?.sort ?? d.groups.length, ...r });
      toast('Saqlandi — kassa 1-2 daqiqada yangilanadi', 'ok'); show('mods');
    } catch (e) { fail(e); }
  };
  $('#addG').onclick = () => form(); $('#addG2')?.addEventListener('click', () => form());
  $$('[data-g]', m).forEach((r) => r.onclick = () => form(d.groups.find((g) => g.id === Number(r.dataset.g))));
};

PAGES.cats = async (m) => {
  const d = await S('/api/admin/menu');
  const st = Object.fromEntries(d.stations.map((s) => [s.id, s.name]));
  m.innerHTML = head('Toifalar va sexlar', 'Sex — oshxona cheki chiqadigan joy (oshxona, mangal, bar). Toifa taomlari shu sexga ketadi.', `<button class="btn" id="addS">${icon('plus')}Sex</button><button class="btn primary" id="addC">${icon('plus')}Toifa</button>`)
    + `<div class="cols2"><div class="card"><div class="card-h"><h3>Toifalar</h3></div><table class="tbl"><thead><tr><th>Toifa</th><th>Sex</th><th class="r">Taomlar</th><th class="r">Tartib</th></tr></thead><tbody>
      ${d.categories.map((c) => `<tr class="click" data-c="${c.id}"><td><span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${esc(c.color || '#999')};margin-right:8px;vertical-align:-1px"></span><b>${esc(c.name)}</b></td><td>${esc(st[c.station_id] || '—')}</td><td class="r">${d.products.filter((p) => p.category_id === c.id).length}</td><td class="r dim">${c.sort}</td></tr>`).join('')}</tbody></table></div>
    <div class="card"><div class="card-h"><h3>Sexlar</h3></div><table class="tbl"><thead><tr><th>Sex</th><th>Printer</th></tr></thead><tbody>
      ${d.stations.map((s) => `<tr class="click" data-s="${s.id}"><td><b>${esc(s.name)}</b></td><td class="dim">${esc(s.printer || 'kassadagi printer')}</td></tr>`).join('')}</tbody></table></div></div>`;
  const catForm = async (c) => {
    const r = await openModal({
      title: c ? 'Toifa' : 'Yangi toifa',
      body: `<div class="field"><label>Nomi</label><input class="input" data-n value="${esc(c?.name || '')}" autofocus></div>
        <div class="grid3"><div class="field"><label>Rangi</label><input class="input" type="color" data-col value="${esc(c?.color || '#2e5ea8')}" style="padding:4px"></div>
        <div class="field"><label>Sex</label><select class="input" data-st><option value="">—</option>${d.stations.map((s) => `<option value="${s.id}" ${c?.station_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
        <div class="field"><label>Tartib</label><input class="input" data-so value="${c?.sort ?? d.categories.length}"></div></div>`,
      foot: `${c ? `<button class="btn danger" data-del>O'chirish</button><span class="grow"></span>` : ''}<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
      onOpen: (mm, close) => { mm.querySelector('[data-ok]').onclick = () => close({ name: mm.querySelector('[data-n]').value, color: mm.querySelector('[data-col]').value, station_id: Number(mm.querySelector('[data-st]').value) || null, sort: Number(mm.querySelector('[data-so]').value) || 0 });
        mm.querySelector('[data-del]')?.addEventListener('click', () => close({ del: true })); },
    });
    if (!r) return;
    try { if (r.del) await P('/api/admin/remove', { kind: 'category', id: c.id }); else await P('/api/admin/category', { id: c?.id, ...r }); toast('Saqlandi', 'ok'); show('cats'); } catch (e) { fail(e); }
  };
  const stForm = async (s) => {
    const r = await openModal({
      title: s ? 'Sex' : 'Yangi sex',
      body: `<div class="field"><label>Nomi</label><input class="input" data-n value="${esc(s?.name || '')}" placeholder="Oshxona, Mangal, Bar…" autofocus></div>
        <div class="field"><label>Printer nomi (ixtiyoriy)</label><input class="input" data-p value="${esc(s?.printer || '')}" placeholder="bo'sh — kassadagi printer"></div>`,
      foot: `${s ? `<button class="btn danger" data-del>O'chirish</button><span class="grow"></span>` : ''}<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
      onOpen: (mm, close) => { mm.querySelector('[data-ok]').onclick = () => close({ name: mm.querySelector('[data-n]').value, printer: mm.querySelector('[data-p]').value });
        mm.querySelector('[data-del]')?.addEventListener('click', () => close({ del: true })); },
    });
    if (!r) return;
    try { if (r.del) await P('/api/admin/remove', { kind: 'station', id: s.id }); else await P('/api/admin/station', { id: s?.id, ...r }); toast('Saqlandi', 'ok'); show('cats'); } catch (e) { fail(e); }
  };
  $('#addC').onclick = () => catForm(); $('#addS').onclick = () => stForm();
  $$('[data-c]', m).forEach((r) => r.onclick = () => catForm(d.categories.find((c) => c.id === Number(r.dataset.c))));
  $$('[data-s]', m).forEach((r) => r.onclick = () => stForm(d.stations.find((s) => s.id === Number(r.dataset.s))));
};

// ---- Pul ----
PAGES.debts = async (m) => {
  const d = await S('/api/debts');
  const owing = d.customers.filter((c) => c.debt > 0);
  m.innerHTML = head('Nasiya — mijozlar qarzi', 'Kassada "Qarzga" to\'langan buyurtmalar shu yerga yoziladi. Naqd to\'lov kassadan (Smena → Qarz to\'lovi) qabul qilinadi.', `<button class="btn primary" id="add">${icon('plus')}Mijoz</button>`)
    + `<div class="stats">${stat('Jami qarz', sum(d.total), `${owing.length} ta mijoz`, 'accent')}</div>
    <div class="card mt"><table class="tbl"><thead><tr><th>Mijoz</th><th>Telefon</th><th>Oxirgi qarz</th><th>Oxirgi to'lov</th><th class="r">Qarzi</th></tr></thead><tbody>
    ${d.customers.map((c) => `<tr class="click" data-c="${esc(c.id)}"><td><b>${esc(c.name || '—')}</b>${c.note ? ` <span class="dim">· ${esc(c.note)}</span>` : ''}</td><td>${esc(c.phone || '')}</td><td>${c.last_debt ? date(c.last_debt) : ''}</td><td>${c.last_pay ? date(c.last_pay) : ''}</td>
      <td class="r ${c.debt > 0 ? 'neg' : 'dim'}"><b>${sum(c.debt)}</b></td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Mijoz yo\'q</div></td></tr>'}</tbody></table></div>`;
  $('#add').onclick = () => customerForm();
  $$('[data-c]', m).forEach((r) => r.onclick = () => customerView(r.dataset.c));
};

async function customerForm(c = null) {
  const r = await openModal({
    title: c ? 'Mijoz' : 'Yangi mijoz',
    body: `<div class="field"><label>Ismi</label><input class="input" data-n value="${esc(c?.name || '')}" autofocus></div><div class="field"><label>Telefon</label><input class="input" data-p value="${esc(c?.phone || '')}"></div>
      <div class="field"><label>Izoh</label><input class="input" data-no value="${esc(c?.note || '')}"></div>`,
    foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
    onOpen: (mm, close) => mm.querySelector('[data-ok]').onclick = () => close({ name: mm.querySelector('[data-n]').value, phone: mm.querySelector('[data-p]').value, note: mm.querySelector('[data-no]').value }),
  });
  if (!r) return;
  try { await P('/api/customer', { id: c?.id, ...r }); toast('Saqlandi', 'ok'); show('debts'); } catch (e) { fail(e); }
}

async function customerView(id) {
  const d = await S('/api/debt?id=' + encodeURIComponent(id));
  const c = d.customer;
  openModal({
    title: `${c.name || c.phone} — qarz ${sum(c.debt)} so'm`, size: 'wide',
    body: `<p class="hint" style="margin-bottom:10px">${esc(c.phone || '')}</p><div class="tbl-wrap" style="max-height:50vh"><table class="tbl"><thead><tr><th>Sana</th><th>Turi</th><th>Izoh</th><th class="r">Summa</th><th>Kim</th></tr></thead><tbody>
      ${d.moves.map((x) => `<tr><td>${dateTime(x.at)}</td><td>${x.kind === 'qarz' ? '<span class="badge bad">Qarz</span>' : '<span class="badge ok">To\'lov</span>'}</td>
      <td>${x.number ? `Buyurtma №${esc(x.number)}` : ''}${x.method ? ' · ' + esc(PAY_NAMES[x.method] || x.method) : ''}${x.note ? ' · ' + esc(x.note) : ''}</td><td class="r ${x.kind === 'qarz' ? 'neg' : 'okc'}">${x.kind === 'qarz' ? '+' : '−'}${sum(x.amount)}</td><td>${esc(x.user_name || '')}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">Harakat yo\'q</div></td></tr>'}</tbody></table></div>`,
    foot: `<button class="btn" data-e>${icon('edit')}Tahrirlash</button><button class="btn" data-q>${icon('plus')}Eski qarz yozish</button><span class="grow"></span><button class="btn primary" data-p>To'lov (karta / bank)</button>`,
    onOpen: (mm, close) => {
      mm.querySelector('[data-e]').onclick = () => { close(); customerForm(c); };
      const move = async (kind) => {
        const r = await openModal({
          title: kind === 'qarz' ? 'Eski qarz yozish' : 'Qarz to\'lovi (kassasiz)',
          body: `${kind === 'tolov' ? `<div class="field"><label>Qanday to'ladi</label><select class="input" data-m><option value="karta">Karta</option><option value="click">Click</option><option value="payme">Payme</option><option value="uzum">Uzum</option></select><p class="hint">Naqd pul — kassadan qabul qiling (Smena → Qarz to'lovi), kassa puli bilan mos kelsin.</p></div>` : ''}
            <div class="field"><label>Summa</label><input class="input money" data-a inputmode="numeric" autofocus></div><div class="field"><label>Izoh</label><input class="input" data-n></div>`,
          foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
          onOpen: (m2, c2) => { moneyInput(m2.querySelector('[data-a]')); m2.querySelector('[data-ok]').onclick = () => c2({ amount: moneyVal(m2.querySelector('[data-a]')), method: m2.querySelector('[data-m]')?.value, note: m2.querySelector('[data-n]').value }); },
        });
        if (!r) return;
        try { await P('/api/debt/move', { customer_id: c.id, kind, ...r }); toast('Saqlandi', 'ok'); close(); customerView(id); show('debts'); } catch (e) { fail(e); }
      };
      mm.querySelector('[data-q]').onclick = () => move('qarz'); mm.querySelector('[data-p]').onclick = () => move('tolov');
    },
  });
}

PAGES.suppliers = async (m) => {
  const d = await S('/api/suppliers');
  m.innerHTML = head('Yetkazib beruvchilar', 'Kirim to\'liq to\'lanmasa — qolgani qarzimiz bo\'lib yoziladi', `<button class="btn primary" id="add">${icon('plus')}Yetkazib beruvchi</button>`)
    + `<div class="stats">${stat('Bizning qarzimiz', sum(d.total), `${d.suppliers.filter((s) => s.debt > 0).length} ta yetkazib beruvchiga`, 'accent')}</div>
    <div class="card mt"><table class="tbl"><thead><tr><th>Nomi</th><th>Telefon</th><th>Oxirgi kirim</th><th class="r">Qarzimiz</th></tr></thead><tbody>
    ${d.suppliers.map((s) => `<tr class="click" data-s="${s.id}"><td><b>${esc(s.name)}</b>${s.note ? ` <span class="dim">· ${esc(s.note)}</span>` : ''}</td><td>${esc(s.phone || '')}</td><td>${s.last_in ? date(s.last_in) : ''}</td>
      <td class="r ${s.debt > 0 ? 'neg' : 'dim'}"><b>${sum(s.debt)}</b></td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">Yetkazib beruvchi yo\'q</div></td></tr>'}</tbody></table></div>`;
  const form = async (s) => {
    const r = await openModal({
      title: s ? 'Yetkazib beruvchi' : 'Yangi yetkazib beruvchi',
      body: `<div class="field"><label>Nomi</label><input class="input" data-n value="${esc(s?.name || '')}" autofocus></div><div class="field"><label>Telefon</label><input class="input" data-p value="${esc(s?.phone || '')}"></div><div class="field"><label>Izoh</label><input class="input" data-no value="${esc(s?.note || '')}"></div>`,
      foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
      onOpen: (mm, close) => mm.querySelector('[data-ok]').onclick = () => close({ name: mm.querySelector('[data-n]').value, phone: mm.querySelector('[data-p]').value, note: mm.querySelector('[data-no]').value }),
    });
    if (!r) return;
    try { await P('/api/supplier', { id: s?.id, ...r }); toast('Saqlandi', 'ok'); show('suppliers'); } catch (e) { fail(e); }
  };
  $('#add').onclick = () => form();
  $$('[data-s]', m).forEach((r) => r.onclick = async () => {
    const x = await S('/api/supplier?id=' + r.dataset.s);
    openModal({
      title: `${x.supplier.name} — qarzimiz ${sum(x.supplier.debt)}`, size: 'wide',
      body: `<div class="tbl-wrap" style="max-height:50vh"><table class="tbl"><thead><tr><th>Sana</th><th>Turi</th><th>Izoh</th><th class="r">Summa</th></tr></thead><tbody>
        ${x.moves.map((mv) => `<tr><td>${dateTime(mv.at)}</td><td>${mv.kind === 'kirim' ? '<span class="badge">Kirim</span>' : mv.kind === 'tolov' ? '<span class="badge ok">To\'lov</span>' : '<span class="badge bad">Bekor</span>'}</td>
        <td>${mv.doc_id ? `hujjat #${mv.doc_id}` : ''}${mv.pay_from ? ' · ' + esc(mv.pay_from) : ''}${mv.note ? ' · ' + esc(mv.note) : ''}</td><td class="r">${sum(mv.amount)}</td></tr>`).join('') || '<tr><td colspan="4"><div class="empty">Harakat yo\'q</div></td></tr>'}</tbody></table></div>`,
      foot: `<button class="btn" data-e>${icon('edit')}Tahrirlash</button><span class="grow"></span><button class="btn primary" data-p>To'lov qilish</button>`,
      onOpen: (mm, close) => {
        mm.querySelector('[data-e]').onclick = () => { close(); form(x.supplier); };
        mm.querySelector('[data-p]').onclick = async () => {
          const pr = await openModal({
            title: `${x.supplier.name} ga to'lov`,
            body: `<div class="field"><label>Summa</label><input class="input money" data-a inputmode="numeric" value="${x.supplier.debt > 0 ? sum(x.supplier.debt) : ''}" autofocus></div>
              <div class="field"><label>Qayerdan</label><select class="input" data-f><option value="kassa">Kassadan (naqd)</option><option value="karta">Karta</option><option value="bank">Bank</option><option value="boshqa">Boshqa</option></select></div><div class="field"><label>Izoh</label><input class="input" data-n></div>`,
            foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>To'lash</button>`,
            onOpen: (m2, c2) => { moneyInput(m2.querySelector('[data-a]')); m2.querySelector('[data-ok]').onclick = () => c2({ amount: moneyVal(m2.querySelector('[data-a]')), pay_from: m2.querySelector('[data-f]').value, note: m2.querySelector('[data-n]').value }); },
          });
          if (!pr) return;
          try { await P('/api/supplier/pay', { supplier_id: x.supplier.id, ...pr }); toast('To\'lov yozildi', 'ok'); close(); show('suppliers'); } catch (e) { fail(e); }
        };
      },
    });
  });
};

PAGES.expenses = async (m) => {
  const d = await S('/api/expenses?' + rq());
  m.innerHTML = head('Rasxodlar', rlabel(), xlBtn('xl') + `<button class="btn primary" id="add">${icon('plus')}Rasxod</button>`) + rangeBar(() => show('expenses'))
    + `<div class="cols2 mt"><div class="card"><div class="card-h"><h3>Ro'yxat</h3><span class="grow"></span><span class="dim">${d.count} ta</span></div><div class="tbl-wrap" style="max-height:560px"><table class="tbl"><thead><tr><th>Sana</th><th>Turi</th><th>Izoh</th><th>Qayerdan</th><th class="r">Summa</th><th></th></tr></thead><tbody>
      ${d.expenses.map((x) => `<tr><td>${dateTime(x.at)}</td><td><b>${esc(x.category)}</b></td><td>${esc(x.note || '')}</td><td>${x.pay_from === 'kassa' ? '<span class="badge">kassadan</span>' : esc(x.pay_from)}</td><td class="r">${sum(x.amount)}</td>
      <td class="r"><button class="btn sm ghost" data-del="${esc(x.id)}">${icon('trash')}</button></td></tr>`).join('') || '<tr><td colspan="6"><div class="empty">Rasxod yo\'q</div></td></tr>'}
      ${d.expenses.length ? `<tr class="total"><td colspan="4">Jami</td><td class="r">${sum(d.total)}</td><td></td></tr>` : ''}</tbody></table></div></div>
      <div class="card"><div class="card-h"><h3>Turi bo'yicha</h3></div><div class="card-b">${hbars(d.by_category, (r) => `${esc(r.category)} <span class="dim">· ${r.n} ta</span>`, (r) => r.sum)}</div></div></div>`;
  $('#add').onclick = async () => {
    const r = await openModal({
      title: 'Yangi rasxod',
      body: `<div class="field"><label>Turi</label><div class="chips" data-c>${d.categories.map((c) => `<button type="button" class="chip" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div></div>
        <div class="grid2"><div class="field"><label>Summa</label><input class="input money" data-a inputmode="numeric"></div><div class="field"><label>Qayerdan to'landi</label><select class="input" data-f><option value="boshqa">Egasining pulidan</option><option value="karta">Karta</option><option value="bank">Bank</option><option value="kassa">Kassadan (naqd, ochiq smena)</option></select></div></div>
        <div class="field"><label>Izoh</label><input class="input" data-n></div>`,
      foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
      onOpen: (mm, close) => {
        let cat = ''; moneyInput(mm.querySelector('[data-a]'));
        $$('[data-c] .chip', mm).forEach((b) => b.onclick = () => { cat = b.dataset.v; $$('[data-c] .chip', mm).forEach((x) => x.classList.toggle('on', x === b)); });
        mm.querySelector('[data-ok]').onclick = () => { if (!cat) { toast('Turini tanlang', 'bad'); return; } close({ category: cat, amount: moneyVal(mm.querySelector('[data-a]')), pay_from: mm.querySelector('[data-f]').value, note: mm.querySelector('[data-n]').value }); };
      },
    });
    if (!r) return;
    try { await P('/api/expense', r); toast('Saqlandi', 'ok'); show('expenses'); } catch (e) { fail(e); }
  };
  $$('[data-del]', m).forEach((b) => b.onclick = async () => { if (!(await confirmBox('Rasxod o\'chirilsinmi?', { danger: true, ok: 'O\'chirish' }))) return; try { await P('/api/expense/delete', { id: b.dataset.del }); toast('O\'chirildi', 'ok'); show('expenses'); } catch (e) { fail(e); } });
  $('#xl').onclick = () => csv(`rasxod_${A.range.from}_${A.range.to}`, ['Sana', 'Turi', 'Izoh', 'Qayerdan', 'Summa'], d.expenses.map((x) => [dateTime(x.at), x.category, x.note || '', x.pay_from, x.amount]));
};

PAGES.shifts = async (m) => {
  const d = await S('/api/reports/shifts');
  const U = Object.fromEntries((A.boot?.staff || []).map((u) => [u.id, u.name]));
  m.innerHTML = head('Smenalar', 'Har smena: savdo, kassadagi pul, farq')
    + `<div class="card"><table class="tbl"><thead><tr><th>№</th><th>Ochildi</th><th>Yopildi</th><th>Kassir</th><th class="r">Savdo</th><th class="r">Naqd</th><th class="r">Kassada bo'lishi kerak</th><th class="r">Sanaldi</th><th class="r">Farq</th></tr></thead><tbody>
    ${d.shifts.map((s) => { const x = s.summary || {}; const diff = s.counted_cash != null ? s.counted_cash - s.expected_cash : null;
      return `<tr class="click" data-s="${esc(s.id)}"><td><b>${esc(s.number ?? '')}</b></td><td>${dateTime(s.opened_at)}</td><td>${s.closed_at ? dateTime(s.closed_at) : '<span class="badge ok">ochiq</span>'}</td><td>${esc(U[s.opened_by] || '')}</td>
      <td class="r">${x.total != null ? sum(x.total) : ''}</td><td class="r">${x.by_method ? sum(x.by_method.naqd) : ''}</td><td class="r">${s.expected_cash != null ? sum(s.expected_cash) : ''}</td><td class="r">${s.counted_cash != null ? sum(s.counted_cash) : ''}</td>
      <td class="r ${diff < 0 ? 'neg' : diff > 0 ? 'okc' : ''}">${diff == null ? '' : sum(diff)}</td></tr>`; }).join('')}</tbody></table></div>`;
  $$('[data-s]', m).forEach((r) => r.onclick = async () => {
    const x = await get('/api/shift/report?id=' + encodeURIComponent(r.dataset.s));
    const s = x.summary;
    const row = (l, v, c = '') => `<tr><td>${esc(l)}</td><td class="r ${c}">${v}</td></tr>`;
    openModal({ title: `Smena №${x.shift.number} — ${x.shift.status === 'open' ? 'X-hisobot' : 'Z-hisobot'}`, body: `<table class="tbl">${row('Ochildi', dateTime(x.shift.opened_at))}${x.shift.closed_at ? row('Yopildi', dateTime(x.shift.closed_at)) : ''}
      ${row('Buyurtmalar', s.orders)}${row('Savdo', sum(s.total))}${row('O\'rtacha chek', sum(s.avg_check))}${Object.entries(s.by_method).filter(([, v]) => v).map(([k, v]) => row(PAY_NAMES[k], sum(v))).join('')}
      ${row('Chegirma', sum(s.discount))}${row('Xizmat haqi', sum(s.service))}${row('Rasxod (kassadan)', sum(s.expenses || 0))}${row('Bekor qilingan taom', `${s.cancelled_items} ta · ${sum(s.cancelled_sum)}`)}
      ${row('Boshlang\'ich naqd', sum(x.shift.opening_cash))}${row('Kassada bo\'lishi kerak', sum(s.expected_cash))}${s.counted_cash != null ? row('Sanaldi', sum(s.counted_cash)) + row('Farq', sum(s.diff), s.diff < 0 ? 'neg' : '') : ''}</table>` });
  });
};

/** Buyurtmalar (cheklar) — kun bo'yicha hamma yopilgan va bekor qilingan buyurtma; bosilsa — ichi va tarixi. */
const OP_NAMES = { pay_method: 'To\'lov turi o\'zgartirildi', open: 'Ochildi', add: 'Taom qo\'shildi', qty: 'Soni o\'zgardi', remove: 'Olib tashlandi (yuborilmagan)', comment: 'Izoh', send: 'Oshxonaga yuborildi',
  cancel: 'Taom bekor qilindi', discount: 'Chegirma', service: 'Xizmat haqi', guests: 'Mehmonlar soni', waiter: 'Ofitsiant', move: 'Stol almashtirildi', meta: 'Mijoz ma\'lumoti',
  ext: 'Bot holati', precheck: 'Hisob chiqarildi', pay: 'To\'lov', unpay: 'To\'lov bekor qilindi', close: 'Yopildi', void: 'Buyurtma bekor qilindi' };
PAGES.orders = async (m) => {
  const day = A.ordDay || today();
  const d = await get('/api/orders?day=' + day);
  const U = Object.fromEntries((A.boot?.staff || []).map((u) => [u.id, u.name]));
  const T = Object.fromEntries((A.boot?.tables || []).map((t) => [t.id, t.name]));
  const all = d.orders.map((o) => ({ o, t: totals(o) }));
  const f = A.ordF || 'all'; const q = (A.ordQ || '').trim().toLowerCase();
  const rows = all.filter(({ o }) => (f === 'all' || (f === 'void' ? o.status === 'void' : o.status !== 'void' && o.type === f))
    && (!q || String(o.number ?? '').includes(q) || (o.customer?.phone || '').replace(/\D/g, '').includes(q.replace(/\D/g, '') || '~')
      || (o.customer?.name || '').toLowerCase().includes(q) || o.items.some((i) => i.name.toLowerCase().includes(q))));
  const closed = all.filter(({ o }) => o.status === 'closed');
  const sumAll = closed.reduce((s, x) => s + x.t.total, 0);
  const voids = all.filter(({ o }) => o.status === 'void').length;
  const cancelled = all.reduce((s, { o }) => s + o.items.filter((i) => i.status === 'cancelled').length, 0);
  const where = (o) => (o.type === 'zal' ? (T[o.table_id] ? `Stol ${esc(T[o.table_id])}` : 'Zal') : esc(o.customer?.phone || o.customer?.name || ''));
  const pays = (o) => [...new Set(o.payments.filter((p) => !p.void).map((p) => PAY_NAMES[p.method] || p.method))].join(', ');
  const types = [['all', 'Hammasi'], ['zal', 'Zalda'], ['olib', 'Olib ketish'], ['yetkazish', 'Yetkazish'], ['bot', 'Botdan'], ['void', 'Bekor qilingan']];
  m.innerHTML = head('Buyurtmalar (cheklar)', 'Har bir chek: nima sotildi, kim kiritdi, kim bekor qildi, qanday to\'landi')
    + `<div class="range noprint"><button class="chip" data-dd="-1">${icon('back')}</button><input type="date" data-day value="${day}" max="${today()}"><button class="chip" data-dd="1" ${day >= today() ? 'disabled' : ''}>›</button>
      <button class="chip ${day === today() ? 'on' : ''}" data-today>Bugun</button></div>
    <div class="stats mt">${stat('Savdo', sum(sumAll), `${closed.length} ta chek`, 'accent')}${stat('O\'rtacha chek', sum(closed.length ? Math.round(sumAll / closed.length) : 0))}
      ${stat('Bekor qilingan buyurtma', voids)}${stat('Bekor qilingan taom', cancelled, 'oshxonaga ketgandan keyin')}</div>
    <div class="card mt"><div class="card-h" style="flex-wrap:wrap;gap:8px"><input class="input" id="q" placeholder="№, telefon, mijoz yoki taom" value="${esc(A.ordQ || '')}" style="max-width:300px">
      <div class="chips">${types.map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-f="${k}">${l}</button>`).join('')}</div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>№</th><th>Vaqt</th><th>Turi</th><th>Stol / mijoz</th><th>Kassir</th><th>To'lov</th><th class="r">Summa</th><th></th></tr></thead><tbody>
    ${rows.map(({ o, t }) => `<tr class="click" data-o="${esc(o.id)}"><td><b>${esc(o.number ?? '')}</b></td><td>${time(o.closed_at || o.opened_at)}</td>
      <td>${esc(TYPE_NAMES[o.type] || o.type)}</td><td>${where(o)}</td><td class="dim">${esc(U[o.closed_by] || U[o.opened_by] || (o.type === 'bot' ? 'Bot' : ''))}</td>
      <td>${o.status === 'void' ? '' : esc(pays(o))}</td><td class="r"><b class="${o.status === 'void' ? 'dim' : ''}" style="${o.status === 'void' ? 'text-decoration:line-through' : ''}">${sum(t.total)}</b></td>
      <td>${o.status === 'void' ? '<span class="badge bad">bekor</span>' : o.items.some((i) => i.status === 'cancelled') ? '<span class="badge warn">taom bekor</span>' : o.discount ? '<span class="badge">chegirma</span>' : ''}</td></tr>`).join('')
      || `<tr><td colspan="8"><div class="empty">${q || f !== 'all' ? 'Topilmadi' : 'Bu kunda buyurtma yo\'q'}</div></td></tr>`}
    </tbody></table></div></div>`;
  const go = (dd) => { A.ordDay = dd > today() ? today() : dd; show('orders'); };
  $$('[data-dd]', m).forEach((b) => b.onclick = () => go(dayShift(day, Number(b.dataset.dd))));
  $('[data-today]', m).onclick = () => go(today());
  $('[data-day]', m).onchange = (e) => { if (e.target.value) go(e.target.value); };
  $$('[data-f]', m).forEach((b) => b.onclick = () => { A.ordF = b.dataset.f; show('orders'); });
  $('#q').oninput = (e) => { A.ordQ = e.target.value; clearTimeout(A.qt); A.qt = setTimeout(() => show('orders').then(() => { const i = $('#q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }), 250); };
  $$('[data-o]', m).forEach((r) => r.onclick = () => orderModal(r.dataset.o));
};

/** To'lov turini tanlash (yopilgan chekdagi xatoni tuzatish uchun). Tanlangan turni qaytaradi yoki undefined. */
function payMethodBox(p) {
  return openModal({
    title: 'To\'lov turini o\'zgartirish',
    body: `<p style="font-size:15px;margin-bottom:12px">Summa <b>${sum(p.amount)}</b> — hozir <b>${esc(PAY_NAMES[p.method] || p.method)}</b>. To'g'ri turini tanlang:</p>
      <div class="chips" style="gap:8px">${PAY_METHODS.filter((x) => x !== 'qarz' && x !== p.method).map((x) => `<button class="btn" type="button" data-to="${x}">${esc(PAY_NAMES[x])}</button>`).join('')}</div>
      <p class="hint" style="margin-top:12px">Summa o'zgarmaydi. Hisobotlar va smena hisoboti (kassada bo'lishi kerak bo'lgan naqd) o'zi qayta hisoblanadi; o'zgarish buyurtma tarixiga yoziladi.</p>`,
    foot: '<button class="btn" data-x>Bekor</button>',
    onOpen: (mm, close) => $$('[data-to]', mm).forEach((b) => b.onclick = () => close(b.dataset.to)),
  });
}

async function orderModal(id) {
  let d; try { d = await S('/api/reports/order?id=' + encodeURIComponent(id)); } catch (e) { fail(e); return; }
  const o = d.order; const t = totals(o);
  const U = Object.fromEntries((A.boot?.staff || []).map((u) => [u.id, u.name]));
  const T = Object.fromEntries((A.boot?.tables || []).map((x) => [x.id, x.name]));
  const row = (l, v, c = '') => `<div class="kv"><span>${esc(l)}</span><b class="${c}">${v}</b></div>`;
  const items = o.items.map((i) => `<tr style="${i.status === 'cancelled' ? 'opacity:.55' : ''}"><td>${esc(i.name)}${i.status === 'cancelled' ? `<div class="neg" style="font-size:12px">bekor: ${esc(i.cancel_reason || '')}${i.cancelled_by ? ` · ruxsat: ${esc(U[i.cancelled_by] || '')}` : ''}</div>` : ''}${i.comment ? `<div class="dim" style="font-size:12px">${esc(i.comment)}</div>` : ''}</td>
    <td class="r">${qty(i.qty, i.unit === 'kg' ? 'kg' : '')}</td><td class="r">${sum(i.price)}</td><td class="r" style="${i.status === 'cancelled' ? 'text-decoration:line-through' : ''}">${sum(Math.round(i.price * i.qty))}</td></tr>`).join('');
  const log = (d.ops || []).filter((x) => !x.error).map((x) => `<div class="lg"><span class="dim">${time(x.at)}</span><span>${esc(OP_NAMES[x.type] || x.type)}${x.type === 'add' && x.data?.item ? ` — ${esc(x.data.item.name)}` : ''}${x.type === 'pay' && x.data?.payment ? ` — ${esc(PAY_NAMES[x.data.payment.method] || '')} ${sum(x.data.payment.amount)}` : ''}${x.type === 'cancel' && x.data?.reason ? ` — ${esc(x.data.reason)}` : ''}${x.type === 'pay_method' ? ` — ${esc(PAY_NAMES[x.data?.from] || '')} → ${esc(PAY_NAMES[x.data?.to] || '')} ${sum(x.data?.amount)}` : ''}</span><span class="dim">${esc(U[x.user_id] || (x.user_id === 0 ? 'Tizim' : ''))}</span></div>`).join('');
  openModal({
    title: `Buyurtma №${o.number ?? ''} — ${TYPE_NAMES[o.type] || o.type}${o.status === 'void' ? ' (bekor qilingan)' : ''}`, size: 'wide',
    body: `<div class="grid2" style="gap:6px 24px;margin-bottom:12px">${row('Ochildi', dateTime(o.opened_at))}${row(o.status === 'void' ? 'Bekor qilindi' : 'Yopildi', o.closed_at ? dateTime(o.closed_at) : '—')}
      ${o.type === 'zal' ? row('Stol', esc(T[o.table_id] || '—')) + row('Mehmon', o.guests || '—') : ''}${o.customer?.phone ? row('Telefon', esc(o.customer.phone)) : ''}${o.customer?.name ? row('Mijoz', esc(o.customer.name)) : ''}
      ${o.customer?.address ? row('Manzil', esc(o.customer.address)) : ''}${o.ext ? row('Bot', esc(`№${o.ext.number || ''} · ${botStatusName(o)}`)) : ''}
      ${row('Ochgan', esc(U[o.opened_by] || (o.type === 'bot' ? 'Bot' : '—')))}${row('Yopgan', esc(U[o.closed_by] || '—'))}${o.waiter_id && o.type === 'zal' ? row('Ofitsiant', esc(U[o.waiter_id] || '')) : ''}
      ${o.status === 'void' ? row('Sabab', esc(o.void_reason || '—'), 'neg') + row('Ruxsat bergan', esc(U[o.void_by] || '—')) : ''}</div>
      ${o.comment ? `<div class="hint" style="margin-bottom:10px">Izoh: ${esc(o.comment)}</div>` : ''}
      <table class="tbl"><thead><tr><th>Taom</th><th class="r">Soni</th><th class="r">Narxi</th><th class="r">Summa</th></tr></thead><tbody>${items}</tbody></table>
      <div style="max-width:320px;margin:12px 0 0 auto">${row('Taomlar', sum(t.subtotal))}${t.discount ? row(`Chegirma${o.discount?.kind === 'pct' ? ` (${o.discount.value}%)` : ''}${o.discount?.reason ? ' — ' + o.discount.reason : ''}`, '−' + sum(t.discount), 'neg') : ''}
        ${t.service ? row(`Xizmat haqi (${o.service_pct}%)`, sum(t.service)) : ''}${row('Jami', sum(t.total))}
        ${o.payments.filter((p) => !p.void).map((p) => `<div class="kv"><span>${esc(PAY_NAMES[p.method] || p.method)}${p.changed ? ` <span class="dim">(${esc(PAY_NAMES[p.changed.from] || p.changed.from)} edi)</span>` : ''}${o.status === 'closed' && p.method !== 'qarz'
          ? ` <button class="btn sm ghost" type="button" data-pm="${esc(p.id)}" style="margin-left:6px">${icon('edit')}O'zgartirish</button>` : ''}</span><b>${sum(p.amount)}</b></div>`).join('')}</div>
      ${log ? `<div class="lbl" style="margin:16px 0 6px">Tarix — kim nima qildi</div><div class="olog">${log}</div>` : ''}`,
    onOpen: (mm, close) => $$('[data-pm]', mm).forEach((b) => b.onclick = async () => {
      const p = o.payments.find((x) => x.id === b.dataset.pm); if (!p) return;
      const to = await payMethodBox(p); if (!to) return;
      try {
        const r = await P('/api/order/pay-method', { order_id: o.id, payment_id: p.id, method: to });
        toast(`To'lov turi o'zgartirildi: ${PAY_NAMES[p.method]} → ${PAY_NAMES[to]}${r.shift_closed ? ' · smena hisoboti ham to\'g\'rilandi' : ''}`, 'ok');
        close(); if (A.page === 'orders') await show('orders');
        orderModal(o.id);
      } catch (e) { fail(e); }
    }) });
}

// ---- Sozlamalar ----
PAGES.staff = async (m) => {
  const d = await S('/api/admin/staff');
  m.innerHTML = head('Xodimlar', 'Har xodim kassaga o\'z PIN-kodi bilan kiradi. Bekor qilish va chegirma — faqat menejer ruxsati bilan.', `<button class="btn primary" id="add">${icon('plus')}Xodim</button>`)
    + `<div class="card"><table class="tbl"><thead><tr><th>Xodim</th><th>Lavozim</th><th>Email (boshqaruvga kirish)</th><th>Holat</th></tr></thead><tbody>
    ${d.staff.map((u) => `<tr class="click" data-u="${u.id}" style="${u.active ? '' : 'opacity:.5'}"><td><span class="av" style="background:${esc(u.color || '#3d4a63')};width:30px;height:30px;font-size:12px;margin-right:10px;vertical-align:middle">${esc(initials(u.name))}</span><b>${esc(u.name)}</b></td>
      <td>${esc(ROLE_NAMES[u.role])}</td><td class="dim">${esc(u.email || '')}</td><td>${u.active ? (u.has_pin ? '<span class="badge ok">faol</span>' : '<span class="badge warn">PIN yo\'q</span>') : '<span class="badge">o\'chirilgan</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  const form = async (u) => {
    const r = await openModal({
      title: u ? u.name : 'Yangi xodim',
      body: `<div class="grid2"><div class="field"><label>Ismi</label><input class="input" data-n value="${esc(u?.name || '')}" autofocus></div>
        <div class="field"><label>Lavozimi</label><select class="input" data-r>${ROLES.filter((r_) => r_ !== 'owner' || A.user.role === 'owner').map((r_) => `<option value="${r_}" ${u?.role === r_ ? 'selected' : ''}>${esc(ROLE_NAMES[r_])}</option>`).join('')}</select></div></div>
        <div class="grid2"><div class="field"><label>${u ? 'Yangi PIN (bo\'sh — o\'zgarmaydi)' : 'PIN-kod (4–6 raqam)'}</label><input class="input" data-p inputmode="numeric" maxlength="6"></div>
        <div class="field"><label>Rangi</label><input class="input" type="color" data-c value="${esc(u?.color || '#3d4a63')}" style="padding:4px"></div></div>
        <div class="grid2"><div class="field"><label>Email (faqat egasi/menejer — kassani ulash uchun)</label><input class="input" data-e value="${esc(u?.email || '')}"></div>
        <div class="field"><label>Parol (8+ belgi, ixtiyoriy)</label><input class="input" data-pw type="password"></div></div>
        ${u ? `<label class="sw"><input type="checkbox" data-a ${u.active ? 'checked' : ''}> Faol (o'chirilsa kassaga kira olmaydi)</label>` : ''}`,
      foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
      onOpen: (mm, close) => mm.querySelector('[data-ok]').onclick = () => close({ name: mm.querySelector('[data-n]').value, role: mm.querySelector('[data-r]').value, pin: mm.querySelector('[data-p]').value || undefined,
        color: mm.querySelector('[data-c]').value, email: mm.querySelector('[data-e]').value, password: mm.querySelector('[data-pw]').value || undefined, active: u ? mm.querySelector('[data-a]').checked : true }),
    });
    if (!r) return;
    try { await P('/api/admin/staff', { id: u?.id, ...r }); toast('Saqlandi — kassada "Menyuni yangilash" bosing', 'ok'); show('staff'); } catch (e) { fail(e); }
  };
  $('#add').onclick = () => form();
  $$('[data-u]', m).forEach((r) => r.onclick = () => form(d.staff.find((u) => u.id === Number(r.dataset.u))));
};

PAGES.halls = async (m) => {
  const d = await S('/api/admin/menu');
  m.innerHTML = head('Zal va stollar', 'Xizmat haqi har zalga alohida (masalan VIP — 15%)', `<button class="btn primary" id="addH">${icon('plus')}Zal</button>`)
    + d.halls.map((h) => `<div class="card mt"><div class="card-h"><h3>${esc(h.name)}</h3><span class="badge">xizmat haqi ${h.service_pct}%</span><span class="grow"></span>
      <button class="btn sm" data-eh="${h.id}">${icon('edit')}Zal</button><button class="btn sm primary" data-at="${h.id}">${icon('plus')}Stol</button></div>
      <div class="card-b"><div class="chips">${d.tables.filter((t) => t.hall_id === h.id).map((t) => `<button class="chip" data-t="${t.id}">${esc(t.name)} <span class="dim">· ${t.seats} o'rin</span></button>`).join('') || '<span class="hint">Stol yo\'q</span>'}</div></div></div>`).join('');
  const hallForm = async (h) => {
    const r = await openModal({ title: h ? 'Zal' : 'Yangi zal',
      body: `<div class="field"><label>Nomi</label><input class="input" data-n value="${esc(h?.name || '')}" autofocus></div><div class="grid2"><div class="field"><label>Xizmat haqi, %</label><input class="input" data-s inputmode="decimal" value="${h?.service_pct ?? 10}"></div><div class="field"><label>Tartib</label><input class="input" data-o value="${h?.sort ?? d.halls.length}"></div></div>`,
      foot: `${h ? '<button class="btn danger" data-del>O\'chirish</button><span class="grow"></span>' : ''}<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
      onOpen: (mm, close) => { mm.querySelector('[data-ok]').onclick = () => close({ name: mm.querySelector('[data-n]').value, service_pct: numVal(mm.querySelector('[data-s]')), sort: Number(mm.querySelector('[data-o]').value) || 0 }); mm.querySelector('[data-del]')?.addEventListener('click', () => close({ del: true })); } });
    if (!r) return;
    try { if (r.del) await P('/api/admin/remove', { kind: 'hall', id: h.id }); else await P('/api/admin/hall', { id: h?.id, ...r }); toast('Saqlandi', 'ok'); show('halls'); } catch (e) { fail(e); }
  };
  const tableForm = async (t, hallId) => {
    const r = await openModal({ title: t ? `Stol ${t.name}` : 'Yangi stol',
      body: `<div class="grid3"><div class="field"><label>Nomi / raqami</label><input class="input" data-n value="${esc(t?.name || '')}" autofocus></div><div class="field"><label>O'rinlar</label><input class="input" data-s inputmode="numeric" value="${t?.seats ?? 4}"></div>
        <div class="field"><label>Zal</label><select class="input" data-h>${d.halls.map((h) => `<option value="${h.id}" ${(t?.hall_id || hallId) === h.id ? 'selected' : ''}>${esc(h.name)}</option>`).join('')}</select></div></div>`,
      foot: `${t ? '<button class="btn danger" data-del>O\'chirish</button><span class="grow"></span>' : ''}<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>Saqlash</button>`,
      onOpen: (mm, close) => { mm.querySelector('[data-ok]').onclick = () => close({ name: mm.querySelector('[data-n]').value, seats: Number(mm.querySelector('[data-s]').value) || 4, hall_id: Number(mm.querySelector('[data-h]').value), sort: t?.sort ?? 99 }); mm.querySelector('[data-del]')?.addEventListener('click', () => close({ del: true })); } });
    if (!r) return;
    try { if (r.del) await P('/api/admin/remove', { kind: 'table', id: t.id }); else await P('/api/admin/table', { id: t?.id, ...r }); toast('Saqlandi', 'ok'); show('halls'); } catch (e) { fail(e); }
  };
  $('#addH').onclick = () => hallForm();
  $$('[data-eh]', m).forEach((b) => b.onclick = () => hallForm(d.halls.find((h) => h.id === Number(b.dataset.eh))));
  $$('[data-at]', m).forEach((b) => b.onclick = () => tableForm(null, Number(b.dataset.at)));
  $$('[data-t]', m).forEach((b) => b.onclick = () => tableForm(d.tables.find((t) => t.id === Number(b.dataset.t))));
};

PAGES.settings = async (m) => {
  const d = await S('/api/admin/settings');
  const dv = await S('/api/admin/devices');
  const bt = await S('/api/admin/bot');
  const s = d.settings;
  const f = (k, l, ph = '') => `<div class="field"><label>${esc(l)}</label><input class="input" data-k="${k}" value="${esc(s[k] || '')}" placeholder="${esc(ph)}"></div>`;
  m.innerHTML = head('Restoran va qurilmalar')
    + `<div class="cols2"><div class="card"><div class="card-h"><h3>Restoran ma'lumoti (chekda chiqadi)</h3></div><div class="card-b">
      ${f('name', 'Nomi')}${f('receipt_header', 'Chek tepasidagi yozuv')}<div class="grid2">${f('address', 'Manzil')}${f('phone', 'Telefon')}</div>
      <div class="grid2">${f('tin', 'STIR (INN)')}<div class="field"><label>Xizmat haqi</label><p class="hint" style="margin-top:8px">Har zal uchun alohida — Sozlamalar → Zal va stollar</p></div></div>
      ${f('receipt_footer', 'Chek ostidagi yozuv', 'Yoqimli ishtaha!')}${f('precheck_note', 'Hisob (prechek) ostidagi izoh', 'masalan: karta raqami to\'lov uchun')}
      <button class="btn primary" id="save">Saqlash</button></div></div>
    <div class="card"><div class="card-h"><h3>Ulangan qurilmalar (kassalar)</h3></div><table class="tbl"><thead><tr><th>Qurilma</th><th>Oxirgi faollik</th><th></th></tr></thead><tbody>
      ${dv.devices.map((x) => `<tr style="${x.revoked ? 'opacity:.5' : ''}"><td><b>${esc(x.name)}</b> <span class="dim">#${x.id}</span></td><td>${x.last_seen ? dateTime(x.last_seen) : '—'}</td>
        <td class="r">${x.revoked ? '<span class="badge">uzilgan</span>' : `<button class="btn sm danger" data-rv="${x.id}">Uzish</button>`}</td></tr>`).join('')}</tbody></table>
      <div class="card-b hint">Kassa yo'qolsa yoki ishdan bo'shagan xodimda qolsa — shu yerdan uzing, u boshqa ishlay olmaydi.</div></div></div>
    <div class="card mt" id="botCard"><div class="card-h"><h3>Telegram bot — buyurtmalar kassaga tushsin</h3>
      ${bt.url && bt.key_set ? (bt.error ? '<span class="badge bad">Xato</span>' : '<span class="badge ok">Ulangan</span>') : '<span class="badge">Ulanmagan</span>'}</div>
      <div class="card-b">
      <ol class="steps"><li>Telegram'da botingizga (egasi sifatida, shaxsiy chatda) <b>/kassa</b> deb yozing.</li><li>Bot bergan <b>manzil</b> va <b>kalitni</b> pastga kiriting va «Ulash»ni bosing.</li><li>Shundan keyin mijoz botda buyurtma bersa — kassada ovoz bilan «Botdan buyurtma» chiqadi. Kassada «Qabul qilish», «Yo'lga chiqdi», to'lov — mijozga botdan xabar boradi.</li></ol>
      <div class="grid2"><div class="field"><label>Bot manzili</label><input class="input" id="botUrl" value="${esc(bt.url)}" placeholder="https://mazza-point.vercel.app"></div>
        <div class="field"><label>Kalit</label><input class="input" id="botKey" type="password" autocomplete="off" placeholder="${bt.key_set ? 'saqlangan — o\'zgartirish uchun yangisini kiriting' : 'botda /kassa yozsangiz beradi'}"></div></div>
      <div class="row" style="gap:8px;flex-wrap:wrap"><button class="btn primary" id="botSave">${bt.url ? 'Saqlash' : 'Ulash'}</button>${bt.url ? '<button class="btn" id="botCheck">Tekshirish</button><button class="btn danger" id="botOff">Uzish</button>' : ''}</div>
      ${bt.url ? `<div class="hint mt">Oxirgi aloqa: ${bt.ok_at ? dateTime(bt.ok_at) : '—'} · so'nggi 24 soatda botdan ${bt.orders_24h} ta buyurtma${bt.pending ? ` · botga yuborilishi kutilayotgan holatlar: ${bt.pending}` : ''}</div>` : ''}
      ${bt.error ? `<div class="hint mt" style="color:var(--bad)">${esc(bt.error)}</div>` : ''}
      <div class="hint mt">Kassa ochiq turganda botni har 8 soniyada tekshiradi. Kassa yopiq bo'lsa buyurtma botda qoladi va kassa ochilganda tushadi.</div></div></div>`;
  m.insertAdjacentHTML('beforeend', `<div class="card mt"><div class="card-h"><h3>Kirish paroli (email bilan kirish)</h3></div><div class="card-b">
    <div class="grid3"><div class="field"><label>Hozirgi parol</label><input class="input" type="password" id="pw0" autocomplete="current-password"></div>
    <div class="field"><label>Yangi parol (kamida 8 belgi)</label><input class="input" type="password" id="pw1" autocomplete="new-password"></div>
    <div class="field"><label>Yangi parol — yana bir bor</label><input class="input" type="password" id="pw2" autocomplete="new-password"></div></div>
    <button class="btn" id="pwSave">Parolni almashtirish</button><div class="hint mt">Kassalar uzilmaydi. Boshqaruvga keyin PIN bilan qayta kirasiz.</div></div></div>`);
  $('#pwSave').onclick = async () => {
    if ($('#pw1').value !== $('#pw2').value) { toast('Yangi parollar bir xil emas', 'bad'); return; }
    try { await P('/api/password', { old: $('#pw0').value, password: $('#pw1').value }); toast('Parol almashtirildi', 'ok'); setSession(null); login(); } catch (e) { fail(e); }
  };
  $('#save').onclick = async () => { const b = {}; $$('[data-k]', m).forEach((i) => { b[i.dataset.k] = i.value; }); try { await P('/api/admin/settings', b); toast('Saqlandi — kassada "Menyuni yangilash" bosing', 'ok'); } catch (e) { fail(e); } };
  $('#botSave').onclick = async () => {
    const btn = $('#botSave'); btn.disabled = true;
    try { const r = await P('/api/admin/bot', { url: $('#botUrl').value.trim(), key: $('#botKey').value.trim() }); toast(`Ulandi${r.name ? ': ' + r.name : ''} — kassada sahifani yangilang`, 'ok'); show('settings'); }
    catch (e) { fail(e); } finally { btn.disabled = false; }
  };
  $('#botCheck')?.addEventListener('click', async () => { try { const r = await P('/api/admin/bot/check', {}); toast(`Bot javob berdi${r.name ? ': ' + r.name : ''}`, 'ok'); } catch (e) { fail(e); } });
  $('#botOff')?.addEventListener('click', async () => { if (!(await confirmBox('Bot uzilsinmi? Yangi buyurtmalar kassaga tushmaydi.', { danger: true, ok: 'Uzish' }))) return; try { await P('/api/admin/bot', { off: true }); toast('Uzildi', 'ok'); show('settings'); } catch (e) { fail(e); } });
  $$('[data-rv]', m).forEach((b) => b.onclick = async () => { if (!(await confirmBox('Qurilma uzilsinmi? Unda kassa ishlamay qoladi.', { danger: true, ok: 'Uzish' }))) return; try { await P('/api/admin/devices/revoke', { id: Number(b.dataset.rv) }); toast('Uzildi', 'ok'); show('settings'); } catch (e) { fail(e); } });
};

// =================== Ishga tushirish ===================
(async () => {
  // Kassadan «Boshqaruv» bosilgan bo'lsa — kassada kiritilgan PIN bilan olingan sessiya keladi, qayta so'ralmaydi.
  const m = location.hash.match(/^#kirish=(.+)$/);
  if (m) {
    try { const x = JSON.parse(decodeURIComponent(m[1])); if (x?.t && x?.u) { setSession(x.t, x.u); A.user = x.u; } } catch { /* */ }
    history.replaceState(null, '', '#dash');
  }
  if (sessionToken() && A.user) {
    try { A.boot = await get('/api/boot'); shell(); return; } catch { /* */ }
  }
  login();
})();
