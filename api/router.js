/**
 * Vercel funksiyasi — hamma /api/* shu yerga keladi (vercel.json rewrite, asl yo'l `__p` da).
 * Ulanish nusxa (instance) yashagan davomida qayta ishlatiladi.
 */
import { handle } from '../src/app.js';
import { openDb, ensureSchema } from '../src/lib/pg.js';

let conn = null;
let ready = null;

function getDb() {
  if (!conn) conn = openDb(process.env.DATABASE_URL);
  if (!ready) ready = ensureSchema(conn.db).catch((e) => { ready = null; throw e; });
  return ready.then(() => conn.db);
}

export function restorePath(url) {
  const u = new URL(url || '/', 'http://x');
  const p = u.searchParams.get('__p');
  if (p === null) return u.pathname + u.search;
  u.searchParams.delete('__p');
  const q = u.searchParams.toString();
  return `/api/${p.replace(/^\/+/, '')}${q ? `?${q}` : ''}`;
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  if (req.body != null) {
    if (Buffer.isBuffer(req.body)) return req.body;
    if (typeof req.body === 'string') return Buffer.from(req.body);
    return Buffer.from(JSON.stringify(req.body));
  }
  const chunks = [];
  for await (const ch of req) chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

const DROP = new Set(['content-length', 'content-encoding', 'transfer-encoding', 'connection']);

export default async function handler(req, res) {
  const send = (status, obj) => {
    res.statusCode = status;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify(obj));
  };
  if (!process.env.DATABASE_URL || !process.env.AUTH_SECRET) return send(500, { error: 'not_configured', message: 'Server sozlanmagan' });
  try {
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) {
      if (v == null || DROP.has(k)) continue;
      if (Array.isArray(v)) v.forEach((x) => headers.append(k, x)); else headers.set(k, v);
    }
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const r = new Request(`https://${host}${restorePath(req.url)}`, { method: req.method, headers, body: await readBody(req) });
    const db = await getDb();
    const out = await handle(r, { AUTH_SECRET: process.env.AUTH_SECRET, SETUP_OPEN: '' }, db);
    res.statusCode = out.status;
    for (const [k, v] of out.headers) if (k !== 'transfer-encoding') res.setHeader(k, v);
    if (!out.headers.has('cache-control')) res.setHeader('cache-control', 'no-store');
    res.end(Buffer.from(await out.arrayBuffer()));
  } catch (e) {
    console.error(req.method, req.url, e);
    // Ulanish uzilgan bo'lsa keyingi so'rov yangisini ochsin
    if (/CONNECTION|ECONNRESET|terminat/i.test(String(e?.code || e?.message))) { try { conn?.sql.end({ timeout: 1 }); } catch {} conn = null; ready = null; }
    send(500, { error: 'server', message: 'Serverda xatolik yuz berdi' });
  }
}
