process.env.TZ = process.env.TZ || 'Asia/Bangkok';

import express from 'express';
import path from 'path';
import fs from 'fs';
import { load, getDb, save, flush, markDirty, uid, now, replaceDb, COLLECTIONS } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { buildReport, parseRange, inRange, localDate } from './report.js';
import { priceLine, summarize, round2, unitCost } from '../shared/pricing.js';
import { hasPerm, PERMISSIONS } from '../shared/permissions.js';

await load();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Simple in-memory brute-force guard for the login endpoint.
const loginFails = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const fail = (status, message) => { throw new HttpError(status, message); };
// Wrap handlers so thrown errors become JSON responses.
const h = (fn) => (req, res, next) => {
  try {
    const out = fn(req, res);
    if (out !== undefined && !res.headersSent) res.json(out);
  } catch (e) {
    next(e);
  }
};

const publicUser = (u) => {
  const { passwordHash, ...rest } = u;
  return rest;
};

// ---------- auth ----------
function auth(req, _res, next) {
  const header = req.headers.authorization || '';
  const payload = verifyToken(header.replace(/^Bearer /, ''), getDb().meta.secret);
  const user = payload && getDb().users.find((u) => u.id === payload.uid && u.active);
  if (!user || (user.tokenVersion || 0) !== (payload.tv || 0)) return next(new HttpError(401, 'กรุณาเข้าสู่ระบบ'));
  req.user = user;
  next();
}
const need = (perm) => (req, _res, next) =>
  hasPerm(req.user, perm) ? next() : next(new HttpError(403, 'คุณไม่มีสิทธิ์ใช้งานเมนูนี้'));
const anyOf = (...perms) => (req, _res, next) =>
  perms.some((p) => hasPerm(req.user, p)) ? next() : next(new HttpError(403, 'คุณไม่มีสิทธิ์ใช้งานเมนูนี้'));

