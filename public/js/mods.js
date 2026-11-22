/**
 * Qo'shimchalar (pishloq, sous, piyozsiz...) — kassa va ofitsiant ilovasi uchun umumiy tanlash oynasi.
 */
import { esc, sum, icon, toast, openModal } from './ui.js';

/** Taomga tegishli qo'shimcha guruhlari. */
export const modsFor = (boot, pid) => (boot?.modgroups || []).filter((g) => g.product_ids.includes(pid) && g.mods.length);

/** Qo'shimchalarni tanlash: majburiy guruhdan bittasi, ixtiyoriylardan istalgancha. */
export function pickMods(boot, p, { qty: q0 = 1, current = null } = {}) {
  const groups = modsFor(boot, p.id);
  const sel = new Set((current || []).map((m) => m.id));
  const editing = !!current;
  return openModal({
    title: `${p.name} — qo'shimchalar`, size: 'wide',
    body: `<div class="mpick">${groups.map((g) => `<section class="mg" data-g="${g.id}"><h4>${esc(g.name)}<small>${g.required ? 'majburiy · ' : ''}${g.multi ? 'bir nechtasini tanlash mumkin' : 'bittasini tanlang'}</small></h4>
        <div class="mgrid">${g.mods.map((m) => `<button class="mtile" data-mod="${m.id}" data-g="${g.id}"><span>${esc(m.name)}</span><b>${m.price ? '+ ' + sum(m.price) : 'bepul'}</b></button>`).join('')}</div></section>`).join('')}
      ${!editing && p.unit !== 'kg' ? `<div class="mqty"><span>Soni</span><button data-qm="-">${icon('minus')}</button><b data-q>${q0}</b><button data-qm="+">${icon('plus')}</button></div>` : ''}</div>`,
    foot: `<span class="mtot" data-tot></span><button class="btn" data-x>Bekor</button><button class="btn pay lg" data-ok>${editing ? 'Saqlash' : 'Qo\'shish'}</button>`,
    onOpen: (m, close) => {
      let q = q0;
      const all = new Map(groups.flatMap((g) => g.mods.map((x) => [x.id, { ...x, g }])));
      const draw = () => {
        m.querySelectorAll('.mtile').forEach((b) => b.classList.toggle('on', sel.has(Number(b.dataset.mod))));
        const per = p.price + [...sel].reduce((s_, id) => s_ + (all.get(id)?.price || 0), 0);
        m.querySelector('[data-tot]').innerHTML = `${sum(per)}${q > 1 ? ` × ${q} = <b>${sum(per * q)}</b>` : ''}`;
        const qb = m.querySelector('[data-q]'); if (qb) qb.textContent = q;
      };
      m.querySelectorAll('.mtile').forEach((b) => b.onclick = () => {
        const id = Number(b.dataset.mod); const g = all.get(id).g;
        if (sel.has(id)) sel.delete(id);
        else { if (!g.multi) g.mods.forEach((x) => sel.delete(x.id)); sel.add(id); }
        draw();
      });
      m.querySelectorAll('[data-qm]').forEach((b) => b.onclick = () => { q = Math.max(1, q + (b.dataset.qm === '+' ? 1 : -1)); draw(); });
      m.querySelector('[data-ok]').onclick = () => {
        const miss = groups.find((g) => g.required && !g.mods.some((x) => sel.has(x.id)));
        if (miss) { toast(`«${miss.name}» — tanlash shart`, 'bad'); m.querySelector(`.mg[data-g="${miss.id}"]`)?.classList.add('need'); return; }
        const mods = groups.flatMap((g) => g.mods.filter((x) => sel.has(x.id)).map((x) => ({ id: x.id, name: x.name, price: x.price })));
        close({ mods, qty: q });
      };
      draw();
    },
  });
}

