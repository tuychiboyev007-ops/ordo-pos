/** Umumiy UI yordamchilari: format, belgilar, oyna (modal), xabar, klaviatura. */

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 1250000 → "1 250 000" */
export function sum(n) {
  const v = Math.round(Number(n) || 0);
  const s = Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (v < 0 ? '−' : '') + s;
}
export const som = (n) => sum(n) + ' so\'m';
/** Miqdor: 0.17 kg → "170 g", 2 → "2", 1.5 → "1,5" */
export function qty(n, unit) {
  const v = Math.round((Number(n) || 0) * 1000) / 1000;
  if ((unit === 'kg' || unit === 'l') && Math.abs(v) < 1 && v !== 0) return sum(v * 1000) + (unit === 'kg' ? ' g' : ' ml');
  const s = String(Math.abs(v)).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return (v < 0 ? '−' : '') + s + (unit ? ' ' + unitName(unit) : '');
}
export const unitName = (u) => ({ kg: 'kg', l: 'l', dona: 'dona' }[u] || u || '');

const TZ = 5 * 3600e3;
const local = (d) => new Date((typeof d === 'string' ? Date.parse(d) : +d) + TZ);
export const time = (d) => (d ? local(d).toISOString().slice(11, 16) : '');
export const date = (d) => { if (!d) return ''; const t = local(d).toISOString(); return `${t.slice(8, 10)}.${t.slice(5, 7)}.${t.slice(0, 4)}`; };
export const dateTime = (d) => (d ? `${date(d)} ${time(d)}` : '');
export const today = () => local(Date.now()).toISOString().slice(0, 10);
export const dayShift = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
export function since(d) {
  const m = Math.max(0, Math.floor((Date.now() - Date.parse(d)) / 60000));
  return m < 60 ? `${m} daq` : `${Math.floor(m / 60)} soat ${m % 60} daq`;
}
export const uid = (p = 'x') => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
export const initials = (name) => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

// ---- Belgilar (chiziqli SVG) ----
const P = {
  bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  hall: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/>',
  bag: '<path d="M6 8h12l-1 12H7L6 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3v4h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v.01M18 14.5v.01"/>',
  note: '<path d="M5 4h11l3 3v13H5z"/><path d="M9 10h6M9 14h6"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  back: '<path d="M15 18l-6-6 6-6"/>', chev: '<path d="M9 18l6-6-6-6"/>', search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  send: '<path d="M4 12l16-8-6 16-2-7-8-1z"/>', spark: '<path d="M11 3l1.9 5.1L18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9L11 3z"/><path d="M18.5 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9.9-2.1z"/>', receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  move: '<path d="M5 9l-3 3 3 3M19 9l3 3-3 3M2 12h20"/>', pct: '<path d="M19 5L5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  check: '<path d="M5 12l5 5 9-10"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01"/>',
  offline: '<path d="M2 8.5a15 15 0 0 1 6-3M22 8.5a15 15 0 0 0-9-3.5M5 12a10 10 0 0 1 4-2.3M19 12a10 10 0 0 0-3-2M8.5 15.5a5 5 0 0 1 7 0M12 19h.01M3 3l18 18"/>',
  box: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7M12 11v10"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  home: '<path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/>', book: '<path d="M4 4h10a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z"/><path d="M4 16a4 4 0 0 1 4-4h10"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', flame: '<path d="M12 3c2 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-5 3-6 0 3 2 4 3 4-1-4 0-7 0-9z"/>',
  table: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M6 12v8M18 12v8"/>', wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 7l12-4v4M17 13.5h.01"/>',
  out: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11"/>', print: '<path d="M6 9V3h12v6M6 18H4v-7h16v7h-2"/><rect x="7" y="14" width="10" height="7"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M15 7h6v6"/>', alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  truckin: '<path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="18" r="1.8"/><circle cx="17" cy="18" r="1.8"/><path d="M8 3v5M6 6l2 2 2-2"/>',
  scale: '<path d="M12 3v18M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0zM19 7l-3 7a3.5 3.5 0 0 0 6 0z"/>',
};
export const icon = (name, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`;

// ---- Xabarlar ----
export function toast(msg, kind = '') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast ' + kind;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 4500 : 2600);
}

// ---- Oyna ----
/**
 * openModal({ title, body (HTML), foot (HTML), size, onOpen(el, close) }) → Promise (close(value) qiymati).
 * Ichida maydon bo'lgan oyna fonga bosilganda yopilmaydi — tegib ketib kiritilgan narsa yo'qolmasin.
 */
/** Oyna eng ustidami (ustida boshqa oyna ochilmaganmi). */
export const isTopModal = (m) => { const all = document.querySelectorAll('.modal'); return all[all.length - 1] === m; };

export function openModal({ title, body = '', foot = '', size = '', onOpen, dismiss = true }) {
  return new Promise((resolve) => {
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `<div class="box ${size}" role="dialog" aria-modal="true">
      ${title ? `<div class="mh"><h2>${esc(title)}</h2><button class="icon-btn" data-x aria-label="Yopish">${icon('x')}</button></div>` : ''}
      <div class="mb">${body}</div>${foot ? `<div class="mf">${foot}</div>` : ''}</div>`;
    document.body.appendChild(m);
    let done = false;
    const close = (v) => { if (done) return; done = true; m.remove(); document.removeEventListener('keydown', key); resolve(v); };
    // Escape faqat eng ustidagi oynani yopadi (ilgari hamma ochiq oynalar birdan yopilardi).
    const key = (e) => { if (e.key === 'Escape' && !e.ordoDone && isTopModal(m)) { e.ordoDone = true; close(undefined); } };
    document.addEventListener('keydown', key);
    m.addEventListener('click', (e) => {
      if (e.target.closest('[data-x]')) close(undefined);
      else if (e.target === m && dismiss && !m.querySelector('input,textarea,select')) close(undefined);
    });
    onOpen?.(m, close);
    const f = m.querySelector('[autofocus]'); if (f) setTimeout(() => f.focus(), 30);
  });
}

export function confirmBox(text, { ok = 'Ha', danger = false, title = 'Tasdiqlang' } = {}) {
  return openModal({
    title, body: `<p style="font-size:16px">${esc(text)}</p>`,
    foot: `<button class="btn" data-x>Yo'q</button><button class="btn ${danger ? 'danger solid' : 'primary'}" data-ok>${esc(ok)}</button>`,
    onOpen: (m, close) => m.querySelector('[data-ok]').onclick = () => close(true),
  });
}

