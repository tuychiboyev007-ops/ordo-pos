/**
 * API yo'llari. Uch daraja:
 *   open    — hech narsa talab qilinmaydi (kirish);
 *   device  — ulangan qurilma belgisi (kassa ishi; PIN kassaning o'zida tekshiriladi);
 *   manager — PIN bilan olingan sessiya belgisi, lavozimi egasi yoki menejer (boshqaruv).
 */
import { json, fail } from './lib/http.js';
import { readToken } from './lib/auth.js';
import * as A from './routes/auth.js';
import * as S from './routes/sync.js';
import * as M from './routes/admin.js';
import * as R from './routes/reports.js';
import * as W from './routes/stock.js';
import * as P from './routes/money.js';
import * as B from './routes/bot.js';

const ROUTES = {
  'POST /api/setup': ['open', A.setup],
  'POST /api/device/login': ['open', A.deviceLogin],
  'GET /api/img': ['open', A.image],
  'GET /api/boot': ['device', A.boot],
  'POST /api/pin': ['device', A.pinLogin],
  'POST /api/sync': ['device', S.sync],
  'GET /api/state': ['device', S.state],
  'GET /api/orders': ['device', S.ordersOfDay],
  'GET /api/kitchen': ['device', S.kitchen],
  'GET /api/shift/report': ['device', S.shiftReport],
  'POST /api/stop': ['device', M.setStop],
  'GET /api/customers': ['device', S.customers],
  'GET /api/expense-cats': ['device', async () => json({ ok: true, categories: P.EXPENSE_CATS })],
  'POST /api/bot/pull': ['device', B.pull],

  'POST /api/password': ['manager', A.changePassword],
  'GET /api/admin/menu': ['manager', M.menu],
  'POST /api/admin/category': ['manager', M.saveCategory],
  'POST /api/admin/product': ['manager', M.saveProduct],
  'POST /api/admin/station': ['manager', M.saveStation],
  'POST /api/admin/hall': ['manager', M.saveHall],
  'POST /api/admin/table': ['manager', M.saveTable],
  'POST /api/admin/remove': ['manager', M.remove],
  'GET /api/admin/mods': ['manager', M.mods],
  'POST /api/admin/modgroup': ['manager', M.saveModGroup],
  'POST /api/admin/modgroup/remove': ['manager', M.removeModGroup],
  'GET /api/admin/staff': ['manager', M.staff],
  'POST /api/admin/staff': ['manager', M.saveStaff],
  'GET /api/admin/settings': ['manager', M.settings],
  'POST /api/admin/settings': ['manager', M.saveSettings],
  'GET /api/admin/devices': ['manager', M.devices],
  'GET /api/admin/bot': ['manager', B.status],
  'POST /api/admin/bot': ['manager', B.save],
  'POST /api/admin/bot/check': ['manager', B.check],
  'POST /api/admin/devices/revoke': ['manager', M.revokeDevice],
  'GET /api/reports/summary': ['manager', R.summary],
  'GET /api/reports/shifts': ['manager', R.shifts],
  'GET /api/reports/profit': ['manager', R.profit],
  'GET /api/reports/analytics': ['manager', R.analytics],
  'GET /api/reports/diagnostics': ['manager', R.diagnostics],
  'GET /api/reports/order': ['manager', R.orderLog],
  'POST /api/order/pay-method': ['manager', S.changePayMethod],
  'GET /api/dashboard': ['manager', P.dashboard],

  'GET /api/stock/ingredients': ['manager', W.ingredients],
  'GET /api/stock/ingredient': ['manager', W.ingredientInfo],
  'POST /api/stock/ingredient': ['manager', W.saveIngredient],
  'POST /api/stock/ingredient/remove': ['manager', W.removeIngredient],
  'GET /api/stock/preps': ['manager', W.preps],
  'POST /api/stock/prep': ['manager', W.savePrep],
  'POST /api/stock/prep/unset': ['manager', W.unprep],
  'GET /api/stock/recipe': ['manager', W.recipe],
  'POST /api/stock/recipe': ['manager', W.saveRecipe],
  'GET /api/stock/recipe-costs': ['manager', W.recipeCosts],
  'POST /api/stock/doc': ['manager', W.saveDoc],
  'GET /api/stock/docs': ['manager', W.docs],
  'GET /api/stock/doc': ['manager', W.doc],
  'POST /api/stock/doc/cancel': ['manager', W.cancelDoc],
  'GET /api/stock/moves': ['manager', W.moves],
  'GET /api/stock/today': ['manager', W.today],
  'GET /api/reports/material': ['manager', W.material],

  'GET /api/debts': ['manager', P.debts],
  'GET /api/debt': ['manager', P.debt],
  'POST /api/customer': ['manager', P.saveCustomer],
  'POST /api/debt/move': ['manager', P.debtMove],
  'GET /api/suppliers': ['manager', P.suppliers],
  'GET /api/supplier': ['manager', P.supplier],
  'POST /api/supplier': ['manager', P.saveSupplier],
  'POST /api/supplier/pay': ['manager', P.supplierPay],
  'GET /api/expenses': ['manager', P.expenses],
  'POST /api/expense': ['manager', P.saveExpense],
  'POST /api/expense/delete': ['manager', P.deleteExpense],
};

async function authenticate(req, env, db, level) {
  const h = req.headers.get('authorization') || '';
  const p = await readToken(env.AUTH_SECRET, h.replace(/^Bearer\s+/i, ''));
  if (!p || !p.c) return null;
  const dev = p.d ? await db.first('SELECT revoked FROM devices WHERE company_id = ? AND id = ?', p.c, p.d) : null;
  if (!dev || dev.revoked) return null;
  const co = await db.first('SELECT active FROM companies WHERE id = ? /* tenant:global — belgi ichidagi firma */', p.c);
  if (!co?.active) return null;
  if (level === 'manager') {
    if (p.t !== 's') return null;
    const u = await db.first('SELECT role, active, token_version FROM users WHERE company_id = ? AND id = ?', p.c, p.u);
    if (!u?.active || u.token_version !== p.v || !['owner', 'admin'].includes(u.role)) return null;
    return { ...p, r: u.role };
  }
  return p;
}

export async function handle(req, env, db) {
  const url = new URL(req.url);
  const route = ROUTES[`${req.method} ${url.pathname}`];
  if (!route) return fail(404, 'not_found', 'Bunday yo\'l yo\'q');
  const [level, fn] = route;
  let auth = null;
  if (level !== 'open') {
    auth = await authenticate(req, env, db, level);
    if (!auth) return fail(401, 'unauthorized', level === 'manager' ? 'Menejer sifatida qayta kiring' : 'Qurilma ulanmagan');
  }
  try {
    return await fn(req, env, db, auth);
  } catch (e) {
    console.error('[api]', url.pathname, e);
    return fail(500, 'server_error', 'Serverda xatolik');
  }
}

export { json };
