import { round2, cupStock } from '../shared/pricing.js';
import { isIngredientPurchase } from '../shared/expenses.js';

const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

export const APPS = { grab: 'Grab', lineman: 'LINE MAN' };
// Where a bill came from: the counter, a staff queue, the customer QR menu, or a delivery app.
export const CHANNELS = { counter: 'หน้าร้าน', queue: 'คิว (จ่ายตอนรับ)', qr: 'ลูกค้าสั่งผ่าน QR', grab: 'Grab', lineman: 'LINE MAN' };
export const channelOf = (o) => (o.channel && APPS[o.channel] ? o.channel : o.queueId ? (o.source === 'customer' ? 'qr' : 'queue') : 'counter');

/**
 * Cash in the shop right now: the last count ("set") + cash sales since − cash sales voided since
 * − expenses paid from the drawer since ± cash put in / taken out since. null until a first count.
 */
export function cashDrawer(db) {
  const moves = db.cashMoves || [];
  const sets = moves.filter((m) => m.type === 'set');
  if (!sets.length) return null;
  const last = sets.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  const since = last.createdAt;
  const sum = (arr, f) => round2(arr.reduce((s, x) => s + (Number(f(x)) || 0), 0));
  const cashOrders = db.orders.filter((o) => o.paymentMethod === 'cash');
  const sales = sum(cashOrders.filter((o) => o.createdAt > since && o.status !== 'void'), (o) => o.total);
  // A bill sold before the count but voided after it: that money was handed back from the drawer.
  const refunds = sum(cashOrders.filter((o) => o.createdAt <= since && o.status === 'void' && o.voidedAt > since), (o) => o.total);
  const expenses = sum(db.expenses.filter((e) => e.paidFromCash && e.createdAt > since), (e) => e.amount);
  const after = moves.filter((m) => m.createdAt > since);
  const cashIn = sum(after.filter((m) => m.type === 'in'), (m) => m.amount);
  const cashOut = sum(after.filter((m) => m.type === 'out'), (m) => m.amount);
  return {
    balance: round2(last.amount + sales - refunds - expenses + cashIn - cashOut),
    since, counted: last.amount, countedBy: last.userName,
    sales, refunds, expenses, cashIn, cashOut,
  };
}

export function parseRange(from, to) {
  const today = localDate(new Date());
  const f = /^\d{4}-\d{2}-\d{2}$/.test(from || '') ? from : today;
  const t = /^\d{4}-\d{2}-\d{2}$/.test(to || '') ? to : f;
  const [fy, fm, fd] = f.split('-').map(Number);
  const [ty, tm, td] = t.split('-').map(Number);
  let start = new Date(fy, fm - 1, fd, 0, 0, 0, 0);
  let end = new Date(ty, tm - 1, td, 23, 59, 59, 999);
  if (start > end) [start, end] = [new Date(ty, tm - 1, td), new Date(fy, fm - 1, fd, 23, 59, 59, 999)];
  return { from: localDate(start), to: localDate(end), start, end };
}

export const inRange = (iso, { start, end }) => {
  const d = new Date(iso);
  return d >= start && d <= end;
};