app.post('/api/auth/login', h((req) => {
  const { username, password } = req.body || {};
  const ip = req.ip;
  const rec = loginFails.get(ip);
  if (rec && rec.until > Date.now() && rec.count >= LOGIN_MAX_FAILS) fail(429, 'ลองเข้าสู่ระบบผิดหลายครั้งเกินไป กรุณารอ 15 นาที');
  const user = getDb().users.find((u) => u.username.toLowerCase() === String(username || '').trim().toLowerCase());
  if (!user || !verifyPassword(password || '', user.passwordHash)) {
    const r = rec && rec.until > Date.now() ? rec : { count: 0, until: Date.now() + LOGIN_WINDOW_MS };
    r.count += 1;
    loginFails.set(ip, r);
    fail(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  loginFails.delete(ip);
  if (!user.active) fail(403, 'บัญชีนี้ถูกระงับการใช้งาน');
  user.tokenVersion = user.tokenVersion || 0;
  return { token: signToken({ uid: user.id, tv: user.tokenVersion }, getDb().meta.secret), user: publicUser(user) };
}));

app.use('/api', auth);

app.get('/api/auth/me', h((req) => ({ user: publicUser(req.user) })));

app.post('/api/auth/change-password', h((req) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!verifyPassword(currentPassword || '', req.user.passwordHash)) fail(400, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
  if (!newPassword || String(newPassword).length < 4) fail(400, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 4 ตัวอักษร');
  req.user.passwordHash = hashPassword(newPassword);
  req.user.updatedAt = now();
  save();
  return { ok: true };
}));

// ---------- catalog (read by POS) ----------
const bySort = (a, b) => (a.sort ?? 0) - (b.sort ?? 0) || String(a.name).localeCompare(String(b.name), 'th');

function catalog(user) {
  const db = getDb();
  const showCost = hasPerm(user, 'products') || hasPerm(user, 'reports');
  const strip = (x) => {
    if (showCost) return { ...x, unitCost: unitCost(x, db.ingredients) };
    const { cost, recipe, costMode, ...rest } = x;
    return rest;
  };
  return {
    categories: [...db.categories].sort(bySort),
    menuItems: [...db.menuItems].sort(bySort).map(strip),
    toppings: [...db.toppings].sort(bySort).map(strip),
    discounts: [...db.discounts].sort(bySort),
    settings: db.settings,
  };
}
app.get('/api/catalog', h((req) => catalog(req.user)));

// ---------- generic CRUD ----------
function crud(route, collection, perm, clean, { canDelete } = {}) {
  app.get(`/api/${route}`, anyOf(perm, 'pos'), h(() => [...getDb()[collection]].sort(bySort)));
  app.post(`/api/${route}`, need(perm), h((req) => {
    const t = now();
    const row = { id: uid(), active: true, ...clean(req.body || {}), createdAt: t, updatedAt: t };
    getDb()[collection].push(row);
    save();
    return row;
  }));
  app.put(`/api/${route}/:id`, need(perm), h((req) => {
    const row = getDb()[collection].find((x) => x.id === req.params.id);
    if (!row) fail(404, 'ไม่พบข้อมูล');
    Object.assign(row, clean({ ...row, ...(req.body || {}) }), { updatedAt: now() });
    save();
    return row;
  }));
  app.delete(`/api/${route}/:id`, need(perm), h((req) => {
    const list = getDb()[collection];
    const idx = list.findIndex((x) => x.id === req.params.id);
    if (idx < 0) fail(404, 'ไม่พบข้อมูล');
    if (canDelete) canDelete(list[idx]);
    list.splice(idx, 1);
    save();
    return { ok: true };
  }));
}

const str = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const num = (v, min = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, round2(n)) : min;
};
const required = (v, label) => {
  if (!v) fail(400, `กรุณากรอก${label}`);
  return v;
};
const cleanRecipe = (recipe) =>
  (Array.isArray(recipe) ? recipe : [])
    .filter((r) => r && getDb().ingredients.some((i) => i.id === r.ingredientId) && Number(r.qty) > 0)
    .map((r) => ({ ingredientId: r.ingredientId, qty: num(r.qty) }));

crud('categories', 'categories', 'products', (b) => ({
  name: required(str(b.name, 40), 'ชื่อประเภท'),
  icon: str(b.icon, 8) || '☕',
  sort: num(b.sort),
  active: b.active !== false,
}), {
  canDelete: (c) => {
    if (getDb().menuItems.some((m) => m.categoryId === c.id)) fail(400, 'ยังมีเมนูอยู่ในประเภทนี้ กรุณาย้ายหรือลบเมนูก่อน');
  },
});

crud('menu-items', 'menuItems', 'products', (b) => {
  if (!getDb().categories.some((c) => c.id === b.categoryId)) fail(400, 'กรุณาเลือกประเภทเมนู');
  return {
    categoryId: b.categoryId,
    name: required(str(b.name, 60), 'ชื่อเมนู'),
    price: num(b.price),
    cost: num(b.cost),
    costMode: b.costMode === 'recipe' ? 'recipe' : 'manual',
    recipe: cleanRecipe(b.recipe),
    sort: num(b.sort),
    active: b.active !== false,
  };
});

crud('toppings', 'toppings', 'products', (b) => ({
  name: required(str(b.name, 60), 'ชื่อท็อปปิ้ง'),
  price: num(b.price),
  cost: num(b.cost),
  costMode: b.costMode === 'recipe' ? 'recipe' : 'manual',
  recipe: cleanRecipe(b.recipe),
  sort: num(b.sort),
  active: b.active !== false,
}));

crud('discounts', 'discounts', 'products', (b) => ({
  name: required(str(b.name, 60), 'ชื่อส่วนลด'),
  type: ['amount', 'percent', 'free'].includes(b.type) ? b.type : 'amount',
  value: b.type === 'percent' ? Math.min(100, num(b.value)) : num(b.value),
  maxValue: num(b.maxValue),
  sort: num(b.sort),
  active: b.active !== false,
}));

crud('expenses', 'expenses', 'expenses', (b) => ({
  date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : localDate(new Date()),
  category: str(b.category, 40) || 'อื่นๆ',
  description: required(str(b.description, 120), 'รายละเอียด'),
  amount: num(b.amount),
  sort: 0,
}));
// Expenses list should be newest first and filterable by date range.
app.get('/api/expenses-range', need('expenses'), h((req) => {
  const range = parseRange(req.query.from, req.query.to);
  return getDb().expenses
    .filter((e) => e.date >= range.from && e.date <= range.to)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}));

// ---------- ingredients / stock ----------
app.get('/api/ingredients', anyOf('stock', 'products'), h(() =>
  [...getDb().ingredients].sort((a, b) => a.name.localeCompare(b.name, 'th'))));

const cleanIngredient = (b) => ({
  name: required(str(b.name, 60), 'ชื่อวัตถุดิบ'),
  unit: str(b.unit, 20) || 'หน่วย',
  costPerUnit: Math.max(0, Math.round((Number(b.costPerUnit) || 0) * 10000) / 10000),
  minQty: num(b.minQty),
});

app.post('/api/ingredients', need('stock'), h((req) => {
  const t = now();
  const row = { id: uid(), ...cleanIngredient(req.body || {}), quantity: num(req.body?.quantity, -1e12), createdAt: t, updatedAt: t };
  getDb().ingredients.push(row);
  if (row.quantity) addMove(row, 'in', row.quantity, 'ยอดยกมา', req.user);
  save();
  return row;
}));
app.put('/api/ingredients/:id', need('stock'), h((req) => {
  const row = getDb().ingredients.find((x) => x.id === req.params.id);
  if (!row) fail(404, 'ไม่พบข้อมูล');
  Object.assign(row, cleanIngredient({ ...row, ...(req.body || {}) }), { updatedAt: now() });
  save();
  return row;
}));
app.delete('/api/ingredients/:id', need('stock'), h((req) => {
  const db = getDb();
  const id = req.params.id;
  const used = [...db.menuItems, ...db.toppings].filter((m) => (m.recipe || []).some((r) => r.ingredientId === id));
  if (used.length) fail(400, `วัตถุดิบนี้ถูกใช้ในสูตร: ${used.map((u) => u.name).join(', ')}`);
  db.ingredients = db.ingredients.filter((x) => x.id !== id);
  save();
  return { ok: true };
}));

function addMove(ing, type, qty, note, user, extra = {}) {
  getDb().stockMoves.push({
    id: uid(), ingredientId: ing.id, ingredientName: ing.name, unit: ing.unit, type, qty: round2(qty),
    balance: round2(ing.quantity), note: note || '', userId: user?.id, userName: user?.name, createdAt: now(), ...extra,
  });
}

// type: in (receive, with optional total cost -> moving-average cost), out (use / waste), set (stock count)
app.post('/api/ingredients/:id/adjust', need('stock'), h((req) => {
  const ing = getDb().ingredients.find((x) => x.id === req.params.id);
  if (!ing) fail(404, 'ไม่พบวัตถุดิบ');
  const { type, note } = req.body || {};
  const qty = Number(req.body?.qty);
  if (!Number.isFinite(qty) || qty < 0 || (type !== 'set' && qty === 0)) fail(400, 'กรุณากรอกจำนวนให้ถูกต้อง');
  const totalCost = Number(req.body?.totalCost) || 0;
  let delta;
  if (type === 'in') {
    if (totalCost > 0) {
      const curQty = Math.max(0, ing.quantity);
      const curValue = curQty * ing.costPerUnit;
      ing.costPerUnit = Math.round(((curValue + totalCost) / (curQty + qty)) * 10000) / 10000;
    }
    delta = qty;
  } else if (type === 'out') {
    delta = -qty;
  } else if (type === 'set') {
    delta = qty - ing.quantity;
  } else fail(400, 'ประเภทการปรับสต๊อกไม่ถูกต้อง');
  ing.quantity = round2(ing.quantity + delta);
  ing.updatedAt = now();
  addMove(ing, type, delta, str(note, 120), req.user, totalCost > 0 ? { totalCost: round2(totalCost) } : {});
  save();
  return ing;
}));

app.get('/api/stock-moves', need('stock'), h((req) => {
  let list = getDb().stockMoves;
  if (req.query.ingredientId) list = list.filter((m) => m.ingredientId === req.query.ingredientId);
  if (req.query.from) {
    const range = parseRange(req.query.from, req.query.to);
    list = list.filter((m) => inRange(m.createdAt, range));
  }
  return list.slice(-500).reverse();
}));

// ---------- customers ----------
app.get('/api/customers', anyOf('customers', 'pos'), h((req) => {
  const q = str(req.query.q).toLowerCase();
  const db = getDb();
  let list = db.customers;
  if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.phone || '').includes(q) || (c.lineId || '').toLowerCase().includes(q));
  return [...list].sort((a, b) => (b.lastVisitAt || '').localeCompare(a.lastVisitAt || '')).slice(0, q ? 50 : 500);
}));
const cleanCustomer = (b) => ({
  name: required(str(b.name, 60), 'ชื่อลูกค้า'),
  phone: str(b.phone, 20),
  lineId: str(b.lineId, 40),
  note: str(b.note, 200),
});
app.post('/api/customers', anyOf('customers', 'pos'), h((req) => {
  const t = now();
  const row = { id: uid(), ...cleanCustomer(req.body || {}), visits: 0, totalSpent: 0, createdAt: t, updatedAt: t };
  getDb().customers.push(row);
  save();
  return row;
}));
app.put('/api/customers/:id', need('customers'), h((req) => {
  const row = getDb().customers.find((c) => c.id === req.params.id);
  if (!row) fail(404, 'ไม่พบลูกค้า');
  Object.assign(row, cleanCustomer({ ...row, ...req.body }), { updatedAt: now() });
  save();
  return row;
}));
app.delete('/api/customers/:id', need('customers'), h((req) => {
  getDb().customers = getDb().customers.filter((c) => c.id !== req.params.id);
  save();
  return { ok: true };
}));

