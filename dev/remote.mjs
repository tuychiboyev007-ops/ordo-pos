/**
 * Internetdagi bazani tayyorlash: `DATABASE_URL=... node dev/remote.mjs`
 * Sxemani yaratadi/yangilaydi; baza bo'sh bo'lsa Mazza Point va namunaviy restoranni qo'shadi.
 * Mazza kirish ma'lumotlari seed.local.json dan (faqat shu kompyuterda).
 */
import { openDb, ensureSchema } from '../src/lib/pg.js';
import { seedDemo } from '../src/lib/demo.js';
import { seedMazza } from '../src/lib/mazza.js';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL kerak'); process.exit(1); }
const { sql, db } = openDb(process.env.DATABASE_URL);
try {
  const t0 = Date.now();
  console.log('sxema:', (await ensureSchema(db)) ? 'yangilandi' : 'o\'zgarmagan');
  const n = (await db.first('SELECT COUNT(*)::int AS n FROM companies /* tenant:global */')).n;
  if (n) console.log(`bazada ${n} ta restoran bor — namuna qo'shilmadi`);
  else {
    await seedMazza(db); console.log('Mazza Point qo\'shildi');
    if (!process.argv.includes('--no-demo')) { await seedDemo(db); console.log('namunaviy restoran qo\'shildi'); }
  }
  console.log(`tayyor (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
} finally {
  await sql.end({ timeout: 5 });
}
