/**
 * Haqiqiy Postgres (Neon / Supabase) ulanishi — internetdagi nusxa uchun.
 * Mahalliy ishga tushirish PGlite'da (dev/server.mjs); SQL bir xil, farq faqat drayverda.
 */
import postgres from 'postgres';
import { createHash } from 'node:crypto';
import { makeDb, postgresClient } from './db.js';
import { SCHEMA, migrate } from './schema.js';

/**
 * postgres.js BIGINT (20) va NUMERIC (1700) ni MATN qilib qaytaradi, PGlite esa son.
 * Kod ularni JS son deb ishlatadi (`a + b`) — satr bo'lsa qo'shish o'rniga matn ulanardi.
 * Pul summalari 2^53 ga yetmaydi, shuning uchun Number xavfsiz.
 */
const OPTIONS = {
  prepare: false,          // pooler (pgbouncer) tayyorlangan so'rovni qo'llamaydi
  max: 1,
  fetch_types: false,
  connect_timeout: 15,
  idle_timeout: 20,
  onnotice: () => {},
  // Yozishda postgres.js parametr turini serverdan bilib, o'zining serializatorini qo'llaydi.
  // Standart holatda bular PGlite'dan farq qiladi — shuning uchun Postgres'ning o'z matn
  // qoidasiga qaytariladi (PGlite bilan bir xil):
  //  - json/jsonb: kod `doc = ?::jsonb` ga TAYYOR JSON matn beradi; standart JSON.stringify uni
  //    ikkinchi marta o'rab, buyurtma obyekt emas, satr bo'lib saqlanardi ("Buyurtma ochilmagan").
  //  - boolean: standart faqat `true` ni 't' qiladi, 1 / 'true' esa 'f' bo'lib ketardi.
  //  - sana: standart har qiymatni new Date() dan o'tkazadi — noto'g'ri satrda yiqiladi.
  types: {
    bigint: { to: 20, from: [20], parse: Number, serialize: (x) => String(x) },
    numeric: { to: 1700, from: [1700], parse: Number, serialize: (x) => String(x) },
    json: { to: 114, from: [114, 3802], parse: (x) => JSON.parse(x), serialize: (x) => (typeof x === 'string' ? x : JSON.stringify(x)) },
    boolean: { to: 16, from: [16], parse: (x) => x === 't', serialize: (x) => (typeof x === 'boolean' ? (x ? 't' : 'f') : String(x)) },
    date: { to: 1184, from: [1082, 1114, 1184], parse: (x) => new Date(x),
      serialize: (x) => (x instanceof Date ? x.toISOString() : typeof x === 'number' ? new Date(x).toISOString() : String(x)) },
  },
};

export const SCHEMA_VERSION = createHash('sha1').update(SCHEMA.join('\n')).digest('hex').slice(0, 16);

export function openDb(url) {
  const sql = postgres(url, OPTIONS);
  return { sql, db: makeDb(postgresClient(sql)) };
}

/**
 * Sxema o'zgargan bo'lsa (yangi versiya chiqqanda) migratsiya bir marta ishlaydi.
 * Har ishga tushishda 2 ta yengil so'rov; ikki nusxa bir vaqtda ishga tushsa
 * advisory lock ularni navbatga qo'yadi.
 */
export async function ensureSchema(db) {
  await db.run('CREATE TABLE IF NOT EXISTS ordo_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
  const row = await db.first("SELECT v FROM ordo_meta WHERE k = 'schema'");
  if (row?.v === SCHEMA_VERSION) return false;
  await db.tx(async (tx) => {
    await tx.run('SELECT pg_advisory_xact_lock(4310)');
    const again = await tx.first("SELECT v FROM ordo_meta WHERE k = 'schema'");
    if (again?.v === SCHEMA_VERSION) return;
    await migrate(tx);
    await tx.run("INSERT INTO ordo_meta (k, v) VALUES ('schema', ?) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v", SCHEMA_VERSION);
  });
  return true;
}