// ---------- orders ----------
function applyStock(order, sign, user) {
  const db = getDb();
  const need = new Map();
  const addRecipe = (recipe, qty) => {
    for (const r of recipe || []) need.set(r.ingredientId, (need.get(r.ingredientId) || 0) + r.qty * qty);
  };
  for (const l of order.items) {
    addRecipe(db.menuItems.find((m) => m.id === l.menuItemId)?.recipe, l.qty);
    for (const t of l.toppings) addRecipe(db.toppings.find((x) => x.id === t.id)?.recipe, l.qty);
  }
  for (const [ingredientId, qty] of need) {
    const ing = db.ingredients.find((i) => i.id === ingredientId);
    if (!ing) continue;
    ing.quantity = round2(ing.quantity + sign * qty);
    ing.updatedAt = now();
    addMove(ing, sign < 0 ? 'sale' : 'void', sign * qty, `บิล ${order.orderNo}`, user, { orderId: order.id });
  }
}

app.post('/api/orders', need('pos'), h((req) => {
  const db = getDb();
  const body = req.body || {};
  if (!Array.isArray(body.items) || !body.items.length) fail(400, 'ยังไม่มีรายการสินค้า');
  if (!['cash', 'transfer'].includes(body.paymentMethod)) fail(400, 'กรุณาเลือกวิธีชำระเงิน');

  const cat = { ...db, menuItems: db.menuItems, toppings: db.toppings, discounts: db.discounts, categories: db.categories, ingredients: db.ingredients };
  let lines;
  try {
    lines = body.items.map((i) => priceLine(i, cat));
  } catch (e) {
    fail(400, e.message);
  }
  const s = summarize(lines);

  // customer
  let customer = null;
  const customerType = body.customer?.type === 'old' ? 'old' : 'new';
  if (customerType === 'old' && body.customer?.id) {
    customer = db.customers.find((c) => c.id === body.customer.id) || null;
  } else if (customerType === 'new' && str(body.customer?.name)) {
    const t = now();
    customer = { id: uid(), ...cleanCustomer(body.customer), visits: 0, totalSpent: 0, createdAt: t, updatedAt: t };
    db.customers.push(customer);
  }
  if (customer) {
    customer.visits = (customer.visits || 0) + 1;
    customer.totalSpent = round2((customer.totalSpent || 0) + s.total);
    customer.lastVisitAt = now();
  }

  let cashReceived = null;
  let change = null;
  if (body.paymentMethod === 'cash') {
    cashReceived = body.cashReceived != null && body.cashReceived !== '' ? num(body.cashReceived) : s.total;
    if (cashReceived < s.total) fail(400, 'จำนวนเงินที่รับมาน้อยกว่ายอดชำระ');
    change = round2(cashReceived - s.total);
  }

  const today = localDate(new Date());
  const seq = db.orders.filter((o) => localDate(o.createdAt) === today).length + 1;
  const order = {
    id: uid(),
    orderNo: `${today.replace(/-/g, '').slice(2)}-${String(seq).padStart(3, '0')}`,
    createdAt: now(),
    status: 'paid',
    customerType,
    customerId: customer?.id || null,
    customerName: customer?.name || 'ลูกค้าทั่วไป',
    items: lines,
    ...s,
    paymentMethod: body.paymentMethod,
    cashReceived,
    change,
    staffId: req.user.id,
    staffName: req.user.name,
  };
  db.orders.push(order);
  applyStock(order, -1, req.user);
  save();
  return order;
}));

