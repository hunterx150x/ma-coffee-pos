import './env.js';
import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { load, getDb, save, flush, markDirty, uid, now, replaceDb, COLLECTIONS } from './db.js';
import { hashPassword, verifyPassword, signToken, verifyToken } from './auth.js';
import { buildReport, parseRange, inRange, localDate } from './report.js';
import { priceLine, summarize, round2, unitCost, stampsEarned, rewardsAvailable } from '../shared/pricing.js';
import { hasPerm, PERMISSIONS } from '../shared/permissions.js';
import * as line from './line.js';
import * as events from './events.js';

await load();

const app = express();
app.set('trust proxy', 1);

// ---------- LINE ----------
const lineGroupId = () => getDb().settings.line?.groupId || process.env.LINE_GROUP_ID || '';
const leadGroupId = () => getDb().settings.line?.leadGroupId || lineGroupId();
const lineOn = (kind) => line.lineConfigured() && lineGroupId() && getDb().settings.line?.[kind] !== false;
const todayTotals = () => buildReport(getDb(), parseRange()).totals;
const lowStockList = () => getDb().ingredients.filter((i) => i.minQty > 0 && i.quantity <= i.minQty);

function notifySale(order, crossedLow) {
  if (lineOn('sale')) line.pushQuiet(lineGroupId(), [line.saleFlex(order, todayTotals(), getDb().settings.shopName)]);
  if (crossedLow.length && lineOn('lowStock')) line.pushQuiet(lineGroupId(), [line.lowStockFlex(crossedLow)]);
}

// Webhook needs the raw body to check LINE's signature, so it is registered before the JSON parser.
app.post('/api/line/webhook', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  if (!line.verifySignature(req.body, req.headers['x-line-signature'])) return res.status(401).end();
  res.status(200).end();
  let events = [];
  try { events = JSON.parse(req.body.toString('utf8')).events || []; } catch { return; }
  const db = getDb();
  for (const ev of events) {
    const groupId = ev.source?.groupId;
    if (!groupId) continue;
    // Remember groups the bot was added to, so the owner can pick one in Settings.
    db.meta.lineGroups = db.meta.lineGroups || [];
    let g = db.meta.lineGroups.find((x) => x.groupId === groupId);
    if (!g) {
      g = { groupId, name: '', seenAt: now() };
      db.meta.lineGroups.push(g);
      line.groupSummary(groupId).then((r) => { g.name = r.groupName || ''; save(); }).catch(() => {});
    }
    g.seenAt = now();
    save();
    // Commands only answer in the shop's own group (replies are free, no quota used).
    const text = ev.type === 'message' && ev.message?.type === 'text' ? ev.message.text.trim() : '';
    if (!text || groupId !== lineGroupId() || !ev.replyToken) continue;
    if (/^(ยอด|ยอดวันนี้|สรุป|สรุปยอด)$/.test(text)) {
      line.reply(ev.replyToken, [line.summaryFlex(buildReport(db, parseRange()), db.settings.shopName)]).catch((e) => console.error(e.message));
    } else if (/^(สต๊อก|สต็อก|stock)$/i.test(text)) {
      const low = lowStockList();
      line.reply(ev.replyToken, [low.length ? line.lowStockFlex(low) : { type: 'text', text: '✅ วัตถุดิบเพียงพอทุกรายการ' }]).catch((e) => console.error(e.message));
    }
  }
});

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

// ---------- public: menu photos + customer self-order (no login) ----------
app.get('/api/menu-image/:id', (req, res) => {
  const m = getDb().menuItems.find((x) => x.id === req.params.id);
  const match = m?.image && m.image.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!match) return res.status(404).end();
  res.setHeader('Content-Type', match[1]);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.end(Buffer.from(match[2], 'base64'));
});

const CONTACT_KEYS = ['facebook', 'instagram', 'line', 'tiktok', 'map'];
const selfOrderOpen = () => getDb().settings.selfOrder?.enabled !== false;

app.get('/api/public/menu', h(() => {
  const db = getDb();
  // The customer QR menu follows the "sell outside" switches of categories, menus and toppings.
  const cats = db.categories.filter((c) => c.activeOutside !== false).sort(bySort);
  const catIds = new Set(cats.map((c) => c.id));
  return {
    shop: { name: db.settings.shopName, phone: db.settings.phone },
    open: selfOrderOpen(),
    message: db.settings.selfOrder?.message || '',
    loyalty: db.settings.loyalty?.enabled ? { cupsPerReward: db.settings.loyalty.cupsPerReward, rewardMaxValue: db.settings.loyalty.rewardMaxValue } : null,
    sweetnessLevels: db.settings.sweetnessLevels,
    categories: cats.map(({ id, name, icon }) => ({ id, name, icon })),
    // The customer QR menu follows the "sell outside" switch, not the counter switch.
    menuItems: db.menuItems.filter((m) => m.activeOutside !== false && catIds.has(m.categoryId)).sort(bySort)
      .map((m) => ({ id: m.id, categoryId: m.categoryId, name: m.name, price: m.price, imageUrl: imageUrl(m) })),
    toppings: db.toppings.filter((t) => t.activeOutside !== false).sort(bySort).map(({ id, name, price }) => ({ id, name, price })),
  };
}));

