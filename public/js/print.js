/**
 * Cheklar: mijoz cheki, oldindan hisob (prechek), oshxona (sex) cheki, smena Z-hisoboti.
 *
 * Hozircha brauzer orqali chop etiladi (80 yoki 58 mm qog'oz). Chrome'ni `--kiosk-printing`
 * bilan ochilsa oyna chiqmasdan to'g'ridan-to'g'ri bosiladi. Keyingi bosqichda kassa
 * kompyuteridagi "ordo Print" yordamchi dasturi orqali — har sex o'z printeriga, pul qutisi bilan.
 */
import { totals, lineSum, TYPE_NAMES, PAY_NAMES } from './core.js';
import { esc, sum, qty, time, date, dateTime } from './ui.js';

const LSK = 'ordo.printcfg';
export function printCfg() {
  try { return { mode: 'browser', kitchen: true, receipt: true, paper: '80', ...JSON.parse(localStorage.getItem(LSK) || '{}') }; } catch { return { mode: 'browser', kitchen: true, receipt: true, paper: '80' }; }
}
export function setPrintCfg(c) { try { localStorage.setItem(LSK, JSON.stringify(c)); } catch { /* */ } }

const CSS = (w) => `@page{size:${w}mm auto;margin:0}*{box-sizing:border-box;margin:0;padding:0}
body{width:${w}mm;padding:3mm ${w === 80 ? 4 : 2}mm 6mm;font:12px/1.35 "Courier New",monospace;color:#000}
.c{text-align:center}.b{font-weight:700}.big{font-size:17px;font-weight:700}.xl{font-size:22px;font-weight:700}
.hr{border-top:1px dashed #000;margin:5px 0}.r{display:flex;justify-content:space-between;gap:6px}.r span:last-child{text-align:right;white-space:nowrap}
.it{margin:3px 0}.it .n{font-weight:700}.cm{font-style:italic;padding-left:8px}.sm{font-size:11px}
.cut{margin-top:10mm}`;

