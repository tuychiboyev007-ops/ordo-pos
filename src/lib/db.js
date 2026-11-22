/**
 * Baza ustidagi yupqa qatlam (TopAgents'dagi bilan bir xil g'oya).
 * `?` o'rin belgilari `$1, $2…` ga o'giriladi; restoranga tegishli jadvalga
 * company_id siz tegadigan so'rov bajarilmaydi — bir restoran ikkinchisining
 * buyurtmasini jimgina ko'rib qolmasin.
 */
import { TENANT_TABLES } from './schema.js';

export function positional(text) {
  let n = 0;
  return text.replace(/\?/g, () => '$' + (++n));
}

const TENANT = new Set(TENANT_TABLES);
const TABLE_AT = /\b(?:from|join|into|update)\s+"?([a-z_][a-z0-9_]*)"?/gi;
const DDL = /^\s*(?:create|alter|drop|do|begin|commit|rollback)\b/i;

export function tenantCheck(text) {
  if (/tenant:global/i.test(text) || DDL.test(text)) return null;
  const tables = new Set();
  for (const [, name] of text.matchAll(TABLE_AT)) if (TENANT.has(name.toLowerCase())) tables.add(name.toLowerCase());
  if (!tables.size) return null;
  const ins = /^\s*insert\s+into\s+"?([a-z_][a-z0-9_]*)"?\s*\(([^)]*)\)/i.exec(text);
  if (ins && TENANT.has(ins[1].toLowerCase())) return /\bcompany_id\b/i.test(ins[2]) ? null : `INSERT INTO ${ins[1]} — company_id yo'q`;
  return /\bcompany_id\b/i.test(text) ? null : `${[...tables].join(', ')} — company_id bilan cheklanmagan`;
}

/** client — { query(text, params) → rows, transaction(fn) } */
export function makeDb(client) {
  const run = (text, ...params) => {
    const problem = tenantCheck(text);
    if (problem) throw Object.assign(new Error(`tenant scope: ${problem}`), { code: 'NO_TENANT_SCOPE' });
    return client.query(positional(text), params);
  };
  return {
    all: run,
    run,
    first: async (text, ...p) => (await run(text, ...p))[0] ?? null,
    tx: (fn) => client.transaction((c) => fn(makeDb(c))),
  };
}

/** PGlite → client. */
export function pgliteClient(pg) {
  const wrap = (q) => ({
    query: async (text, params) => (await q.query(text, params)).rows,
    transaction: (fn) => q.transaction((tx) => fn(wrap(tx))),
  });
  return wrap(pg);
}

/** postgres.js → client (Cloudflare Worker / Supabase). */
export function postgresClient(sql) {
  const wrap = (s) => ({
    query: (text, params) => s.unsafe(text, params),
    transaction: (fn) => s.begin((t) => fn(wrap(t))),
  });
  return wrap(sql);
}
