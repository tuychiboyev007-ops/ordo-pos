/**
 * Internetdagi bazani tayyorlash: `DATABASE_URL=... node dev/remote.mjs`
 *
 * Bo'sh bazaga Mazza Point va namunaviy restoranni qo'shadi. Ma'lumot avval shu kompyuterda
 * (PGlite, xotirada) yaratiladi va bazaga COPY bilan bir yo'la ko'chiriladi: namunaviy
 * restoranning minglab yozuvini bittalab yuborish uzoq yo'lda soatlab cho'zilardi.
 * Mazza kirish ma'lumotlari seed.local.json dan (faqat shu kompyuterda).
 */
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { PGlite } from '@electric-sql/pglite';
import { makeDb, pgliteClient } from '../src/lib/db.js';
import { migrate } from '../src/lib/schema.js';
import { openDb, ensureSchema } from '../src/lib/pg.js';
import { seedDemo } from '../src/lib/demo.js';
import { seedMazza } from '../src/lib/mazza.js';

if (!process.env.DATABASE_URL) { console.error('DATABASE_URL kerak'); process.exit(1); }
const { sql, db } = openDb(process.env.DATABASE_URL);
try {
  const t0 = Date.now();
  console.log('sxema:', (await ensureSchema(db)) ? 'yangilandi' : 'o\'zgarmagan');
  const n = (await db.first('SELECT COUNT(*)::int AS n FROM companies /* tenant:global */')).n;
  if (n) { console.log(`bazada ${n} ta restoran bor — hech narsa qo'shilmadi`); process.exit(0); }

  const pg = new PGlite();
  const local = makeDb(pgliteClient(pg));
  await migrate(local);
  await seedMazza(local);
  if (!process.argv.includes('--no-demo')) await seedDemo(local);
  console.log(`mahalliy nusxa tayyor (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  // Jadvallar yaratilish tartibida (ota jadval bolasidan oldin)
  const tables = (await pg.query(`SELECT c.relname AS t FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
    WHERE c.relkind = 'r' AND s.nspname = 'public' ORDER BY c.oid`)).rows.map((r) => r.t).filter((t) => t !== 'ordo_meta');
  let rows = 0;
  await sql.begin(async (tx) => {
    for (const t of tables) {
      const cols = (await pg.query(`SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, [t])).rows.map((r) => `"${r.c}"`).join(', ');
      const cnt = (await pg.query(`SELECT COUNT(*)::int AS n FROM "${t}"`)).rows[0].n;
      if (!cnt) continue;
      const out = await pg.query(`COPY "${t}" (${cols}) TO '/dev/blob'`);
      const buf = Buffer.from(await out.blob.arrayBuffer());
      await pipeline(Readable.from([buf]), await tx.unsafe(`COPY "${t}" (${cols}) FROM STDIN`).writable());
      rows += cnt;
    }
    // serial hisoblagichlari ko'chirilgan eng katta id dan davom etsin
    const seqs = await tx.unsafe(`SELECT table_name AS t, column_name AS c FROM information_schema.columns
      WHERE table_schema = 'public' AND column_default LIKE 'nextval(%'`);
    for (const { t, c } of seqs) await tx.unsafe(`SELECT setval(pg_get_serial_sequence('"${t}"', '${c}'), COALESCE((SELECT MAX("${c}") FROM "${t}"), 0) + 1, false)`);
  });
  await pg.close();
  console.log(`${tables.length} jadval, ${rows} yozuv ko'chirildi — jami ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} finally {
  await sql.end({ timeout: 5 });
}
