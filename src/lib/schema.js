/**
 * ordo bazasi. Har restoran — "company"; unga tegishli har jadvalda company_id bor
 * va db qatlami usiz so'rovni bajarmaydi (lib/db.js tenantCheck).
 *
 * Buyurtma ikki ko'rinishda saqlanadi:
 *  - orders.doc (JSONB) — kassa ko'radigan to'liq holat (taomlar, to'lovlar, chegirma);
 *  - order_items / payments — buyurtma YOPILGANDA (yoki bekor qilinganda) yoziladi,
 *    hisobotlar shulardan SQL bilan yig'iladi.
 * ops — kassadan kelgan har amal (idempotentlik va to'liq iz: kim, qachon, nima qildi).
 */
export const TENANT_TABLES = [
  'users', 'devices', 'settings', 'halls', 'tables', 'stations', 'categories', 'products',
  'orders', 'order_items', 'payments', 'ops', 'shifts', 'cash_moves', 'login_attempts',
  'ingredients', 'recipes', 'stock_moves', 'stock_docs', 'suppliers', 'supplier_moves',
  'customers', 'debt_moves', 'expenses', 'notes', 'bot_events', 'mod_groups', 'modifiers', 'product_mods',
];

/** Kassaga yuborilmaydigan maxfiy sozlamalar (boot javobidan va sozlamalar ro'yxatidan chiqariladi). */
export const SECRET_SETTINGS = ['bot_key'];

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS companies (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL, role TEXT NOT NULL, email TEXT, password_hash TEXT,
    pin_salt TEXT, pin_hash TEXT, active BOOLEAN NOT NULL DEFAULT true, color TEXT,
    token_version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (lower(email)) WHERE email IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL, created_by INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ, revoked BOOLEAN NOT NULL DEFAULT false)`,
  `CREATE TABLE IF NOT EXISTS settings (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE, key TEXT NOT NULL, value TEXT,
    PRIMARY KEY (company_id, key))`,
  `CREATE TABLE IF NOT EXISTS halls (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, service_pct NUMERIC NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS tables (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE, name TEXT NOT NULL,
    seats INTEGER NOT NULL DEFAULT 4, sort INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS stations (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL, printer TEXT, sort INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL, color TEXT, station_id INTEGER REFERENCES stations(id) ON DELETE SET NULL,
    sort INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS products (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, name TEXT NOT NULL,
    price BIGINT NOT NULL DEFAULT 0, cost BIGINT NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'dona',
    station_id INTEGER REFERENCES stations(id) ON DELETE SET NULL, barcode TEXT, ikpu TEXT,
    stop BOOLEAN NOT NULL DEFAULT false, sort INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  // Rasm: '/img/...' (sayt fayli) yoki data:image (boshqaruvdan yuklangan, 420 px gacha siqilgan).
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS image TEXT`,
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS image_v INTEGER NOT NULL DEFAULT 0`,
  `CREATE TABLE IF NOT EXISTS shifts (
    id TEXT PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    number INTEGER, device_id INTEGER, opened_by INTEGER, opened_at TIMESTAMPTZ NOT NULL,
    opening_cash BIGINT NOT NULL DEFAULT 0, closed_by INTEGER, closed_at TIMESTAMPTZ,
    counted_cash BIGINT, expected_cash BIGINT, summary JSONB, status TEXT NOT NULL DEFAULT 'open')`,
  `CREATE TABLE IF NOT EXISTS cash_moves (
    id TEXT PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    shift_id TEXT NOT NULL, kind TEXT NOT NULL, amount BIGINT NOT NULL, reason TEXT,
    user_id INTEGER, at TIMESTAMPTZ NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    number INTEGER, type TEXT NOT NULL, table_id INTEGER, waiter_id INTEGER, status TEXT NOT NULL,
    guests INTEGER NOT NULL DEFAULT 0, opened_at TIMESTAMPTZ, closed_at TIMESTAMPTZ, shift_id TEXT,
    subtotal BIGINT NOT NULL DEFAULT 0, discount BIGINT NOT NULL DEFAULT 0, service BIGINT NOT NULL DEFAULT 0, total BIGINT NOT NULL DEFAULT 0,
    doc JSONB NOT NULL, rev INTEGER NOT NULL DEFAULT 0, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER, name TEXT NOT NULL,
    price BIGINT NOT NULL, qty DOUBLE PRECISION NOT NULL, sum BIGINT NOT NULL, unit TEXT, station_id INTEGER,
    status TEXT NOT NULL, sent_at TIMESTAMPTZ, cancel_reason TEXT, cancelled_by INTEGER, added_by INTEGER, closed_at TIMESTAMPTZ)`,
  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, method TEXT NOT NULL,
    amount BIGINT NOT NULL, shift_id TEXT, user_id INTEGER, at TIMESTAMPTZ NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ops (
    id TEXT PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    order_id TEXT, type TEXT NOT NULL, user_id INTEGER, at TIMESTAMPTZ, data JSONB, device_id INTEGER,
    error TEXT, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  // ---- Ombor: masalliqlar, texnologik karta, harakatlar ----
  // Birlik: kg, l yoki dona. Retseptda grammda yoziladi, bazada kg da (0.170).
  // Har harakatda qoldiq (balance) va o'rtacha tannarx (avg) keyingi holati yoziladi —
  // moddiy hisobot istalgan davr uchun qayta hisoblamasdan aniq chiqadi.
  `CREATE TABLE IF NOT EXISTS ingredients (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'kg', stock DOUBLE PRECISION NOT NULL DEFAULT 0,
    cost DOUBLE PRECISION NOT NULL DEFAULT 0, min_stock DOUBLE PRECISION NOT NULL DEFAULT 0, grp TEXT,
    active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS recipes (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    qty DOUBLE PRECISION NOT NULL, PRIMARY KEY (product_id, ingredient_id))`,
  // Zagotovka (yarim tayyor mahsulot): kotlet, sous, xamir… O'zi ham masalliq (omborda qoldig'i bo'ladi, taom texkartasiga
  // qo'yiladi), lekin tarkibi bor: `yield` birlik zagotovka uchun `prep_lines` dagi masalliqlar ketadi.
  `ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS prep BOOLEAN NOT NULL DEFAULT false`,
  // Zagotovka turi: '' — oddiy zagotovka, 'marinovka' — marinadlangan mahsulot (necha soatda tayyor, necha soat saqlanadi).
  `ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS prep_kind TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS marin_hours DOUBLE PRECISION NOT NULL DEFAULT 0`,
  `ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS keep_hours DOUBLE PRECISION NOT NULL DEFAULT 0`,
  `ALTER TABLE ingredients ADD COLUMN IF NOT EXISTS yield DOUBLE PRECISION NOT NULL DEFAULT 1`,
  `CREATE TABLE IF NOT EXISTS prep_lines (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    prep_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
    qty DOUBLE PRECISION NOT NULL, PRIMARY KEY (prep_id, ingredient_id))`,
  // Tayyor (dona) tovar — Cola, suv, tayyor kotlet: menyudagi taom omborda shu masalliq bo'lib hisoblanadi (texkartada 1:1).
  `ALTER TABLE products ADD COLUMN IF NOT EXISTS goods_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL`,
  `CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL, phone TEXT, note TEXT, debt BIGINT NOT NULL DEFAULT 0,
    active BOOLEAN NOT NULL DEFAULT true, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS stock_docs (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL, reason TEXT, note TEXT,
    total BIGINT NOT NULL DEFAULT 0, paid BIGINT NOT NULL DEFAULT 0, pay_from TEXT, user_id INTEGER,
    at TIMESTAMPTZ NOT NULL DEFAULT now(), cancelled_at TIMESTAMPTZ, cancelled_by INTEGER)`,
  `CREATE TABLE IF NOT EXISTS stock_moves (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE, kind TEXT NOT NULL,
    qty DOUBLE PRECISION NOT NULL, cost DOUBLE PRECISION NOT NULL DEFAULT 0, balance DOUBLE PRECISION NOT NULL,
    avg DOUBLE PRECISION NOT NULL DEFAULT 0, doc_id INTEGER, order_id TEXT, product_id INTEGER, note TEXT,
    user_id INTEGER, at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS idx_moves_ing ON stock_moves (company_id, ingredient_id, id)`,
  `CREATE INDEX IF NOT EXISTS idx_moves_at ON stock_moves (company_id, at)`,
  `CREATE TABLE IF NOT EXISTS supplier_moves (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE, kind TEXT NOT NULL,
    amount BIGINT NOT NULL, doc_id INTEGER, pay_from TEXT, shift_id TEXT, note TEXT, user_id INTEGER,
    at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  // ---- Nasiya: mijoz qarzi ----
  `CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT, phone TEXT, note TEXT, debt BIGINT NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS debt_moves (
    id TEXT PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    customer_id TEXT NOT NULL, kind TEXT NOT NULL, amount BIGINT NOT NULL, order_id TEXT, method TEXT,
    shift_id TEXT, note TEXT, user_id INTEGER, at TIMESTAMPTZ NOT NULL)`,
  // ---- Rasxod ----
  `CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    category TEXT NOT NULL, amount BIGINT NOT NULL, note TEXT, pay_from TEXT NOT NULL DEFAULT 'kassa',
    shift_id TEXT, user_id INTEGER, at TIMESTAMPTZ NOT NULL, deleted_at TIMESTAMPTZ, deleted_by INTEGER)`,
  // ---- Eslatmalar ----
  `CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    text TEXT NOT NULL, user_id INTEGER, at TIMESTAMPTZ NOT NULL, done_at TIMESTAMPTZ, done_by INTEGER)`,
  // ---- Telegram bot: kassadan botga yuboriladigan holatlar navbati ----
  `CREATE TABLE IF NOT EXISTS bot_events (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    number TEXT NOT NULL, status TEXT NOT NULL, order_id TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ, tries INTEGER NOT NULL DEFAULT 0, error TEXT)`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
    company_id INTEGER NOT NULL, key TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT now())`,
  // ---- Qo'shimchalar (modifikatorlar): pishloq +5 000, sous tanlash, piyozsiz ----
  `CREATE TABLE IF NOT EXISTS mod_groups (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL, required BOOLEAN NOT NULL DEFAULT false, multi BOOLEAN NOT NULL DEFAULT true,
    sort INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS modifiers (
    id SERIAL PRIMARY KEY, company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES mod_groups(id) ON DELETE CASCADE, name TEXT NOT NULL,
    price BIGINT NOT NULL DEFAULT 0, cost BIGINT NOT NULL DEFAULT 0,
    ingredient_id INTEGER REFERENCES ingredients(id) ON DELETE SET NULL, ingredient_qty DOUBLE PRECISION NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0, active BOOLEAN NOT NULL DEFAULT true)`,
  `CREATE TABLE IF NOT EXISTS product_mods (
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES mod_groups(id) ON DELETE CASCADE, PRIMARY KEY (product_id, group_id))`,
  `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS mods TEXT`,
  // Sotuv paytidagi 1 dona tannarxi (foyda hisoboti uchun; noma'lum bo'lsa NULL)
  `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cost BIGINT`,
  `CREATE INDEX IF NOT EXISTS idx_orders_open ON orders (company_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_closed ON orders (company_id, closed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_items_order ON order_items (company_id, order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_items_closed ON order_items (company_id, closed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_pay_at ON payments (company_id, at)`,
  `CREATE INDEX IF NOT EXISTS idx_ops_order ON ops (company_id, order_id)`,
];

export async function migrate(db) {
  for (const sql of SCHEMA) await db.run(sql);
}
