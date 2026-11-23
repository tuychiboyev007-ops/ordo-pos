export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });
}

export function fail(status, code, message) {
  return json({ ok: false, error: code, message: message || code }, status);
}

export async function body(req) {
  // Buzuq JSON ham, `null`/satr/son ham bo'sh obyekt: yo'llar `b.maydon` deb o'qiydi va 500 bermasligi kerak.
  try { const v = await req.json(); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

export const str = (v, max = 200) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null; };
export const int = (v, d = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : d; };
export const bool = (v) => v === true || v === 'true' || v === 1 || v === '1';
export const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

/** Toshkent kuni oralig'i → UTC vaqtlari [from, to). */
export function dayRange(from, to) {
  const f = new Date(Date.parse(from + 'T00:00:00Z') - 5 * 3600e3).toISOString();
  const t = new Date(Date.parse(to + 'T00:00:00Z') + 24 * 3600e3 - 5 * 3600e3).toISOString();
  return [f, t];
}
