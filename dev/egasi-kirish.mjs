/**
 * Restoran egasining kirish emaili va parolini almashtirish (internetdagi bazada): `node dev/egasi-kirish.mjs`
 *
 * Skript so'raydi: qaysi restoran, yangi email, yangi parol (yozganda ko'rinmaydi, ikki marta).
 * Parol HECH QAYERGA chiqarilmaydi va kodga yozilmaydi — uni faqat egasi shu yerda kiritadi.
 * Kassalar uzilmaydi (qurilma belgisi o'zgarmaydi); boshqaruvga PIN bilan qayta kiriladi.
 * Mazza Point bo'lsa mahalliy `seed.local.json` va `docs/LOCAL.md` ham yangilanadi (ikkalasi gitignore'da).
 *
 * `--sinov` — hech narsa yozmaydi, faqat nima o'zgarishini ko'rsatadi.
 * Kerak: .env.local (npx vercel env pull).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import readline from 'node:readline';
import postgres from 'postgres';
import { hashPassword } from '../src/lib/auth.js';

const DRY = process.argv.includes('--sinov');
const here = (p) => new URL(p, import.meta.url);

const env = {};
try {
  for (const line of readFileSync(here('../.env.local'), 'utf8').split('\n')) {
    const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
} catch { /* */ }
const url = env.DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('.env.local da DATABASE_URL yo\'q. Avval: npx vercel env pull'); process.exit(1); }

// Bitta readline: javoblar navbat bilan o'qiladi (terminalda ham, quvurdan berilganda ham).
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
let hidden = false;
const write = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => { if (!hidden) write(s); else if (/[\r\n]/.test(s)) write('\n'); };   // parol yozilganda ekranga chiqmaydi
const lines = []; const waiters = []; let closed = false;
rl.on('line', (l) => { const w = waiters.shift(); if (w) w(l); else lines.push(l); });
rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(null); });
const ask = (q, secret = false) => new Promise((res) => {
  process.stdout.write(q); hidden = secret;
  const done = (l) => { hidden = false; if (secret && !process.stdin.isTTY) process.stdout.write('\n'); res(l === null ? null : String(l).trim()); };
  if (lines.length) done(lines.shift()); else if (closed) done(null); else waiters.push(done);   // kirish tugagan bo'lsa kutib qolmaydi
});
const stop = async (msg, sql) => { console.error('\n' + msg); rl.close(); if (sql) await sql.end({ timeout: 3 }); process.exit(1); };

const sql = postgres(url, { prepare: false, onnotice: () => {}, max: 1 });
// Internet bir lahza uzilsa (telefon orqali ulanishda nom topilmay qoladi) skript yiqilmasin — bir necha marta urinadi.
let owners;
for (let i = 1; ; i++) {
  try {
    owners = await sql`SELECT u.id, u.company_id, u.email, c.name FROM users u JOIN companies c ON c.id = u.company_id
      WHERE u.role = 'owner' AND u.active ORDER BY c.id, u.id`;
    break;
  } catch (e) {
    if (i >= 5) await stop(`Bazaga ulanib bo'lmadi (${e.code || e.message}). Internetni tekshirib, buyruqni qayta ishga tushiring.`, sql);
    console.log(`Bazaga ulanmoqda... (${i}-urinish)`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}
if (!owners.length) await stop('Bazada restoran egasi topilmadi.', sql);

console.log(DRY ? 'SINOV rejimi — hech narsa yozilmaydi.\n' : '');
console.log('Restoranlar:');
owners.forEach((o, i) => console.log(`  ${i + 1}) ${o.name} — hozirgi email: ${o.email || '(yo\'q)'}`));
const def = Math.max(0, owners.findIndex((o) => /mazza/i.test(o.name))) + 1;
const pick = await ask(`\nQaysi restoran? [${def}]: `);
const o = owners[(Number(pick) || def) - 1];
if (!o) await stop('Bunday raqam yo\'q.', sql);

const emailIn = await ask(`Yangi email [${o.email || ''}]: `);
const email = (emailIn || o.email || '').toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) await stop('Email noto\'g\'ri yozilgan.', sql);
const taken = await sql`SELECT 1 FROM users WHERE lower(email) = ${email} AND id <> ${o.id}`;
if (taken.length) await stop('Bu email boshqa xodimda band.', sql);

const p1 = await ask('Yangi parol (kamida 8 belgi, yozganda ko\'rinmaydi): ', true);
if (!p1 || p1.length < 8) await stop('Parol kamida 8 belgi bo\'lishi kerak.', sql);
const p2 = await ask('Parolni yana bir bor: ', true);
if (p1 !== p2) await stop('Parollar bir xil emas — hech narsa o\'zgarmadi.', sql);
rl.close();

if (DRY) {
  console.log(`\n(sinov) "${o.name}" egasining emaili "${email}" bo'lardi, parol ${p1.length} belgili yangi parolga almashardi.`);
} else {
  const hash = await hashPassword(p1);
  await sql`UPDATE users SET email = ${email}, password_hash = ${hash}, token_version = token_version + 1 WHERE id = ${o.id} AND company_id = ${o.company_id}`;
  await sql`DELETE FROM login_attempts WHERE company_id = ${o.company_id}`;   // eski xato urinishlar yangi kirishni to'smasin
  console.log(`\n1. "${o.name}" — kirish emaili va paroli almashtirildi`);
  // Mahalliy yozuvlar (gitignore'da): keyingi sinovlar va eslatma fayli yangi ma'lumot bilan ishlasin.
  if (/mazza/i.test(o.name)) {
    try {
      const f = here('../seed.local.json');
      const s = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
      writeFileSync(f, JSON.stringify({ ...s, email, password: p1 }, null, 2) + '\n');
      console.log('2. seed.local.json yangilandi');
    } catch (e) { console.log('2. seed.local.json yangilanmadi:', e.message); }
    try {
      const f = here('../docs/LOCAL.md'); const t = readFileSync(f, 'utf8');
      const n = t.replace(/^(\|\s*Mazza Point\s*\|)[^|]*(\|.*)$/m, (_, a, b) => `${a} ${email} / ${p1} ${b}`);
      if (n !== t) { writeFileSync(f, n); console.log('3. docs/LOCAL.md dagi qator yangilandi'); }
    } catch { /* fayl bo'lmasa — o'tkazib yuboriladi */ }
  }
  console.log('\nTayyor. Kirish: https://ordo-kassa.vercel.app — yangi email va parol bilan.');
}
await sql.end({ timeout: 3 });
