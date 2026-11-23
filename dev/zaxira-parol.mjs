/**
 * Kunlik zaxirani shifrlash paroli — bir marta: `node dev/zaxira-parol.mjs`
 *
 * Repo ochiq bo'lgani uchun zaxira GitHub'da faqat shifrlangan holda saqlanadi (zaxira.yml).
 * Bu skript tasodifiy parol yaratadi, uni GitHub'ga BACKUP_PASSPHRASE secret qilib yozadi va
 * SHU KOMPYUTERDAGI docs/LOCAL.md ga qo'shadi (gitignore'da). Parol ekranga chiqmaydi.
 * Parol yo'qolsa eski zaxiralarni ochib bo'lmaydi — docs/LOCAL.md ni saqlang.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const REPO = 'tuychiboyev007-ops/ordo-pos';
const LOCAL = new URL('../docs/LOCAL.md', import.meta.url);
let old = '';
try { old = readFileSync(LOCAL, 'utf8'); } catch { /* yo'q */ }
if (/^Zaxira shifrlash paroli:/m.test(old) && !process.argv.includes('--yangi')) {
  console.log('Parol allaqachon bor (docs/LOCAL.md). Almashtirish uchun: node dev/zaxira-parol.mjs --yangi');
  process.exit(0);
}
const pass = randomBytes(24).toString('base64url');
const s = spawnSync('gh', ['secret', 'set', 'BACKUP_PASSPHRASE', '-R', REPO], { input: pass, encoding: 'utf8' });
if (s.status !== 0) { console.error('GitHub secret yozilmadi:', s.stderr || s.error?.message); process.exit(1); }
const day = new Date().toISOString().slice(0, 10);
appendFileSync(LOCAL, `\n## Kunlik zaxira (${day})\n\nZaxira shifrlash paroli: ${pass}\nOchish: gpg -d ordo-YYYY-MM-DD.sql.gz.gpg | gunzip > tiklash.sql\n`);
console.log('1. GitHub\'ga yozildi (BACKUP_PASSPHRASE)');
console.log('2. Parol docs/LOCAL.md ga yozildi — shu faylni saqlang, usiz zaxirani ochib bo\'lmaydi');
const w = spawnSync('gh', ['workflow', 'run', 'zaxira.yml', '-R', REPO], { encoding: 'utf8' });
console.log(w.status === 0 ? '3. Shifrlangan zaxira boshlandi — 2-3 daqiqada tayyor' : '3. Zaxira ertaga 06:00 da o\'zi boshlanadi');
