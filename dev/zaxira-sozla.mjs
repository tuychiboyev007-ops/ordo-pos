/**
 * Kunlik zaxirani sozlash — bir marta: `node dev/zaxira-sozla.mjs`
 *
 * 1) Bazada faqat O'QIY oladigan kirish (ordo_zaxira) ochadi — zaxira kaliti sizib chiqsa ham
 *    bazani o'zgartirib bo'lmaydi. Parol shu yerda tasodifiy yaratiladi va ekranga chiqmaydi.
 * 2) Uning ulanish satrini GitHub'dagi yopiq repoga BACKUP_DATABASE_URL secret qilib yozadi.
 * 3) Birinchi zaxirani darhol ishga tushiradi (.github/workflows/zaxira.yml).
 *
 * Qayta ishga tushirilsa parol almashadi (eski kalit ishlamay qoladi) — kalit sizgan bo'lsa shu yo'l.
 * Kerak: .env.local (npx vercel env pull) va `gh` (GitHub'ga kirilgan).
 */
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import postgres from 'postgres';

const REPO = 'tuychiboyev007-ops/ordo-pos';
const ROLE = 'ordo_zaxira';

const env = {};
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
} catch { /* */ }
const ownerUrl = env.DATABASE_URL_UNPOOLED;
if (!ownerUrl) { console.error('.env.local da DATABASE_URL_UNPOOLED yo\'q. Avval: npx vercel env pull'); process.exit(1); }

const pass = randomBytes(24).toString('base64url');
const owner = postgres(ownerUrl, { prepare: false, onnotice: () => {}, max: 1 });
const exists = (await owner`SELECT 1 FROM pg_roles WHERE rolname = ${ROLE}`).length;
await owner.unsafe(`${exists ? 'ALTER' : 'CREATE'} ROLE ${ROLE} WITH LOGIN PASSWORD '${pass}'`);
await owner.unsafe(`GRANT pg_read_all_data TO ${ROLE}`);
await owner.unsafe(`ALTER ROLE ${ROLE} SET default_transaction_read_only = on`);
await owner.end();
console.log(`1. Faqat o'qiydigan kirish ${exists ? 'yangilandi' : 'ochildi'}`);

const u = new URL(ownerUrl);
u.username = ROLE; u.password = pass;
u.searchParams.delete('channel_binding');
const url = u.toString();

const ro = postgres(url, { prepare: false, onnotice: () => {}, max: 1 });
const n = (await ro`SELECT count(*)::int AS n FROM companies`)[0].n;
let wrote = false;
try { await ro.begin('read write', (t) => t`UPDATE companies SET name = name WHERE false`); wrote = true; } catch { /* kutilgani */ }
await ro.end();
if (wrote) { console.error('XATO: kirish bazaga yoza oldi — secret yozilmadi'); process.exit(1); }
console.log(`   tekshirildi: ${n} ta restoranni o'qiydi, yoza olmaydi`);

const s = spawnSync('gh', ['secret', 'set', 'BACKUP_DATABASE_URL', '-R', REPO], { input: url, encoding: 'utf8' });
if (s.status !== 0) { console.error('GitHub secret yozilmadi:', s.stderr || s.error?.message); process.exit(1); }
console.log('2. GitHub\'ga yozildi (BACKUP_DATABASE_URL)');

const w = spawnSync('gh', ['workflow', 'run', 'zaxira.yml', '-R', REPO], { encoding: 'utf8' });
console.log(w.status === 0 ? '3. Birinchi zaxira boshlandi — 2-3 daqiqada tayyor bo\'ladi' : '3. Zaxira ertaga 06:00 da o\'zi boshlanadi (hozir ishga tushmadi: ' + (w.stderr || '').trim() + ')');