// Light anti-spam for the public order form.
const publicOrders = new Map();
const PUBLIC_ORDER_WINDOW_MS = 10 * 60 * 1000;
const PUBLIC_ORDER_MAX = 6;

app.post('/api/public/orders', express.json({ limit: '64kb' }), h((req) => {
  if (!selfOrderOpen()) fail(403, 'ร้านปิดรับออเดอร์ออนไลน์ชั่วคราว กรุณาสั่งที่หน้าร้าน');
  const b = req.body || {};
  const name = str(b.name, 40);
  if (!name) fail(400, 'กรุณากรอกชื่อ');
  if (!Array.isArray(b.items) || !b.items.length) fail(400, 'ยังไม่ได้เลือกเมนู');
  if (b.items.length > 20 || b.items.some((i) => Number(i.qty) > 20)) fail(400, 'รายการเยอะเกินไป กรุณาสั่งที่หน้าร้าน');
  const db = getDb();
  const activeTop = (id) => db.toppings.some((t) => t.id === id && t.activeOutside !== false);
  const outsideCats = new Set(db.categories.filter((c) => c.activeOutside !== false).map((c) => c.id));
  const activeItem = (id) => db.menuItems.some((m) => m.id === id && m.activeOutside !== false && outsideCats.has(m.categoryId));
  if (!b.items.every((i) => activeItem(i.menuItemId))) fail(400, 'มีเมนูที่ไม่เปิดขายแล้ว กรุณาเลือกใหม่');

  const ip = req.ip;
  const hits = (publicOrders.get(ip) || []).filter((t) => t > Date.now() - PUBLIC_ORDER_WINDOW_MS);
  if (hits.length >= PUBLIC_ORDER_MAX) fail(429, 'สั่งบ่อยเกินไป กรุณาติดต่อพนักงาน');
  hits.push(Date.now());
  publicOrders.set(ip, hits);

  const items = b.items.map((i) => ({
    menuItemId: i.menuItemId,
    sweetness: db.settings.sweetnessLevels.includes(Number(i.sweetness)) ? Number(i.sweetness) : null,
    toppingIds: (i.toppingIds || []).filter(activeTop),
    discountIds: [], // discounts are applied by staff at the counter
    note: i.note,
    qty: i.qty,
  }));
  // Optional phone = stamp card member (existing member is matched by phone, otherwise signed up).
  let member = null;
  const phone = phoneDigits(b.phone);
  if (phone) {
    if (!/^0\d{8,9}$/.test(phone)) fail(400, 'เบอร์โทรไม่ถูกต้อง (เช่น 0812345678)');
    member = findByPhone(phone);
    if (!member) {
      const t = now();
      member = { id: uid(), name, phone, lineId: '', note: 'สมัครผ่าน QR', visits: 0, totalSpent: 0, points: 0, createdAt: t, updatedAt: t };
      db.customers.push(member);
    }
  }
  const q = createQueue({
    name, note: b.note, items, staffId: null, staffName: 'ลูกค้าสั่งเอง (QR)', source: 'customer',
    customer: member ? { type: 'old', id: member.id } : null,
  });
  return { token: q.publicToken, queueNo: q.queueNo };
}));

app.get('/api/public/queues/:token', h((req) => {
  const db = getDb();
  const q = db.queues.find((x) => x.publicToken && x.publicToken === String(req.params.token));
  if (!q) fail(404, 'ไม่พบคิวนี้');
  const today = localDate(q.createdAt);
  const sameDay = db.queues.filter((x) => localDate(x.createdAt) === today);
  // Queues still waiting to be made that were placed before this one (first come, first served).
  const ahead = q.status === 'waiting' ? sameDay.filter((x) => x.status === 'waiting' && x.createdAt < q.createdAt).length : 0;
  return {
    queueNo: q.queueNo,
    name: q.name,
    status: q.status,
    createdAt: q.createdAt,
    ahead,
    position: q.status === 'waiting' ? ahead + 1 : 0,
    waitingTotal: sameDay.filter((x) => x.status === 'waiting').length,
    total: q.total,
    cups: q.cups,
    orderNo: q.orderNo || null,
    lines: q.lines.map((l) => ({
      name: l.name, qty: l.qty, sweetness: l.sweetness, note: l.note, total: l.total, gross: l.gross,
      toppings: l.toppings.map((t) => ({ id: t.id, name: t.name, price: t.price })),
      discounts: l.discounts.map((d) => ({ id: d.id, name: d.name, amount: d.amount })),
    })),
    shop: { name: db.settings.shopName, phone: db.settings.phone, contacts: db.settings.contacts },
    loyalty: (() => {
      const c = q.customer && db.customers.find((x) => x.id === q.customer.id);
      const L = db.settings.loyalty;
      return c && L?.enabled ? { points: c.points || 0, cupsPerReward: L.cupsPerReward, rewardMaxValue: L.rewardMaxValue, rewards: rewardsAvailable(c.points, L) } : null;
    })(),
    payment: {
      promptPayId: db.settings.promptPayId || '',
      claimedAt: q.paymentClaim?.at || null,
      hasSlip: Boolean(q.paymentClaim?.slipId),
    },
  };
}));