app.get('/api/orders', anyOf('orders', 'reports'), h((req) => {
  const range = parseRange(req.query.from, req.query.to);
  const q = str(req.query.q).toLowerCase();
  let list = getDb().orders.filter((o) => inRange(o.createdAt, range));
  if (req.query.method) list = list.filter((o) => o.paymentMethod === req.query.method);
  if (q) list = list.filter((o) => o.orderNo.includes(q) || o.customerName.toLowerCase().includes(q));
  return [...list].reverse();
}));

app.get('/api/orders/:id', anyOf('orders', 'pos'), h((req) => {
  const o = getDb().orders.find((x) => x.id === req.params.id);
  if (!o) fail(404, 'ไม่พบบิล');
  return o;
}));

app.post('/api/orders/:id/void', h((req) => {
  if (req.user.role !== 'owner') fail(403, 'เฉพาะเจ้าของร้านเท่านั้นที่ยกเลิกบิลได้');
  const db = getDb();
  const o = db.orders.find((x) => x.id === req.params.id);
  if (!o) fail(404, 'ไม่พบบิล');
  if (o.status === 'void') fail(400, 'บิลนี้ถูกยกเลิกแล้ว');
  o.status = 'void';
  o.voidReason = str(req.body?.reason, 200);
  o.voidedAt = now();
  o.voidedBy = req.user.name;
  markDirty('orders', o.createdAt);
  const c = db.customers.find((x) => x.id === o.customerId);
  if (c) {
    c.visits = Math.max(0, (c.visits || 0) - 1);
    c.totalSpent = round2(Math.max(0, (c.totalSpent || 0) - o.total));
  }
  applyStock(o, +1, req.user);
  save();
  return o;
}));

