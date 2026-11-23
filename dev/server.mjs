/**
 * Mahalliy ishga tushirish: `npm run dev` (yoki `npm run demo` — bazani tozalab namunaviy restoran bilan).
 * Baza — PGlite (haqiqiy Postgres, fayl .data/pg ichida), API — xuddi Cloudflare Worker'dagi handle().
 */
import http from 'node:http';
import { readFile, stat, rm, mkdir } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { makeDb, pgliteClient } from '../src/lib/db.js';
import { migrate } from '../src/lib/schema.js';
import { handle } from '../src/app.js';
import { seedDemo } from '../src/lib/demo.js';
import { seedMazza } from '../src/lib/mazza.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUB = join(ROOT, 'public');
const PORT = Number(process.env.PORT || 4310);
const env = { AUTH_SECRET: process.env.AUTH_SECRET || 'dev-secret-ordo-0123456789', SETUP_OPEN: process.env.SETUP_OPEN || '' };

const dataDir = process.env.ORDO_DATA || join(ROOT, '.data', 'pg');
if (process.argv.includes('--reset-demo')) await rm(join(ROOT, '.data'), { recursive: true, force: true });
await mkdir(join(ROOT, '.data'), { recursive: true });
const pg = new PGlite(dataDir);
const db = makeDb(pgliteClient(pg));
await migrate(db);
const has = await db.first('SELECT COUNT(*)::int AS n FROM companies /* tenant:global */');
if (!has.n) {
  const t = Date.now();
  await seedDemo(db);
  await seedMazza(db);
  console.log(`namunaviy restoran va Mazza Point yaratildi (${((Date.now() - t) / 1000).toFixed(1)} s)`);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const PAGES = { '/': 'index.html', '/kassa': 'kassa.html', '/boshqaruv': 'admin.html', '/ofitsiant': 'ofitsiant.html', '/oshxona': 'oshxona.html' };

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = [];
      for await (const ch of req) chunks.push(ch);
      const r = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks) });
      const out = await handle(r, env, db);
      res.writeHead(out.status, Object.fromEntries(out.headers));
      res.end(Buffer.from(await out.arrayBuffer()));
      return;
    }
    let file = PAGES[url.pathname] || decodeURIComponent(url.pathname).replace(/^\/+/, '');
    file = normalize(file).replace(/^(\.\.[/\\])+/, '');
    const path = join(PUB, file);
    if (!path.startsWith(PUB) || !(await stat(path).catch(() => null))?.isFile()) { res.writeHead(404); res.end('topilmadi'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(await readFile(path));
  } catch (e) {
    console.error(e);
    res.writeHead(500); res.end('xato');
  }
});
server.listen(PORT, () => console.log(`ordo: http://localhost:${PORT}
  kirish (email, parol, PIN): docs/LOCAL.md`));
