import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { hashPassword } from './auth.js';
import { DEFAULT_STAFF_PERMISSIONS } from '../shared/permissions.js';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
const FILE = path.join(DATA_DIR, 'db.json');
const DATABASE_URL = process.env.DATABASE_URL;

export const COLLECTIONS = [
  'users', 'customers', 'categories', 'menuItems', 'toppings', 'discounts',
  'ingredients', 'stockMoves', 'orders', 'expenses', 'queues',
];
// Collections that grow with every sale are stored one row per month in Postgres,
// so a new sale rewrites only the current month instead of the whole history.
const PARTITIONED = ['orders', 'stockMoves', 'queues'];
const SINGLE_KEYS = [...COLLECTIONS.filter((c) => !PARTITIONED.includes(c)), 'settings', 'meta'];

let db = null;
let pool = null;

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();

export function getDb() {
  return db;
}

function normalize(next, meta) {
  for (const c of COLLECTIONS) next[c] = Array.isArray(next[c]) ? next[c] : [];
  next.settings = { ...defaultSettings(), ...(next.settings || {}) };
  next.meta = meta || next.meta || { secret: crypto.randomBytes(32).toString('hex') };
  migrate(next);
  return next;
}

export async function load() {
  if (DATABASE_URL) {
    const { default: pg } = await import('pg');
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });
    await pool.query(`CREATE TABLE IF NOT EXISTS pos_state (
      key text PRIMARY KEY, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await pool.query('SELECT key, data FROM pos_state ORDER BY key');
    if (rows.length) {
      const next = {};
      for (const c of PARTITIONED) next[c] = [];
      for (const r of rows) {
        const [c, month] = r.key.split(':');
        if (month && PARTITIONED.includes(c)) {
          next[c].push(...r.data);
          written.set(r.key, r.data.length);
        } else {
          next[r.key] = r.data;
        }
      }
      for (const c of PARTITIONED) next[c].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      db = normalize(next);
      console.log(`โหลดข้อมูลจาก Postgres (${rows.length} rows)`);
    } else {
      db = seed();
      console.log('สร้างฐานข้อมูลใหม่ใน Postgres พร้อมข้อมูลตัวอย่าง');
    }
  } else {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
      db = normalize(JSON.parse(fs.readFileSync(FILE, 'utf8')));
    } else {
      db = seed();
      console.log('สร้างฐานข้อมูลใหม่พร้อมข้อมูลตัวอย่าง ->', FILE);
    }
  }
  save();
  await flush();
}

export function replaceDb(next) {
  db = normalize(next, db.meta);
  forceAll = true;
  save();
}

// One-off data upgrades for databases created by older versions.
function migrate(d) {
  const done = new Set(d.meta.migrations || []);
  if (!done.has('queue-permission')) {
    // The queue menu was added later: staff who can sell get it by default.
    for (const u of d.users) {
      if (u.role === 'staff' && (u.permissions || []).includes('pos') && !u.permissions.includes('queue')) u.permissions.push('queue');
    }
    done.add('queue-permission');
  }
  d.meta.migrations = [...done];
}

// ---------- persistence ----------
const written = new Map(); // key -> last JSON written (single keys) or row count (monthly partitions)
const dirtyMonths = new Set();
let forceAll = false;
let chain = Promise.resolve();
const monthKey = (c, iso) => `${c}:${String(iso || '').slice(0, 7) || 'none'}`;

/** Mark an existing monthly partition as changed (row edited in place, e.g. a voided order). */
export function markDirty(collection, createdAt) {
  dirtyMonths.add(monthKey(collection, createdAt));
}

function changedEntries() {
  const out = [];
  for (const k of SINGLE_KEYS) {
    const s = JSON.stringify(db[k]);
    if (forceAll || written.get(k) !== s) out.push([k, s, s]);
  }
  for (const c of PARTITIONED) {
    const groups = new Map();
    for (const r of db[c]) {
      const k = monthKey(c, r.createdAt);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    for (const [k, rows] of groups) {
      if (forceAll || dirtyMonths.has(k) || written.get(k) !== rows.length) out.push([k, JSON.stringify(rows), rows.length]);
    }
    for (const k of written.keys()) {
      if (k.startsWith(`${c}:`) && !groups.has(k)) out.push([k, '[]', 0]);
    }
  }
  dirtyMonths.clear();
  forceAll = false;
  return out;
}

async function writeEntries(entries) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [k, json] of entries) {
      await client.query(
        `INSERT INTO pos_state (key, data, updated_at) VALUES ($1, $2::jsonb, now())
         ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
        [k, json],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export function save() {
  if (!pool) {
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, FILE);
    return;
  }
  const entries = changedEntries();
  if (!entries.length) return;
  for (const [k, , mark] of entries) written.set(k, mark);
  // Writes are queued so they reach Postgres in order; on failure the keys are retried.
  chain = chain.then(() => writeEntries(entries)).catch((e) => {
    console.error('บันทึกลง Postgres ไม่สำเร็จ จะลองใหม่:', e.message);
    for (const [k] of entries) written.delete(k);
    setTimeout(save, 5000);
  });
}

export function flush() {
  return chain;
}

function defaultSettings() {
  return {
    shopName: 'MA Coffee',
    address: '',
    phone: '',
    promptPayId: '',
    receiptFooter: 'ขอบคุณที่อุดหนุนค่ะ ☕',
    sweetnessLevels: [25, 50, 75, 100],
    lowStockAlert: true,
  };
}