// Customer says "I transferred" (optionally with a slip photo); staff verify and take payment in the queue.
const MAX_SLIP_CHARS = 600 * 1024;
app.post('/api/public/queues/:token/paid', h((req) => {
  const db = getDb();
  const q = db.queues.find((x) => x.publicToken && x.publicToken === String(req.params.token));
  if (!q) fail(404, 'ไม่พบคิวนี้');
  if (q.status === 'paid' || q.status === 'cancelled') fail(400, q.status === 'paid' ? 'คิวนี้ชำระเงินแล้ว' : 'คิวนี้ถูกยกเลิกแล้ว');
  if ((q.paymentClaim?.count || 0) >= 5) fail(429, 'แจ้งโอนหลายครั้งเกินไป กรุณาติดต่อพนักงาน');
  let slipId = q.paymentClaim?.slipId || null;
  const slip = req.body?.slip;
  if (slip) {
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(slip) || slip.length > MAX_SLIP_CHARS) fail(400, 'ไฟล์สลิปไม่ถูกต้อง หรือใหญ่เกินไป');
    const row = { id: uid(), queueId: q.id, image: slip, createdAt: now() };
    db.slips.push(row);
    slipId = row.id;
  }
  q.paymentClaim = { at: now(), slipId, count: (q.paymentClaim?.count || 0) + 1 };
  q.updatedAt = now();
  markDirty('queues', q.createdAt);
  save();
  events.broadcast('queues', { id: q.id, status: q.status });
  return { ok: true };
}));

// Trial requests from the public /system page (people interested in buying this POS).
const leadHits = new Map();
app.post('/api/public/leads', h((req) => {
  const b = req.body || {};
  const ip = req.ip;
  const hits = (leadHits.get(ip) || []).filter((t) => t > Date.now() - 60 * 60 * 1000);
  if (hits.length >= 5) fail(429, 'ส่งบ่อยเกินไป กรุณาลองใหม่ภายหลัง');
  if (!b.consent) fail(400, 'กรุณายินยอมให้ติดต่อกลับ');
  const lead = {
    id: uid(),
    name: required(str(b.name, 60), 'ชื่อ'),
    shop: required(str(b.shop, 80), 'ชื่อร้าน'),
    phone: required(str(b.phone, 20), 'เบอร์โทร'),
    lineId: str(b.lineId, 40),
    note: str(b.note, 500),
    createdAt: now(),
  };
  if (!/^\+?\d{9,12}$/.test(lead.phone.replace(/[\s-]/g, ''))) fail(400, 'เบอร์โทรไม่ถูกต้อง');
  hits.push(Date.now());
  leadHits.set(ip, hits);
  getDb().leads.push(lead);
  save();
  if (line.lineConfigured() && leadGroupId() && getDb().settings.line?.lead !== false) line.pushQuiet(leadGroupId(), [line.leadFlex(lead)]);
  return { ok: true };
}));

app.get('/api/public/events', (req, res) => events.subscribe(req, res, { isPublic: true }));