function page(html, paper) {
  const w = Number(paper) === 58 ? 58 : 80;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS(w)}</style></head><body>${html}<div class="cut"></div></body></html>`;
}

function head(ctx, o) {
  const s = ctx.settings || {};
  return `<div class="c big">${esc(s.name || ctx.company?.name || '')}</div>
    ${s.receipt_header && s.receipt_header !== s.name ? `<div class="c sm">${esc(s.receipt_header)}</div>` : ''}
    ${s.address ? `<div class="c sm">${esc(s.address)}</div>` : ''}${s.phone ? `<div class="c sm">${esc(s.phone)}</div>` : ''}
    ${s.tin ? `<div class="c sm">STIR: ${esc(s.tin)}</div>` : ''}<div class="hr"></div>
    <div class="r"><span>Buyurtma № ${esc(o.number ?? '')}</span><span>${date(o.closed_at || o.opened_at)}</span></div>
    <div class="r"><span>${esc(TYPE_NAMES[o.type] || '')}${o.table_id ? ' · stol ' + esc(ctx.tableName(o.table_id)) : ''}</span><span>${time(o.opened_at)}${o.closed_at ? '–' + time(o.closed_at) : ''}</span></div>
    ${o.waiter_id ? `<div class="r"><span>${o.type === 'zal' ? 'Ofitsiant' : 'Kassir'}:</span><span>${esc(ctx.staffName(o.waiter_id))}</span></div>` : ''}
    ${o.guests ? `<div class="r"><span>Mehmonlar:</span><span>${o.guests}</span></div>` : ''}
    ${o.customer?.name ? `<div class="r"><span>Mijoz:</span><span>${esc(o.customer.name)}</span></div>` : ''}
    ${o.customer?.phone ? `<div class="r b"><span>Tel:</span><span>${esc(o.customer.phone)}</span></div>` : ''}
    ${o.customer?.address ? `<div class="b" style="margin-top:2px">Manzil: ${esc(o.customer.address)}</div>` : ''}`;
}

function lines(o) {
  // Bir xil taom (narxi va izohi bir xil) bitta qatorga yig'iladi.
  const g = new Map();
  for (const it of o.items) {
    if (it.status === 'cancelled') continue;
    const k = `${it.product_id}|${it.price}|${it.comment || ''}|${it.unit}`;
    const x = g.get(k) || { ...it, qty: 0 };
    x.qty = Math.round((x.qty + it.qty) * 1000) / 1000;
    g.set(k, x);
  }
  return [...g.values()].map((it) => `<div class="it"><div class="n">${esc(it.name)}</div>
    <div class="r"><span>${qty(it.qty, it.unit === 'kg' ? 'kg' : '')} x ${sum(it.price)}</span><span>${sum(lineSum(it))}</span></div>
    ${it.comment ? `<div class="cm">${esc(it.comment)}</div>` : ''}</div>`).join('');
}

function money(o) {
  const t = totals(o);
  return `<div class="hr"></div>
    ${t.discount || t.service ? `<div class="r"><span>Jami taomlar:</span><span>${sum(t.subtotal)}</span></div>` : ''}
    ${t.discount ? `<div class="r"><span>Chegirma${o.discount?.kind === 'pct' ? ' ' + o.discount.value + '%' : ''}:</span><span>−${sum(t.discount)}</span></div>` : ''}
    ${t.service ? `<div class="r"><span>Xizmat haqi ${o.service_pct}%:</span><span>${sum(t.service)}</span></div>` : ''}
    <div class="r xl"><span>JAMI:</span><span>${sum(t.total)}</span></div>`;
}

export function receiptHTML(o, ctx, { pre = false } = {}) {
  const pays = o.payments.filter((p) => !p.void);
  const change = pays.reduce((s, p) => s + (p.change || 0), 0);
  return page(`${head(ctx, o)}<div class="hr"></div>${lines(o)}${money(o)}
    ${pre ? `<div class="hr"></div><div class="c b">HISOB — to'lov hali qilinmagan</div>${ctx.settings?.precheck_note ? `<div class="c sm">${esc(ctx.settings.precheck_note)}</div>` : ''}`
    : `<div class="hr"></div>${pays.map((p) => `<div class="r"><span>${esc(PAY_NAMES[p.method])}:</span><span>${sum(p.method === 'naqd' ? p.received : p.amount)}</span></div>`).join('')}
      ${change ? `<div class="r b"><span>Qaytim:</span><span>${sum(change)}</span></div>` : ''}`}
    <div class="hr"></div><div class="c">${esc(ctx.settings?.receipt_footer || 'Rahmat!')}</div>
    <div class="c sm" style="margin-top:4px">ordo · ${dateTime(new Date())}</div>`, ctx.paper);
}

/** Oshxona (sex) cheki: faqat shu sexga tegishli, hozir yuborilgan taomlar. Narx yo'q. */
export function kitchenHTML(o, items, station, ctx) {
  return page(`<div class="c xl">${esc(station)}</div>
    <div class="r big"><span>№ ${esc(o.number ?? '')}</span><span>${o.table_id ? 'Stol ' + esc(ctx.tableName(o.table_id)) : esc(TYPE_NAMES[o.type] || '')}</span></div>
    <div class="r sm"><span>${esc(ctx.staffName(o.waiter_id) || '')}</span><span>${time(new Date())}</span></div><div class="hr"></div>
    ${items.map((it) => `<div class="it"><div class="r big"><span>${esc(it.name)}</span><span>${qty(it.qty, it.unit === 'kg' ? 'kg' : '')}</span></div>
      ${it.comment ? `<div class="cm big">! ${esc(it.comment)}</div>` : ''}</div>`).join('')}`, ctx.paper);
}

export function cancelHTML(o, it, reason, ctx) {
  return page(`<div class="c xl">BEKOR</div><div class="r big"><span>№ ${esc(o.number ?? '')}</span><span>${o.table_id ? 'Stol ' + esc(ctx.tableName(o.table_id)) : ''}</span></div>
    <div class="hr"></div><div class="r big"><span>${esc(it.name)}</span><span>${qty(it.qty, it.unit === 'kg' ? 'kg' : '')}</span></div><div class="cm">${esc(reason)}</div>`, ctx.paper);
}

export function zReportHTML(shift, s, ctx, { final = false } = {}) {
  const r = (l, v) => `<div class="r"><span>${esc(l)}</span><span>${v}</span></div>`;
  return page(`<div class="c big">${esc(ctx.settings?.name || '')}</div><div class="c b">${final ? 'Z-HISOBOT (smena yopildi)' : 'X-HISOBOT (oraliq)'}</div>
    <div class="hr"></div>${r('Smena', '№ ' + esc(shift.number ?? ''))}${r('Ochildi', dateTime(shift.opened_at))}${shift.closed_at ? r('Yopildi', dateTime(shift.closed_at)) : ''}
    <div class="hr"></div>${r('Buyurtmalar', s.orders)}${r('Mehmonlar', s.guests)}${r('O\'rtacha chek', sum(s.avg_check))}
    ${r('Taomlar', sum(s.subtotal))}${r('Chegirma', '−' + sum(s.discount))}${r('Xizmat haqi', sum(s.service))}
    <div class="r big"><span>JAMI SAVDO</span><span>${sum(s.total)}</span></div><div class="hr"></div>
    ${Object.entries(s.by_method).filter(([, v]) => v).map(([k, v]) => r(PAY_NAMES[k], sum(v))).join('')}
    <div class="hr"></div>${r('Bekor qilingan taom', `${s.cancelled_items} ta · ${sum(s.cancelled_sum)}`)}${r('Bekor qilingan buyurtma', s.voided)}
    <div class="hr"></div>${r('Boshlang\'ich naqd', sum(shift.opening_cash))}${r('Naqd savdo', sum(s.by_method.naqd))}
    ${s.debt_paid?.naqd ? r('Qarz to\'lovi (naqd)', sum(s.debt_paid.naqd)) : ''}${s.cash_in ? r('Kassaga kirim', sum(s.cash_in)) : ''}
    ${s.cash_out ? r('Kassadan olindi', '−' + sum(s.cash_out)) : ''}${s.expenses ? r('Rasxodlar', '−' + sum(s.expenses)) : ''}
    ${s.supplier_paid ? r('Yetkazib beruvchiga', '−' + sum(s.supplier_paid)) : ''}
    <div class="r b"><span>Kassada bo'lishi kerak</span><span>${sum(s.expected_cash)}</span></div>
    ${s.counted_cash != null ? r('Sanaldi', sum(s.counted_cash)) + `<div class="r b"><span>Farq</span><span>${sum(s.diff)}</span></div>` : ''}`, ctx.paper);
}

/** Brauzer orqali chop etish — yashirin iframe. */
export function printHTML(html) {
  return new Promise((resolve) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.appendChild(f);
    f.onload = () => {
      setTimeout(() => {
        try { f.contentWindow.focus(); f.contentWindow.print(); } catch { /* */ }
        setTimeout(() => { f.remove(); resolve(); }, 1500);
      }, 60);
    };
    f.srcdoc = html;
  });
}

export async function print(html) {
  const cfg = printCfg();
  if (cfg.mode === 'off') return false;
  await printHTML(html);
  return true;
}
