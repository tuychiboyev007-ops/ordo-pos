/**
 * Restoran egasining kirish emaili va parolini almashtirish (internetdagi bazada).
 *
 *   node dev/egasi-kirish.mjs                                — hammasini so'raydi
 *   node dev/egasi-kirish.mjs yangi@email.uz                 — faqat parolni so'raydi (ikki marta)
 *   node dev/egasi-kirish.mjs yangi@email.uz --parol-yarat   — parolni O'ZI yaratadi, hech narsa so'ramaydi
 *
 * Parol HECH QAYERGA chiqarilmaydi (terminalga ham) va kodga yozilmaydi. O'zi yaratilgan parol clipboard'ga
 * nusxalanadi (kirish oynasida Cmd+V) va `docs/LOCAL.md` ga yoziladi (gitignore'da, faqat shu kompyuterda).
 * Kassalar uzilmaydi (qurilma belgisi o'zgarmaydi); boshqaruvga PIN bilan qayta kiriladi.
 * Mazza Point bo'lsa mahalliy `seed.local.json` ham yangilanadi — jonli sinov shundan o'qiydi.
 *
 * `--restoran=2` — ro'yxatdagi boshqa restoran (standart — Mazza Point).
 * `--sinov`      — hech narsa yozmaydi, faqat nima o'zgarishini ko'rsatadi.
 * Kerak: .env.local (npx vercel env pull).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import readline from 'node:readline';
import postgres from 'postgres';
import { hashPassword, checkPassword } from '../src/lib/auth.js';

const ARGS = process.argv.slice(2);
const DRY = ARGS.includes('--sinov');
const GEN = ARGS.includes('--parol-yarat');
const ARG_EMAIL = ARGS.find((a) => !a.startsWith('--') && a.includes('@')) || '';
const ARG_PICK = Number((ARGS.find((a) => a.startsWith('--restoran=')) || '').split('=')[1]) || 0;
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
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY, prompt: '' });
let hidden = false;
const write = rl._writeToOutput.bind(rl);
// Parol yozilganda harflar o'rniga yulduzcha chiqadi. Oyna o'lchami o'zgarsa readline qatorni qayta chizadi —
// savol `prompt`da turgani uchun yo'qolmaydi (ilgari savol o'rnida yolg'iz ">" qolib, nima so'ralgani bilinmasdi).
rl._writeToOutput = (s) => {
  if (!hidden) return write(s);
  const p = rl.getPrompt();
  if (p && s.startsWith(p)) return write(p + '*'.repeat([...s.slice(p.length)].length));
  if (/[\r\n]/.test(s)) return write('\n');
  write('*'.repeat([...s].length));
};
const lines = []; const waiters = []; let closed = false;
rl.on('line', (l) => { const w = waiters.shift(); if (w) w(l); else lines.push(l); });
rl.on('close', () => { closed = true; while (waiters.length) waiters.shift()(null); });
const ask = (q, secret = false) => new Promise((res) => {
  const done = (l) => {
    hidden = false; if (!closed) rl.setPrompt('');
    if (secret && !process.stdin.isTTY) process.stdout.write('\n');
    res(l === null ? null : String(l).trim());
  };
  hidden = false;
  if (closed) { process.stdout.write(q); return done(lines.length ? lines.shift() : null); }   // kirish tugagan bo'lsa kutib qolmaydi
  rl.setPrompt(q); rl.prompt(); hidden = secret;
  if (lines.length) done(lines.shift()); else waiters.push(done);
});
const stop = async (msg, sql) => { console.error('\n' + msg); rl.close(); if (sql) await sql.end({ timeout: 3 }); process.exit(1); };

// O'zi yaratiladigan parol: o'qib terish oson bo'g'inlar + 4 raqam (taxminan 2^51 variant). Qolip ochiq bo'lsa ham
// topib bo'lmaydi; kirishda xato urinishlar serverda cheklangan.
const CONS = 'bdfghjklmnprstvz', VOW = 'aeiou';
const word = (n) => Array.from({ length: n }, () => CONS[randomInt(CONS.length)] + VOW[randomInt(VOW.length)]).join('');
const makePassword = (prefix) => `${prefix}-${word(3)}-${word(3)}-${String(randomInt(10000)).padStart(4, '0')}`;

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
const def = Math.max(0, owners.findIndex((o) => /mazza/i.test(o.name))) + 1;
let o;
if (ARG_EMAIL || ARG_PICK || GEN) {
  // Email buyruqda berilgan — restoran so'ralmaydi (standart Mazza Point, boshqasi `--restoran=N`).
  o = owners[(ARG_PICK || def) - 1];
  if (!o) await stop('Bunday raqamli restoran yo\'q.', sql);
  console.log(`Restoran: ${o.name} — hozirgi email: ${o.email || '(yo\'q)'}`);
} else {
  console.log('Restoranlar:');
  owners.forEach((x, i) => console.log(`  ${i + 1}) ${x.name} — hozirgi email: ${x.email || '(yo\'q)'}`));
  console.log('');
  const pick = await ask(`Qaysi restoran? [${def}]: `);
  o = owners[(Number(pick) || def) - 1];
  if (!o) await stop('Bunday raqam yo\'q.', sql);
}

const emailIn = ARG_EMAIL || (GEN ? '' : await ask(`Yangi email [${o.email || ''}]: `));
const email = (emailIn || o.email || '').toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) await stop('Email noto\'g\'ri yozilgan.', sql);
const taken = await sql`SELECT 1 FROM users WHERE lower(email) = ${email} AND id <> ${o.id}`;
if (taken.length) await stop('Bu email boshqa xodimda band.', sql);
if (ARG_EMAIL) console.log(`Yangi email: ${email}`);

let pw;
if (GEN) {
  pw = makePassword(/mazza/i.test(o.name) ? 'Mazza' : 'Ordo');
} else {
  const p1 = await ask('Yangi parol (kamida 8 belgi; harflar o\'rniga * chiqadi): ', true);
  if (!p1 || p1.length < 8) await stop('Parol kamida 8 belgi bo\'lishi kerak.', sql);
  const p2 = await ask('Parolni yana bir bor: ', true);
  if (p1 !== p2) await stop('Parollar bir xil emas — hech narsa o\'zgarmadi.', sql);
  pw = p1;
}
rl.close();

const hash = await hashPassword(pw);
if (!(await checkPassword(pw, hash))) await stop('Parol xeshi tekshiruvdan o\'tmadi — hech narsa o\'zgarmadi.', sql);

if (DRY) {
  console.log(`\n(sinov) "${o.name}" egasining emaili "${email}" bo'lardi, parol ${pw.length} belgili yangi parolga almashardi`
    + (GEN ? ' (o\'zi yaratilgan; clipboard va docs/LOCAL.md ga yozilardi).' : '.'));
} else {
  await sql`UPDATE users SET email = ${email}, password_hash = ${hash}, token_version = token_version + 1 WHERE id = ${o.id} AND company_id = ${o.company_id}`;
  await sql`DELETE FROM login_attempts WHERE company_id = ${o.company_id}`;   // eski xato urinishlar yangi kirishni to'smasin
  // Bazadan qayta o'qib tekshiriladi: yozilgan xesh aynan shu parolniki va email o'zgargan bo'lishi shart.
  const [back] = await sql`SELECT email, password_hash FROM users WHERE id = ${o.id}`;
  const good = back && back.email === email && await checkPassword(pw, back.password_hash);
  console.log(`\n1. "${o.name}" — kirish emaili va paroli almashtirildi${good ? ' (bazadan qayta o\'qib tekshirildi)' : ''}`);
  if (!good) console.log('   DIQQAT: qayta tekshiruv o\'tmadi — buyruqni yana bir bor ishga tushiring.');

  // Mahalliy yozuvlar (gitignore'da): keyingi sinovlar va eslatma fayli yangi ma'lumot bilan ishlasin.
  let saved = false;
  if (/mazza/i.test(o.name)) {
    try {
      const f = here('../seed.local.json');
      const s = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : {};
      writeFileSync(f, JSON.stringify({ ...s, email, password: pw }, null, 2) + '\n');
      console.log('2. seed.local.json yangilandi');
    } catch (e) { console.log('2. seed.local.json yangilanmadi:', e.message); }
  }
  try {
    const f = here('../docs/LOCAL.md');
    const t = existsSync(f) ? readFileSync(f, 'utf8') : '# Kirish ma\'lumotlari (faqat shu kompyuterda, gitignore)\n';
    const name = o.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let n = t.replace(new RegExp(`^(\\|\\s*${name}\\s*\\|)[^|]*(\\|.*)$`, 'm'), (_, a, b) => `${a} ${email} / ${pw} ${b}`);
    if (n === t) n = t.replace(/\n*$/, '\n') + `\n${o.name} — kirish: ${email} / ${pw}\n`;   // jadvalda qatori yo'q bo'lsa oxiriga yoziladi
    writeFileSync(f, n); saved = true;
    console.log('3. docs/LOCAL.md ga yozildi');
  } catch (e) { console.log('3. docs/LOCAL.md ga yozilmadi:', e.message); }

  let copied = false;
  if (GEN) {
    try { copied = spawnSync('pbcopy', { input: pw }).status === 0; } catch { /* macOS emas */ }
    if (copied) console.log('4. Yangi parol clipboard\'ga nusxalandi — kirish oynasida "Parol" maydoniga Cmd+V bosing');
    // Parol hech qayerga saqlanmagan bo'lsa yo'qolib ketmasin — faqat shu holatda ekranga chiqadi.
    if (!copied && !saved) console.log(`4. Parolni saqlab bo'lmadi, shu yerdan yozib oling: ${pw}`);
  }

  console.log('\nTayyor. Kirish: https://ordo-kassa.vercel.app');
  console.log(`  Email: ${email}`);
  if (GEN) console.log(`  Parol: ${copied ? 'clipboard\'da (Cmd+V) va ' : ''}docs/LOCAL.md faylida — ko'rish: open ~/Downloads/ordo-pos/docs/LOCAL.md`);
}
await sql.end({ timeout: 3 });