function seed() {
  const t = now();
  const ing = (name, unit, quantity, costPerUnit, minQty) => ({
    id: uid(), name, unit, quantity, costPerUnit, minQty, createdAt: t, updatedAt: t,
  });
  const ingredients = {
    bean: ing('เมล็ดกาแฟคั่ว', 'กรัม', 2000, 0.8, 500),
    milk: ing('นมสด', 'มล.', 6000, 0.05, 2000),
    oat: ing('นมโอ๊ต', 'มล.', 2000, 0.12, 500),
    cheese: ing('ครีมชีส', 'กรัม', 1000, 0.3, 200),
    thai: ing('ผงชาไทย', 'กรัม', 1000, 0.4, 200),
    green: ing('ผงมัทฉะ', 'กรัม', 500, 1.2, 100),
    syrup: ing('น้ำเชื่อม', 'มล.', 3000, 0.03, 500),
    caramel: ing('ไซรัปคาราเมล', 'มล.', 1000, 0.25, 200),
    cocoa: ing('ผงโกโก้', 'กรัม', 1000, 0.5, 200),
    soda: ing('โซดา', 'มล.', 6000, 0.02, 1000),
    pearl: ing('ไข่มุก', 'กรัม', 2000, 0.1, 300),
    whip: ing('วิปครีม', 'กรัม', 1000, 0.2, 200),
    cup: ing('แก้ว 16 oz + ฝา + หลอด', 'ชุด', 500, 2.5, 100),
  };
  const I = ingredients;
  const cat = (name, icon, sort) => ({ id: uid(), name, icon, sort, active: true, createdAt: t, updatedAt: t });
  const coffee = cat('กาแฟ', '☕', 1);
  const tea = cat('ชา', '🍵', 2);
  const other = cat('อื่นๆ', '🥤', 3);

  const r = (pairs) => pairs.map(([i, qty]) => ({ ingredientId: i.id, qty }));
  const item = (c, name, price, recipe, sort) => ({
    id: uid(), categoryId: c.id, name, price, cost: 0, costMode: 'recipe', recipe: r(recipe),
    active: true, sort, createdAt: t, updatedAt: t,
  });
  const menuItems = [
    item(coffee, 'Espresso', 40, [[I.bean, 18], [I.cup, 1]], 1),
    item(coffee, 'Americano', 45, [[I.bean, 18], [I.syrup, 15], [I.cup, 1]], 2),
    item(coffee, 'Latte', 55, [[I.bean, 18], [I.milk, 150], [I.syrup, 15], [I.cup, 1]], 3),
    item(coffee, 'Cappuccino', 55, [[I.bean, 18], [I.milk, 130], [I.syrup, 15], [I.cup, 1]], 4),
    item(coffee, 'Mocha', 60, [[I.bean, 18], [I.milk, 120], [I.cocoa, 15], [I.cup, 1]], 5),
    item(coffee, 'Caramel Macchiato', 65, [[I.bean, 18], [I.milk, 150], [I.caramel, 20], [I.cup, 1]], 6),
    item(tea, 'ชาไทย', 45, [[I.thai, 20], [I.milk, 100], [I.syrup, 20], [I.cup, 1]], 1),
    item(tea, 'ชาเขียวมัทฉะลาเต้', 60, [[I.green, 8], [I.milk, 150], [I.syrup, 15], [I.cup, 1]], 2),
    item(tea, 'ชามะนาว', 40, [[I.thai, 15], [I.syrup, 25], [I.cup, 1]], 3),
    item(other, 'โกโก้', 50, [[I.cocoa, 25], [I.milk, 150], [I.syrup, 15], [I.cup, 1]], 1),
    item(other, 'อิตาเลียนโซดา', 45, [[I.soda, 200], [I.syrup, 30], [I.cup, 1]], 2),
    item(other, 'นมสดเย็น', 40, [[I.milk, 200], [I.syrup, 20], [I.cup, 1]], 3),
  ];
  const top = (name, price, recipe, sort) => ({
    id: uid(), name, price, cost: 0, costMode: 'recipe', recipe: r(recipe), active: true, sort, createdAt: t, updatedAt: t,
  });
  const toppings = [
    top('เปลี่ยนเป็นนมโอ๊ต', 15, [[I.oat, 150]], 1),
    top('ครีมชีส', 20, [[I.cheese, 30]], 2),
    top('เพิ่มช็อต', 15, [[I.bean, 9]], 3),
    top('วิปครีม', 10, [[I.whip, 20]], 4),
    top('ไข่มุก', 10, [[I.pearl, 50]], 5),
  ];
  const disc = (name, type, value, maxValue, sort) => ({
    id: uid(), name, type, value, maxValue, active: true, sort, createdAt: t, updatedAt: t,
  });
  const discounts = [
    disc('สิทธิร้านขนส่ง', 'amount', 5, 0, 1),
    disc('นำแก้วมาเอง', 'amount', 5, 0, 2),
    disc('สะสมแต้มไลน์ (ฟรี 1 แก้ว ≤ 40 ฿)', 'free', 0, 40, 3),
  ];
  const users = [
    {
      id: uid(), username: 'admin', name: 'เจ้าของร้าน', role: 'owner', permissions: [],
      passwordHash: hashPassword(process.env.ADMIN_PASSWORD || 'admin1234'), active: true, createdAt: t, updatedAt: t,
    },
    {
      id: uid(), username: 'staff', name: 'พนักงาน 1', role: 'staff', permissions: [...DEFAULT_STAFF_PERMISSIONS],
      passwordHash: hashPassword(process.env.STAFF_PASSWORD || '1234'), active: true, createdAt: t, updatedAt: t,
    },
  ];
  return {
    users,
    customers: [],
    categories: [coffee, tea, other],
    menuItems,
    toppings,
    discounts,
    ingredients: Object.values(ingredients),
    stockMoves: [],
    orders: [],
    expenses: [],
    settings: defaultSettings(),
    meta: { secret: crypto.randomBytes(32).toString('hex') },
  };
}
