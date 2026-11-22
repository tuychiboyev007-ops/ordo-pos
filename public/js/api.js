/** Server bilan aloqa. Qurilma belgisi — localStorage, boshqaruv sessiyasi — sessionStorage. */
const KEY = { device: 'ordo.device', session: 'ordo.session' };

export const deviceToken = () => { try { return localStorage.getItem(KEY.device); } catch { return null; } };
export const setDeviceToken = (t) => { try { t ? localStorage.setItem(KEY.device, t) : localStorage.removeItem(KEY.device); } catch { /* */ } };
export const sessionToken = () => { try { return sessionStorage.getItem(KEY.session); } catch { return null; } };
export const setSession = (t, user) => {
  try {
    if (t) { sessionStorage.setItem(KEY.session, t); sessionStorage.setItem('ordo.sessionUser', JSON.stringify(user || null)); }
    else { sessionStorage.removeItem(KEY.session); sessionStorage.removeItem('ordo.sessionUser'); }
  } catch { /* */ }
};
export const sessionUser = () => { try { return JSON.parse(sessionStorage.getItem('ordo.sessionUser') || 'null'); } catch { return null; } };

export class ApiError extends Error {
  constructor(message, { status = 0, code = '', offline = false } = {}) { super(message); Object.assign(this, { status, code, offline }); }
}

export async function api(path, { method = 'GET', body, auth = 'device', timeout = 15000 } = {}) {
  const token = auth === 'session' ? sessionToken() : auth === 'device' ? deviceToken() : null;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(path, {
      method, signal: ctl.signal, cache: 'no-store',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(navigator.onLine === false ? 'Internet yo\'q' : 'Server javob bermadi', { offline: true });
  } finally { clearTimeout(t); }
  let data = {};
  try { data = await res.json(); } catch { /* */ }
  if (!res.ok || data.ok === false) throw new ApiError(data.message || `Xato (${res.status})`, { status: res.status, code: data.error });
  return data;
}

export const get = (p, o) => api(p, o);
let posting = 0;
/** Hozir serverga ketayotgan yozish so'rovlari soni (ikki marta bosishdan himoya uchun). */
export const postsInFlight = () => posting;
export const post = async (p, body, o = {}) => { posting++; try { return await api(p, { ...o, method: 'POST', body }); } finally { posting--; } };