// Realtime stream. EventSource cannot send headers, so the token comes in the query string.
app.get('/api/events', (req, _res, next) => {
  req.headers.authorization = `Bearer ${String(req.query.token || '')}`;
  next();
}, auth, anyOf('queue', 'pos'), (req, res) => events.subscribe(req, res));

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
  const ing = (id) => db.ingredients.find((i) => i.id === id);
  // Ingredient names / units resolved so every user (even without stock access) can read how to make a drink.
  const howTo = (x) => ({
    ingredients: (x.recipe || []).map((r) => ({ name: ing(r.ingredientId)?.name || '-', unit: ing(r.ingredientId)?.unit || '', qty: r.qty })),
    steps: (x.steps || []).map((st) => ({
      text: st.text,
      ingredientName: st.ingredientId ? ing(st.ingredientId)?.name || '' : '',
      qty: st.ingredientId ? st.qty : null,
      unit: st.ingredientId ? ing(st.ingredientId)?.unit || '' : '',
    })),
  });
  const strip = (raw) => {
    const x = raw.image !== undefined ? menuView(raw) : raw;
    if (showCost) return { ...x, unitCost: unitCost(x, db.ingredients), howTo: howTo(x) };
    const { cost, recipe, costMode, ...rest } = x;
    return { ...rest, howTo: howTo(x) };
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
function crud(route, collection, perm, clean, { canDelete, view = (x) => x } = {}) {
  app.get(`/api/${route}`, anyOf(perm, 'pos'), h(() => [...getDb()[collection]].sort(bySort).map(view)));
  app.post(`/api/${route}`, need(perm), h((req) => {
    const t = now();
    const row = { id: uid(), active: true, ...clean(req.body || {}), createdAt: t, updatedAt: t };
    getDb()[collection].push(row);
    save();
    return view(row);
  }));
  app.put(`/api/${route}/:id`, need(perm), h((req) => {
    const row = getDb()[collection].find((x) => x.id === req.params.id);
    if (!row) fail(404, 'ไม่พบข้อมูล');
    Object.assign(row, clean({ ...row, ...(req.body || {}) }), { updatedAt: now() });
    save();
    return view(row);
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

// How-to steps: free text, optionally linked to a stock ingredient + amount (display only, stock is cut by the recipe).
const cleanSteps = (steps) =>
  (Array.isArray(steps) ? steps : [])
    .map((st) => {
      const ingredientId = st && getDb().ingredients.some((i) => i.id === st.ingredientId) ? st.ingredientId : null;
      return { text: str(st?.text, 200), ingredientId, qty: ingredientId ? num(st.qty) : null };
    })
    .filter((st) => st.text || st.ingredientId)
    .slice(0, 40);

crud('categories', 'categories', 'products', (b) => ({
  name: required(str(b.name, 40), 'ชื่อประเภท'),
  icon: str(b.icon, 8) || '☕',
  sort: num(b.sort),
  active: b.active !== false,
  activeOutside: b.activeOutside !== false,
}), {
  canDelete: (c) => {
    if (getDb().menuItems.some((m) => m.categoryId === c.id)) fail(400, 'ยังมีเมนูอยู่ในประเภทนี้ กรุณาย้ายหรือลบเมนูก่อน');
  },
});

// Menu photos are stored inline as small data URLs (resized in the browser) and served by /api/menu-image/:id.
const MAX_IMAGE_CHARS = 400 * 1024;
const cleanImage = (v) => {
  if (!v) return '';
  const img = String(v);
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(img)) fail(400, 'ไฟล์รูปไม่ถูกต้อง (รองรับ JPG / PNG / WebP)');
  if (img.length > MAX_IMAGE_CHARS) fail(400, 'รูปมีขนาดใหญ่เกินไป');
  return img;
};
const imageUrl = (m) => (m.image ? `/api/menu-image/${m.id}?v=${crypto.createHash('md5').update(m.image).digest('hex').slice(0, 8)}` : null);
const menuView = ({ image, ...m }) => ({ ...m, imageUrl: imageUrl({ ...m, image }) });

crud('menu-items', 'menuItems', 'products', (b) => {
  if (!getDb().categories.some((c) => c.id === b.categoryId)) fail(400, 'กรุณาเลือกประเภทเมนู');
  return {
    categoryId: b.categoryId,
    name: required(str(b.name, 60), 'ชื่อเมนู'),
    price: num(b.price),
    cost: num(b.cost),
    costMode: b.costMode === 'recipe' ? 'recipe' : 'manual',
    recipe: cleanRecipe(b.recipe),
    steps: cleanSteps(b.steps),
    image: cleanImage(b.image),
    sort: num(b.sort),
    active: b.active !== false, // sold at the counter (staff POS)
    activeOutside: b.activeOutside !== false, // sold outside / on the customer QR menu
  };
}, { view: menuView });

crud('toppings', 'toppings', 'products', (b) => ({
  name: required(str(b.name, 60), 'ชื่อท็อปปิ้ง'),
  price: num(b.price),
  cost: num(b.cost),
  costMode: b.costMode === 'recipe' ? 'recipe' : 'manual',
  recipe: cleanRecipe(b.recipe),
  sort: num(b.sort),
  active: b.active !== false,
  activeOutside: b.activeOutside !== false,
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

// ---------- capital (owner money put into the shop) ----------
// Not revenue: it never changes profit, it only shows how much of the expenses the owners' money covers.
const cleanCapital = (b) => ({
  date: /^\d{4}-\d{2}-\d{2}$/.test(b.date || '') ? b.date : localDate(new Date()),
  source: str(b.source, 60) || 'เจ้าของร้าน',
  note: str(b.note, 120),
  amount: (() => {
    const n = num(b.amount);
    if (!(n > 0)) fail(400, 'กรุณากรอกจำนวนเงินทุน');
    return n;
  })(),
});
const sumBy = (arr) => round2(arr.reduce((s, x) => s + (Number(x.amount) || 0), 0));

app.get('/api/capital', need('expenses'), h((req) => {
  const db = getDb();
  const range = parseRange(req.query.from, req.query.to);
  const inR = (x) => x.date >= range.from && x.date <= range.to;
  const capitalAll = sumBy(db.capital);
  const expensesAll = sumBy(db.expenses);
  return {
    rows: db.capital.filter(inR).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    range: { capital: sumBy(db.capital.filter(inR)), expenses: sumBy(db.expenses.filter(inR)) },
    allTime: { capital: capitalAll, expenses: expensesAll, balance: round2(capitalAll - expensesAll) },
  };
}));
app.post('/api/capital', need('expenses'), h((req) => {
  const t = now();
  const row = { id: uid(), ...cleanCapital(req.body || {}), userName: req.user.name, createdAt: t, updatedAt: t };
  getDb().capital.push(row);
  save();
  return row;
}));
app.put('/api/capital/:id', need('expenses'), h((req) => {
  const row = getDb().capital.find((x) => x.id === req.params.id);
  if (!row) fail(404, 'ไม่พบรายการ');
  Object.assign(row, cleanCapital({ ...row, ...(req.body || {}) }), { updatedAt: now() });
  save();
  return row;
}));
app.delete('/api/capital/:id', need('expenses'), h((req) => {
  getDb().capital = getDb().capital.filter((x) => x.id !== req.params.id);
  save();
  return { ok: true };
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

// Stock history, newest first, filtered and paged on the server (the log grows with every sale).
const MOVE_PAGE_SIZES = [50, 100, 200, 500];
app.get('/api/stock-moves', need('stock'), h((req) => {
  const q = req.query;
  let list = getDb().stockMoves;
  if (q.from || q.to) {
    const range = parseRange(q.from, q.to);
    list = list.filter((m) => inRange(m.createdAt, range));
  }
  // People list for the filter comes from the date range only, so choosing someone never empties it.
  const users = [...new Set(list.map((m) => m.userName || 'ระบบ'))].sort((a, b) => a.localeCompare(b, 'th'));
  if (q.ingredientId) list = list.filter((m) => m.ingredientId === q.ingredientId);
  if (q.user) list = list.filter((m) => (m.userName || 'ระบบ') === q.user);
  if (q.type) list = list.filter((m) => m.type === q.type);
  const perPage = MOVE_PAGE_SIZES.includes(Number(q.perPage)) ? Number(q.perPage) : 50;
  const total = list.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(q.page) || 1)));
  const end = total - (page - 1) * perPage;
  return { rows: list.slice(Math.max(0, end - perPage), end).reverse(), total, page, pages, perPage, users };
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
// The phone number is the member id for the stamp card, so it must be unique.
const phoneDigits = (p) => String(p || '').replace(/\D/g, '');
const findByPhone = (phone, exceptId) => {
  const d = phoneDigits(phone);
  return d ? getDb().customers.find((c) => c.id !== exceptId && phoneDigits(c.phone) === d) : null;
};
const assertPhoneFree = (phone, exceptId) => {
  const other = findByPhone(phone, exceptId);
  if (other) fail(400, `เบอร์ ${phone} เป็นของลูกค้า “${other.name}” อยู่แล้ว`);
};
app.post('/api/customers', anyOf('customers', 'pos'), h((req) => {
  const t = now();
  const row = { id: uid(), ...cleanCustomer(req.body || {}), visits: 0, totalSpent: 0, points: 0, createdAt: t, updatedAt: t };
  assertPhoneFree(row.phone);
  getDb().customers.push(row);
  save();
  return row;
}));

app.get('/api/customers/:id/points', anyOf('customers', 'pos'), h((req) => {
  const c = getDb().customers.find((x) => x.id === req.params.id);
  if (!c) fail(404, 'ไม่พบลูกค้า');
  return { points: c.points || 0, moves: getDb().pointMoves.filter((m) => m.customerId === c.id).reverse().slice(0, 200) };
}));

// Manual stamp adjustment (e.g. moving a paper / LINE stamp card into the system). Owner only, reason required.
app.post('/api/customers/:id/points', h((req) => {
  if (req.user.role !== 'owner') fail(403, 'เฉพาะเจ้าของร้านเท่านั้นที่ปรับแต้มได้');
  const c = getDb().customers.find((x) => x.id === req.params.id);
  if (!c) fail(404, 'ไม่พบลูกค้า');
  const delta = Math.trunc(Number(req.body?.points));
  if (!delta || Math.abs(delta) > 1000) fail(400, 'กรุณากรอกจำนวนแต้ม (บวกเพื่อเพิ่ม ลบเพื่อหัก)');
  if ((c.points || 0) + delta < 0) fail(400, 'แต้มคงเหลือติดลบไม่ได้');
  addPoints(c, delta, 'adjust', { user: req.user, note: required(str(req.body?.note, 120), 'เหตุผล') });
  save();
  return c;
}));
app.put('/api/customers/:id', need('customers'), h((req) => {
  const row = getDb().customers.find((c) => c.id === req.params.id);
  if (!row) fail(404, 'ไม่พบลูกค้า');
  if (req.body?.phone !== undefined) assertPhoneFree(str(req.body.phone, 20), row.id);
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
  const crossedLow = [];
  for (const [ingredientId, qty] of need) {
    const ing = db.ingredients.find((i) => i.id === ingredientId);
    if (!ing) continue;
    const before = ing.quantity;
    ing.quantity = round2(ing.quantity + sign * qty);
    if (ing.minQty > 0 && before > ing.minQty && ing.quantity <= ing.minQty) crossedLow.push(ing);
    ing.updatedAt = now();
    addMove(ing, sign < 0 ? 'sale' : 'void', sign * qty, `บิล ${order.orderNo}`, user, { orderId: order.id });
  }
  return crossedLow;
}

// Every change to a customer's stamps goes through here so the balance always matches the history.
function addPoints(customer, points, type, { order, user, note = '' } = {}) {
  customer.points = (customer.points || 0) + points;
  customer.updatedAt = now();
  getDb().pointMoves.push({
    id: uid(), customerId: customer.id, customerName: customer.name, type, points, balance: customer.points,
    orderId: order?.id || null, orderNo: order?.orderNo || null, note, userName: user?.name || 'ระบบ', createdAt: now(),
  });
}

const priceItems = (items) => {
  const db = getDb();
  if (!Array.isArray(items) || !items.length) fail(400, 'ยังไม่มีรายการสินค้า');
  try {
    return items.map((i) => priceLine(i, { ...db, loyalty: db.settings.loyalty }));
  } catch (e) {
    return fail(400, e.message);
  }
};

/**
 * Create a paid order. `customer` is { type: 'old', id } | { type: 'new', name, phone, lineId };
 * `customerName` overrides the bill name without creating a customer record (used by queues).
 */
function createOrder({ items, customer: cust, customerName, paymentMethod, cashReceived: cashIn, user, extra = {} }) {
  const db = getDb();
  if (!['cash', 'transfer'].includes(paymentMethod)) fail(400, 'กรุณาเลือกวิธีชำระเงิน');
  const lines = priceItems(items);
  const s = summarize(lines);

  let cashReceived = null;
  let change = null;
  if (paymentMethod === 'cash') {
    cashReceived = cashIn != null && cashIn !== '' ? num(cashIn) : s.total;
    if (cashReceived < s.total) fail(400, 'จำนวนเงินที่รับมาน้อยกว่ายอดชำระ');
    change = round2(cashReceived - s.total);
  }

  let customer = null;
  const customerType = cust?.type === 'old' ? 'old' : 'new';
  if (customerType === 'old' && cust?.id) {
    customer = db.customers.find((c) => c.id === cust.id) || null;
  } else if (customerType === 'new' && !customerName && str(cust?.name)) {
    customer = findByPhone(cust.phone);
    if (!customer) {
      const t = now();
      customer = { id: uid(), ...cleanCustomer(cust), visits: 0, totalSpent: 0, points: 0, createdAt: t, updatedAt: t };
      db.customers.push(customer);
    }
  }
  // Stamp card: redeeming needs a member with enough stamps; checked before anything is saved.
  const loyalty = db.settings.loyalty;
  const redeemedCups = lines.reduce((sum, l) => sum + (l.rewardQty || 0), 0);
  if (redeemedCups > 0) {
    if (!loyalty?.enabled) fail(400, 'ระบบสะสมแต้มปิดอยู่');
    if (!customer || customerType !== 'old') fail(400, 'การแลกแต้มต้องเลือกลูกค้าสมาชิก (ลูกค้าเก่า)');
    const excluded = new Set(loyalty.excludeCategoryIds || []);
    if (lines.some((l) => l.rewardQty && excluded.has(l.categoryId))) fail(400, 'เมนูหมวดนี้ใช้แต้มแลกไม่ได้');
    if (redeemedCups > rewardsAvailable(customer.points, loyalty)) fail(400, `แต้มไม่พอ — ${customer.name} แลกได้ ${rewardsAvailable(customer.points, loyalty)} แก้ว`);
  }

  if (customer) {
    customer.visits = (customer.visits || 0) + 1;
    customer.totalSpent = round2((customer.totalSpent || 0) + s.total);
    customer.lastVisitAt = now();
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
    customerName: customerName || customer?.name || 'ลูกค้าทั่วไป',
    items: lines,
    ...s,
    paymentMethod,
    cashReceived,
    change,
    staffId: user.id,
    staffName: user.name,
    ...extra,
  };
  if (customer && loyalty?.enabled) {
    const used = redeemedCups * loyalty.cupsPerReward;
    const earned = stampsEarned(lines, loyalty);
    if (used) addPoints(customer, -used, 'redeem', { order, user, note: `แลก ${redeemedCups} แก้ว` });
    if (earned) addPoints(customer, earned, 'earn', { order, user });
    order.loyalty = { earned, used, redeemedCups, balance: customer.points || 0, cupsPerReward: loyalty.cupsPerReward };
  }
  db.orders.push(order);
  const crossedLow = applyStock(order, -1, user);
  notifySale(order, crossedLow);
  return order;
}

app.post('/api/orders', need('pos'), h((req) => {
  const b = req.body || {};
  const order = createOrder({ items: b.items, customer: b.customer, paymentMethod: b.paymentMethod, cashReceived: b.cashReceived, user: req.user });
  save();
  return order;
}));

// ---------- queues (sell now, pay on pickup) ----------
// status: waiting (รอทำ) -> done (ทำแล้ว) -> paid (ชำระแล้ว); or cancelled
const QUEUE_STATUS = ['waiting', 'done', 'paid', 'cancelled'];
const findQueue = (id) => getDb().queues.find((q) => q.id === id) || fail(404, 'ไม่พบคิว');

app.get('/api/queues', anyOf('queue', 'pos'), h((req) => {
  const range = parseRange(req.query.from, req.query.to);
  let list = getDb().queues.filter((q) => inRange(q.createdAt, range));
  if (QUEUE_STATUS.includes(req.query.status)) list = list.filter((q) => q.status === req.query.status);
  return list; // stored oldest first = first come, first served
}));

// Number of open queues today, for the nav badge.
app.get('/api/queues/open-count', anyOf('queue', 'pos'), h(() => {
  const today = parseRange();
  return { count: getDb().queues.filter((q) => ['waiting', 'done'].includes(q.status) && inRange(q.createdAt, today)).length };
}));

function createQueue({ name, note, items, customer, staffId, staffName, source = 'staff' }) {
  const db = getDb();
  const lines = priceItems(items);
  const s = summarize(lines);
  const today = localDate(new Date());
  const queueNo = db.queues.filter((q) => localDate(q.createdAt) === today).length + 1;
  const queue = {
    id: uid(),
    // Unguessable id for the customer's public "track my queue" page.
    publicToken: crypto.randomBytes(12).toString('hex'),
    queueNo,
    createdAt: now(),
    status: 'waiting',
    source,
    name: str(name, 60) || `คิว ${queueNo}`,
    note: str(note, 200),
    // Only an existing customer is linked; queue names are never saved as customers.
    customer: customer?.type === 'old' && db.customers.some((c) => c.id === customer.id) ? { type: 'old', id: customer.id } : null,
    items: items.map((i) => ({
      menuItemId: i.menuItemId, sweetness: i.sweetness ?? null, toppingIds: i.toppingIds || [],
      discountIds: i.discountIds || [], note: str(i.note, 200), qty: Math.max(1, Math.floor(Number(i.qty) || 1)),
    })),
    lines,
    total: s.total,
    cups: s.cups,
    staffId,
    staffName,
  };
  db.queues.push(queue);
  save();
  events.broadcast('queues', { id: queue.id, status: queue.status });
  return queue;
}

app.post('/api/queues', need('pos'), h((req) => {
  const b = req.body || {};
  return createQueue({ name: b.name, note: b.note, items: b.items, customer: b.customer, staffId: req.user.id, staffName: req.user.name });
}));

app.get('/api/queues/:id/slip', anyOf('queue', 'pos'), h((req) => {
  const q = findQueue(req.params.id);
  const slip = q.paymentClaim?.slipId && getDb().slips.find((x) => x.id === q.paymentClaim.slipId);
  if (!slip) fail(404, 'ไม่มีสลิป');
  return { image: slip.image, at: slip.createdAt };
}));

app.post('/api/queues/:id/status', need('queue'), h((req) => {
  const q = findQueue(req.params.id);
  const status = req.body?.status;
  if (!['waiting', 'done', 'cancelled'].includes(status)) fail(400, 'สถานะไม่ถูกต้อง');
  if (q.status === 'paid') fail(400, 'คิวนี้ชำระเงินแล้ว');
  if (q.status === 'cancelled' && status !== 'waiting') fail(400, 'คิวนี้ถูกยกเลิกแล้ว');
  q.status = status;
  if (status === 'done') q.doneAt = now();
  if (status === 'cancelled') {
    q.cancelledAt = now();
    q.cancelledBy = req.user.name;
    q.cancelReason = str(req.body?.reason, 200);
  }
  q.updatedAt = now();
  markDirty('queues', q.createdAt);
  save();
  events.broadcast('queues', { id: q.id, status: q.status });
  return q;
}));

app.post('/api/queues/:id/pay', need('queue'), h((req) => {
  const q = findQueue(req.params.id);
  if (q.status === 'paid') fail(400, 'คิวนี้ชำระเงินแล้ว');
  if (q.status === 'cancelled') fail(400, 'คิวนี้ถูกยกเลิกแล้ว');
  // Redeem stamps at pickup: put the free cups on the most expensive eligible drinks.
  let items = q.items.map((i) => ({ ...i, rewardQty: 0 }));
  let toRedeem = Math.max(0, Math.floor(Number(req.body?.redeemCups) || 0));
  if (toRedeem) {
    const excluded = new Set(getDb().settings.loyalty?.excludeCategoryIds || []);
    const byPrice = items.map((_, i) => i)
      .filter((i) => !excluded.has(q.lines[i]?.categoryId))
      .sort((a, b) => (q.lines[b]?.unitPrice || 0) - (q.lines[a]?.unitPrice || 0));
    for (const i of byPrice) {
      const take = Math.min(toRedeem, items[i].qty);
      items[i].rewardQty = take;
      toRedeem -= take;
      if (!toRedeem) break;
    }
    if (toRedeem) fail(400, 'จำนวนแก้วที่แลกมากกว่าเครื่องดื่มในคิว');
  }
  const order = createOrder({
    items,
    customer: q.customer,
    customerName: q.customer ? undefined : q.name,
    paymentMethod: req.body?.paymentMethod,
    cashReceived: req.body?.cashReceived,
    user: req.user,
    extra: { queueId: q.id, queueNo: q.queueNo, source: q.source || 'staff' },
  });
  q.status = 'paid';
  q.paidAt = now();
  q.orderId = order.id;
  q.orderNo = order.orderNo;
  q.total = order.total;
  q.updatedAt = now();
  markDirty('queues', q.createdAt);
  save();
  events.broadcast('queues', { id: q.id, status: q.status });
  return { queue: q, order };
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
    // Undo the stamp card: take back stamps earned, give back stamps spent.
    if (o.loyalty?.earned) addPoints(c, -o.loyalty.earned, 'void', { order: o, user: req.user, note: 'ยกเลิกบิล: หักแต้มที่ได้' });
    if (o.loyalty?.used) addPoints(c, o.loyalty.used, 'void', { order: o, user: req.user, note: 'ยกเลิกบิล: คืนแต้มที่แลก' });
  }
  applyStock(o, +1, req.user);
  save();
  if (lineOn('void')) line.pushQuiet(lineGroupId(), [line.voidFlex(o, todayTotals())]);
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
  if (b.loyalty && typeof b.loyalty === 'object') {
    const cur = s.loyalty || {};
    const cups = Math.trunc(Number(b.loyalty.cupsPerReward ?? cur.cupsPerReward));
    if (!(cups >= 1 && cups <= 100)) fail(400, 'จำนวนแก้วที่ต้องสะสมต้องอยู่ระหว่าง 1–100');
    s.loyalty = {
      enabled: b.loyalty.enabled !== undefined ? !!b.loyalty.enabled : cur.enabled !== false,
      cupsPerReward: cups,
      rewardMaxValue: num(b.loyalty.rewardMaxValue ?? cur.rewardMaxValue),
      excludeCategoryIds: (Array.isArray(b.loyalty.excludeCategoryIds) ? b.loyalty.excludeCategoryIds : cur.excludeCategoryIds || [])
        .filter((id) => getDb().categories.some((c) => c.id === id)),
    };
  }
  if (b.contacts && typeof b.contacts === 'object') {
    const url = (v) => {
      const x = str(v, 300);
      if (!x) return '';
      if (!/^https?:\/\/[^\s]+$/i.test(x)) fail(400, `ลิงก์ไม่ถูกต้อง: ${x} (ต้องขึ้นต้นด้วย https://)`);
      return x;
    };
    s.contacts = Object.fromEntries(CONTACT_KEYS.map((k) => [k, url(b.contacts[k])]));
  }
  if (b.selfOrder && typeof b.selfOrder === 'object') {
    s.selfOrder = { enabled: b.selfOrder.enabled !== false, message: str(b.selfOrder.message, 200) };
  }
  if (b.line && typeof b.line === 'object') {
    const cur = s.line || {};
    s.line = {
      groupId: b.line.groupId !== undefined ? str(b.line.groupId, 40).replace(/[^A-Za-z0-9]/g, '') : cur.groupId || '',
      sale: b.line.sale !== undefined ? !!b.line.sale : cur.sale !== false,
      void: b.line.void !== undefined ? !!b.line.void : cur.void !== false,
      lowStock: b.line.lowStock !== undefined ? !!b.line.lowStock : cur.lowStock !== false,
      lead: b.line.lead !== undefined ? !!b.line.lead : cur.lead !== false,
      leadGroupId: b.line.leadGroupId !== undefined ? str(b.line.leadGroupId, 40).replace(/[^A-Za-z0-9]/g, '') : cur.leadGroupId || '',
    };
  }
  if (Array.isArray(b.sweetnessLevels)) {
    const lv = [...new Set(b.sweetnessLevels.map(Number).filter((n) => Number.isFinite(n) && n >= 0 && n <= 200))].sort((a, b2) => a - b2);
    if (lv.length) s.sweetnessLevels = lv;
  }
  save();
  return s;
}));

app.get('/api/line/status', need('settings'), h(() => ({
  configured: line.lineConfigured(),
  groupId: lineGroupId(),
  envGroupId: process.env.LINE_GROUP_ID || '',
  groups: getDb().meta.lineGroups || [],
  webhookPath: '/api/line/webhook',
  ...line.lineState,
})));

const lineSend = async (messages) => {
  if (!line.lineConfigured()) fail(400, 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN / LINE_CHANNEL_SECRET บนเซิร์ฟเวอร์');
  if (!lineGroupId()) fail(400, 'ยังไม่ได้ระบุ Group ID');
  try {
    await line.push(lineGroupId(), messages);
  } catch (e) {
    fail(502, e.message);
  }
  return { ok: true };
};
// Async handlers: errors are passed to the error middleware explicitly.
app.post('/api/line/test', need('settings'), (req, res, next) => {
  lineSend([{ type: 'text', text: `✅ ทดสอบการแจ้งเตือนจาก ${getDb().settings.shopName} โดย ${req.user.name}` }]).then((r) => res.json(r), next);
});
// Sample trial-request card, sent to the lead target group.
app.post('/api/line/test-lead', need('settings'), (req, res, next) => {
  if (!line.lineConfigured()) return next(new HttpError(400, 'ยังไม่ได้ตั้งค่า LINE token บนเซิร์ฟเวอร์'));
  if (!leadGroupId()) return next(new HttpError(400, 'ยังไม่ได้ระบุ Group ID'));
  const sample = { name: 'ตัวอย่าง (ทดสอบ)', shop: 'ร้านกาแฟตัวอย่าง', phone: '0800000000', lineId: '', note: 'ข้อความทดสอบการแจ้งเตือนผู้สนใจ', createdAt: now() };
  line.push(leadGroupId(), [line.leadFlex(sample)]).then(() => res.json({ ok: true }), (e) => next(new HttpError(502, e.message)));
});
app.post('/api/line/summary', need('reports'), (req, res, next) => {
  lineSend([line.summaryFlex(buildReport(getDb(), parseRange()), getDb().settings.shopName)]).then((r) => res.json(r), next);
});

app.get('/api/leads', ownerOnly, h(() => [...getDb().leads].reverse()));
app.delete('/api/leads/:id', ownerOnly, h((req) => {
  getDb().leads = getDb().leads.filter((x) => x.id !== req.params.id);
  save();
  return { ok: true };
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