/** Raqam kiritish oynasi (sensorli ekran uchun klaviatura bilan). */
export function numberBox({ title, value = '', decimal = false, hint = '', ok = 'Tayyor', suffix = '' }) {
  return openModal({
    title, size: '',
    body: `<div class="input money" data-v style="height:64px;font-size:30px;display:flex;align-items:center;justify-content:flex-end;gap:8px">
        <span data-t>${esc(value)}</span><span class="hint" style="font-size:16px">${esc(suffix)}</span></div>
      ${hint ? `<p class="hint" style="margin-top:8px">${esc(hint)}</p>` : ''}
      <div class="pad" style="margin-top:14px">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => `<button data-d="${d}">${d}</button>`).join('')}
        <button class="fn" data-d="${decimal ? ',' : '00'}">${decimal ? ',' : '00'}</button><button data-d="0">0</button><button class="fn" data-d="del">${icon('back')}</button></div>`,
    foot: `<button class="btn" data-x>Bekor</button><button class="btn primary" data-ok>${esc(ok)}</button>`,
    onOpen: (m, close) => {
      let v = String(value ?? '');
      const t = m.querySelector('[data-t]');
      const draw = () => { t.textContent = decimal ? v : sum(v || 0); };
      draw();
      const put = (d) => {
        if (d === 'del') v = v.slice(0, -1);
        else if (d === ',') { if (!v.includes(',')) v = (v || '0') + ','; }
        else if (v.length < 12) v = (v === '0' ? '' : v) + d;
        draw();
      };
      m.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => put(b.dataset.d));
      const key = (e) => {
        if (/^\d$/.test(e.key)) put(e.key);
        else if (e.key === 'Backspace') put('del');
        else if ((e.key === ',' || e.key === '.') && decimal) put(',');
        else if (e.key === 'Enter') m.querySelector('[data-ok]').click();
      };
      document.addEventListener('keydown', key);
      m.querySelector('[data-ok]').onclick = () => { document.removeEventListener('keydown', key); close(Number(String(v).replace(',', '.')) || 0); };
      m.addEventListener('click', (e) => { if (e.target.closest('[data-x]')) document.removeEventListener('keydown', key); });
    },
  });
}

/** Matn bilan pul maydoni: "1 250 000" ko'rinishida yoziladi. */
export function moneyInput(el) {
  el.setAttribute('inputmode', 'numeric');
  const fmt = () => {
    const digits = el.value.replace(/\D/g, '');
    const pos = el.value.length - el.selectionStart;
    el.value = digits ? sum(digits) : '';
    const p = Math.max(0, el.value.length - pos);
    try { el.setSelectionRange(p, p); } catch { /* */ }
  };
  el.addEventListener('input', fmt);
  if (el.value) fmt();
}
export const moneyVal = (el) => Number(String(el.value).replace(/\D/g, '')) || 0;
export const numVal = (el) => Number(String(el.value).replace(/\s/g, '').replace(',', '.')) || 0;

/**
 * Miqdorni odam yozganidek o'qiydi: "10", "10kg", "10 kg", "0,5", "500 g" (kg masalliqqa → 0.5), "2 l".
 * ok: false — son emas (maydon qizil bo'ladi).
 */
export function qtyParse(raw, unit = 'dona') {
  const s = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(',', '.');
  if (!s) return { v: 0, ok: true, empty: true };
  const m = /^(\d+(?:\.\d+)?|\.\d+)(kg|кг|kilo|gramm|gr|g|гр|г|litr|l|л|ml|мл|dona|ta|шт|x)?$/.exec(s);
  if (!m) return { v: 0, ok: false };
  let v = Number(m[1]);
  if (unit !== 'dona' && /^(gramm|gr|g|гр|г|ml|мл)$/.test(m[2] || '')) v /= 1000;
  return { v: Math.round(v * 1000) / 1000, ok: true };
}
export const qtyVal = (el, unit) => qtyParse(el?.value, unit).v;

/** ordo logosi — halqa va nuqta (halqa matn rangida, nuqta qizil). */
export const MARK = '<svg class="omark" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="17" fill="none" stroke="currentColor" stroke-width="9"/><circle cx="46" cy="18" r="7" fill="#e4572e"/></svg>';