function eachDay(start, end) {
  const days = [];
  const d = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  while (d <= end && days.length < 400) {
    days.push(localDate(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

export function buildReport(db, range) {
  const itemById = new Map((db.menuItems || []).map((m) => [m.id, m]));
  const catById = new Map((db.categories || []).map((c) => [c.id, c]));
  const currentNames = (l) => {
    const m = itemById.get(l.menuItemId);
    const c = catById.get(m?.categoryId || l.categoryId);
    return { name: m?.name || l.name, category: c?.name || l.categoryName || '-' };
  };
  const orders = db.orders.filter((o) => inRange(o.createdAt, range));
  const paid = orders.filter((o) => o.status === 'paid');
  const voided = orders.filter((o) => o.status === 'void');
  const allExpenses = db.expenses.filter((e) => {
    const d = e.date || localDate(e.createdAt);
    return d >= range.from && d <= range.to;
  });
  // Operating expenses go into the P&L; ingredient purchases are shown separately (already in cost of goods).
  const expenses = allExpenses.filter((e) => !isIngredientPurchase(e));
  const purchases = allExpenses.filter(isIngredientPurchase);

  const sum = (arr, f) => round2(arr.reduce((s, x) => s + (Number(f(x)) || 0), 0));

  const sales = sum(paid, (o) => o.total);
  const cost = sum(paid, (o) => o.cost);
  const expenseTotal = sum(expenses, (e) => e.amount);
  const purchaseTotal = sum(purchases, (e) => e.amount);
  const capitalIn = sum((db.capital || []).filter((c) => c.date >= range.from && c.date <= range.to), (c) => c.amount);
  const grossProfit = round2(sales - cost);

  const totals = {
    orders: paid.length,
    cups: paid.reduce((s, o) => s + o.items.reduce((a, l) => a + l.qty, 0), 0),
    gross: sum(paid, (o) => o.gross),
    discount: sum(paid, (o) => o.discountTotal),
    customDiscount: round2(paid.reduce((s, o) => s + o.items.reduce((a, l) => a + l.discounts.filter((d) => d.custom).reduce((b, d) => b + d.amount, 0), 0), 0)),
    sales,
    cash: sum(paid.filter((o) => o.paymentMethod === 'cash'), (o) => o.total),
    transfer: sum(paid.filter((o) => o.paymentMethod === 'transfer'), (o) => o.total),
    cashCount: paid.filter((o) => o.paymentMethod === 'cash').length,
    transferCount: paid.filter((o) => o.paymentMethod === 'transfer').length,
    // Delivery apps (Grab / LINE MAN) are paid through the app, not into the shop's cash or account.
    app: sum(paid.filter((o) => o.paymentMethod === 'app'), (o) => o.total),
    appCount: paid.filter((o) => o.paymentMethod === 'app').length,
    byApp: Object.fromEntries(Object.keys(APPS).map((k) => [k, {
      sales: sum(paid.filter((o) => o.channel === k), (o) => o.total),
      orders: paid.filter((o) => o.channel === k).length,
    }])),
    cost,
    grossProfit,
    grossMargin: sales > 0 ? round2((grossProfit / sales) * 100) : 0,
    expenses: expenseTotal,
    netProfit: round2(grossProfit - expenseTotal),
    // Owner capital is shown beside the P&L, never inside it.
    ingredientPurchases: purchaseTotal,
    spending: round2(expenseTotal + purchaseTotal), // all cash paid out in the range
    capitalIn,
    expensesAfterCapital: round2(expenseTotal + purchaseTotal - capitalIn),
    avgPerOrder: paid.length ? round2(sales / paid.length) : 0,
    voidCount: voided.length,
    voidAmount: sum(voided, (o) => o.total),
    newCustomers: paid.filter((o) => o.customerType === 'new').length,
    returningCustomers: paid.filter((o) => o.customerType === 'old').length,
  };

  // Daily breakdown
  const byDay = new Map(eachDay(range.start, range.end).map((d) => [d, {
    date: d, orders: 0, cups: 0, sales: 0, cash: 0, transfer: 0, app: 0, cost: 0, expenses: 0,
  }]));
  for (const o of paid) {
    const row = byDay.get(localDate(o.createdAt));
    if (!row) continue;
    row.orders += 1;
    row.cups += o.items.reduce((a, l) => a + l.qty, 0);
    row.sales += o.total;
    row.cost += o.cost;
    if (o.paymentMethod === 'cash') row.cash += o.total;
    else if (o.paymentMethod === 'app') row.app += o.total;
    else row.transfer += o.total;
  }
  for (const e of expenses) {
    const row = byDay.get(e.date || localDate(e.createdAt));
    if (row) row.expenses += Number(e.amount) || 0;
  }
  const daily = [...byDay.values()].map((r) => ({
    ...r,
    sales: round2(r.sales), cash: round2(r.cash), transfer: round2(r.transfer), app: round2(r.app),
    cost: round2(r.cost), expenses: round2(r.expenses),
    grossProfit: round2(r.sales - r.cost),
    netProfit: round2(r.sales - r.cost - r.expenses),
  }));

  // Menu / category / topping / discount breakdowns
  const items = new Map();
  const cats = new Map();
  const tops = new Map();
  const discs = new Map();
  const sweet = new Map();
  const roasts = new Map();
  const channels = new Map(Object.keys(CHANNELS).map((k) => [k, { key: k, name: CHANNELS[k], orders: 0, cups: 0, sales: 0 }]));
  const used = new Map(); // ingredientId -> qty cut by these sales
  const topById = new Map((db.toppings || []).map((t) => [t.id, t]));
  const isRoast = (t) => (topById.has(t.id) ? !!topById.get(t.id).isRoast : /^คั่ว/.test(t.name));
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, sales: 0 }));
  const staff = new Map();

  for (const o of paid) {
    const h = new Date(o.createdAt).getHours();
    hours[h].orders += 1;
    hours[h].sales += o.total;
    const ch = channels.get(channelOf(o));
    ch.orders += 1;
    ch.cups += o.items.reduce((a, l) => a + l.qty, 0);
    ch.sales += o.total;
    const s = staff.get(o.staffId) || { name: o.staffName, orders: 0, sales: 0 };
    s.orders += 1;
    s.sales += o.total;
    staff.set(o.staffId, s);

    for (const l of o.items) {
      // Bills keep the names from the day they were sold; report under today's menu / category names.
      const cur = currentNames(l);
      const it = items.get(l.menuItemId) || { name: cur.name, category: cur.category, qty: 0, sales: 0, cost: 0 };
      it.qty += l.qty;
      it.sales += l.total;
      it.cost += l.cost;
      items.set(l.menuItemId, it);

      const c = cats.get(cur.category) || { name: cur.category, qty: 0, sales: 0 };
      c.qty += l.qty;
      c.sales += l.total;
      cats.set(cur.category, c);

      for (const t of l.toppings) {
        // roasts are a choice, not an add-on: counted on their own
        const map = isRoast(t) ? roasts : tops;
        const x = map.get(t.id) || { name: topById.get(t.id)?.name || t.name, qty: 0, sales: 0 };
        x.qty += l.qty;
        x.sales += t.price * l.qty;
        map.set(t.id, x);
      }
      for (const d of l.discounts) {
        // every custom discount shares the id "custom": group those by the reason staff typed instead
        const key = d.custom ? `custom:${l.customDiscount?.name || d.name}` : d.id;
        const x = discs.get(key) || { name: d.custom ? l.customDiscount?.name || d.name : d.name, custom: !!d.custom, count: 0, amount: 0 };
        x.count += 1;
        x.amount += d.amount;
        discs.set(key, x);
      }
      // what this line actually cut from stock (recorded at sale; older bills use today's recipe)
      const perCup = Array.isArray(l.stockPerCup) ? l.stockPerCup
        : cupStock(db.menuItems.find((m) => m.id === l.menuItemId), l.toppings.map((t) => topById.get(t.id)).filter(Boolean), { replaced: l.replacedIngredientIds });
      for (const r of perCup) used.set(r.ingredientId, (used.get(r.ingredientId) || 0) + r.qty * l.qty);
      if (l.sweetness != null) {
        sweet.set(l.sweetness, (sweet.get(l.sweetness) || 0) + l.qty);
      }
    }
  }

  const fin = (arr) => arr.map((x) => ({
    ...x,
    ...(x.sales != null ? { sales: round2(x.sales) } : {}),
    ...(x.cost != null ? { cost: round2(x.cost), profit: round2(x.sales - x.cost) } : {}),
    ...(x.amount != null ? { amount: round2(x.amount) } : {}),
  }));

  const expenseByCategory = new Map();
  for (const e of allExpenses) {
    const k = e.category || 'อื่นๆ';
    expenseByCategory.set(k, round2((expenseByCategory.get(k) || 0) + (Number(e.amount) || 0)));
  }

  return {
    range: { from: range.from, to: range.to },
    totals,
    daily,
    topItems: fin([...items.values()]).sort((a, b) => b.qty - a.qty || b.sales - a.sales),
    categories: fin([...cats.values()]).sort((a, b) => b.sales - a.sales),
    toppings: fin([...tops.values()]).sort((a, b) => b.qty - a.qty),
    discounts: fin([...discs.values()]).sort((a, b) => b.amount - a.amount),
    sweetness: [...sweet.entries()].map(([level, qty]) => ({ level, qty })).sort((a, b) => a.level - b.level),
    roasts: fin([...roasts.values()]).sort((a, b) => b.qty - a.qty),
    channels: fin([...channels.values()]).filter((c) => c.orders),
    ingredients: [...used.entries()].map(([id, qty]) => {
      const i = (db.ingredients || []).find((x) => x.id === id);
      return { id, name: i?.name || 'วัตถุดิบที่ถูกลบ', unit: i?.unit || '', qty: round2(qty), cost: round2(qty * (Number(i?.costPerUnit) || 0)) };
    }).sort((a, b) => b.cost - a.cost || b.qty - a.qty),
    hours: hours.map((h) => ({ ...h, sales: round2(h.sales) })),
    staff: fin([...staff.values()]).sort((a, b) => b.sales - a.sales),
    expenseByCategory: [...expenseByCategory.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    cashDrawer: cashDrawer(db), // right now, not limited to the range
  };
}