// ---------- reports ----------
app.get('/api/reports/summary', need('reports'), h((req) => buildReport(getDb(), parseRange(req.query.from, req.query.to))));

// ---------- users (owner only) ----------
const ownerOnly = (req, _res, next) =>
  req.user.role === 'owner' ? next() : next(new HttpError(403, 'เฉพาะเจ้าของร้านเท่านั้น'));
const validPerms = (p) => (Array.isArray(p) ? p.filter((k) => PERMISSIONS.some((x) => x.key === k)) : []);
const ownersLeft = (excludeId) => getDb().users.filter((u) => u.role === 'owner' && u.active && u.id !== excludeId).length;

app.get('/api/users', ownerOnly, h(() => getDb().users.map(publicUser)));
app.post('/api/users', ownerOnly, h((req) => {
  const b = req.body || {};
  const username = required(str(b.username, 30).toLowerCase(), 'ชื่อผู้ใช้');
  if (!/^[a-z0-9._-]+$/.test(username)) fail(400, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ -');
  if (getDb().users.some((u) => u.username === username)) fail(400, 'ชื่อผู้ใช้นี้มีอยู่แล้ว');
  if (!b.password || String(b.password).length < 4) fail(400, 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร');
  const t = now();
  const user = {
    id: uid(), username, name: required(str(b.name, 60), 'ชื่อ-นามสกุล'),
    role: b.role === 'owner' ? 'owner' : 'staff', permissions: validPerms(b.permissions),
    passwordHash: hashPassword(b.password), active: b.active !== false, tokenVersion: 0, createdAt: t, updatedAt: t,
  };
  getDb().users.push(user);
  save();
  return publicUser(user);
}));
app.put('/api/users/:id', ownerOnly, h((req) => {
  const u = getDb().users.find((x) => x.id === req.params.id);
  if (!u) fail(404, 'ไม่พบผู้ใช้');
  const b = req.body || {};
  const role = b.role === 'owner' ? 'owner' : b.role === 'staff' ? 'staff' : u.role;
  const active = b.active === undefined ? u.active : !!b.active;
  if (u.role === 'owner' && (role !== 'owner' || !active) && ownersLeft(u.id) === 0) fail(400, 'ต้องมีเจ้าของร้านที่ใช้งานอยู่อย่างน้อย 1 คน');
  if (b.username !== undefined) {
    const username = required(str(b.username, 30).toLowerCase(), 'ชื่อผู้ใช้');
    if (!/^[a-z0-9._-]+$/.test(username)) fail(400, 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ -');
    if (getDb().users.some((x) => x.username === username && x.id !== u.id)) fail(400, 'ชื่อผู้ใช้นี้มีอยู่แล้ว');
    u.username = username;
  }
  if (b.name !== undefined) u.name = required(str(b.name, 60), 'ชื่อ-นามสกุล');
  if (b.permissions !== undefined) u.permissions = validPerms(b.permissions);
  if (b.password) {
    if (String(b.password).length < 4) fail(400, 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร');
    u.passwordHash = hashPassword(b.password);
    u.tokenVersion = (u.tokenVersion || 0) + 1; // sign out other sessions
  }
  if (!active && u.active) u.tokenVersion = (u.tokenVersion || 0) + 1;
  u.role = role;
  u.active = active;
  u.updatedAt = now();
  save();
  return publicUser(u);
}));
app.delete('/api/users/:id', ownerOnly, h((req) => {
  const u = getDb().users.find((x) => x.id === req.params.id);
  if (!u) fail(404, 'ไม่พบผู้ใช้');
  if (u.id === req.user.id) fail(400, 'ไม่สามารถลบบัญชีของตัวเองได้');
  if (u.role === 'owner' && ownersLeft(u.id) === 0) fail(400, 'ต้องมีเจ้าของร้านอย่างน้อย 1 คน');
  getDb().users = getDb().users.filter((x) => x.id !== u.id);
  save();
  return { ok: true };
}));

// ---------- settings & backup ----------
app.get('/api/settings', h(() => getDb().settings));
app.put('/api/settings', need('settings'), h((req) => {
  const b = req.body || {};
  const s = getDb().settings;
  if (b.shopName !== undefined) s.shopName = str(b.shopName, 60) || 'MA Coffee';
  if (b.address !== undefined) s.address = str(b.address, 200);
  if (b.phone !== undefined) s.phone = str(b.phone, 30);
  if (b.promptPayId !== undefined) s.promptPayId = str(b.promptPayId, 20).replace(/[^0-9]/g, '');
  if (b.receiptFooter !== undefined) s.receiptFooter = str(b.receiptFooter, 200);
  if (Array.isArray(b.sweetnessLevels)) {
    const lv = [...new Set(b.sweetnessLevels.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 200))].sort((a, b2) => a - b2);
    if (lv.length) s.sweetnessLevels = lv;
  }
  save();
  return s;
}));

app.get('/api/backup', ownerOnly, h((_req, res) => {
  const { meta, ...data } = getDb();
  res.setHeader('Content-Disposition', `attachment; filename="ma-coffee-backup-${localDate(new Date())}.json"`);
  res.json(data);
}));
app.post('/api/restore', ownerOnly, h((req) => {
  const b = req.body || {};
  if (!Array.isArray(b.users) || !b.users.some((u) => u.role === 'owner')) fail(400, 'ไฟล์สำรองข้อมูลไม่ถูกต้อง');
  const next = {};
  for (const c of COLLECTIONS) next[c] = Array.isArray(b[c]) ? b[c] : [];
  next.settings = b.settings || {};
  replaceDb(next);
  return { ok: true };
}));

// ---------- errors / static ----------
app.use('/api', (_req, _res, next) => next(new HttpError(404, 'ไม่พบ API')));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'เกิดข้อผิดพลาดในระบบ' : err.message });
});

const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = Number(process.env.PORT) || 3001;
const server = app.listen(PORT, '0.0.0.0', () => console.log(`MA Coffee POS API: http://localhost:${PORT}`));

// Let pending database writes finish before the host stops the process.
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    server.close();
    flush().finally(() => process.exit(0));
  });
}
