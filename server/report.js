import { round2 } from '../shared/pricing.js';

const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

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
  const orders = db.orders.filter((o) => inRange(o.createdAt, range));
  const paid = orders.filter((o) => o.status === 'paid');
  const voided = orders.filter((o) => o.status === 'void');
  const expenses = db.expenses.filter((e) => {
    const d = e.date || localDate(e.createdAt);
    return d >= range.from && d <= range.to;
  });

  const sum = (arr, f) => round2(arr.reduce((s, x) => s + (Number(f(x)) || 0), 0));

  const sales = sum(paid, (o) => o.total);
  const cost = sum(paid, (o) => o.cost);
  const expenseTotal = sum(expenses, (e) => e.amount);
  const grossProfit = round2(sales - cost);

  const totals = {
    orders: paid.length,
    cups: paid.reduce((s, o) => s + o.items.reduce((a, l) => a + l.qty, 0), 0),
    gross: sum(paid, (o) => o.gross),
    discount: sum(paid, (o) => o.discountTotal),
    sales,
    cash: sum(paid.filter((o) => o.paymentMethod === 'cash'), (o) => o.total),
    transfer: sum(paid.filter((o) => o.paymentMethod === 'transfer'), (o) => o.total),
    cashCount: paid.filter((o) => o.paymentMethod === 'cash').length,
    transferCount: paid.filter((o) => o.paymentMethod === 'transfer').length,
    cost,
    grossProfit,
    grossMargin: sales > 0 ? round2((grossProfit / sales) * 100) : 0,
    expenses: expenseTotal,
    netProfit: round2(grossProfit - expenseTotal),
    avgPerOrder: paid.length ? round2(sales / paid.length) : 0,
    voidCount: voided.length,
    voidAmount: sum(voided, (o) => o.total),
    newCustomers: paid.filter((o) => o.customerType === 'new').length,
    returningCustomers: paid.filter((o) => o.customerType === 'old').length,
  };

  // Daily breakdown
  const byDay = new Map(eachDay(range.start, range.end).map((d) => [d, {
    date: d, orders: 0, cups: 0, sales: 0, cash: 0, transfer: 0, cost: 0, expenses: 0,
  }]));
  for (const o of paid) {
    const row = byDay.get(localDate(o.createdAt));
    if (!row) continue;
    row.orders += 1;
    row.cups += o.items.reduce((a, l) => a + l.qty, 0);
    row.sales += o.total;
    row.cost += o.cost;
    if (o.paymentMethod === 'cash') row.cash += o.total;
    else row.transfer += o.total;
  }
  for (const e of expenses) {
    const row = byDay.get(e.date || localDate(e.createdAt));
    if (row) row.expenses += Number(e.amount) || 0;
  }
  const daily = [...byDay.values()].map((r) => ({
    ...r,
    sales: round2(r.sales), cash: round2(r.cash), transfer: round2(r.transfer),
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
  const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, orders: 0, sales: 0 }));
  const staff = new Map();

  for (const o of paid) {
    const h = new Date(o.createdAt).getHours();
    hours[h].orders += 1;
    hours[h].sales += o.total;
    const s = staff.get(o.staffId) || { name: o.staffName, orders: 0, sales: 0 };
    s.orders += 1;
    s.sales += o.total;
    staff.set(o.staffId, s);

    for (const l of o.items) {
      const it = items.get(l.menuItemId) || { name: l.name, category: l.categoryName, qty: 0, sales: 0, cost: 0 };
      it.qty += l.qty;
      it.sales += l.total;
      it.cost += l.cost;
      items.set(l.menuItemId, it);

      const c = cats.get(l.categoryName) || { name: l.categoryName || '-', qty: 0, sales: 0 };
      c.qty += l.qty;
      c.sales += l.total;
      cats.set(l.categoryName, c);

      for (const t of l.toppings) {
        const x = tops.get(t.id) || { name: t.name, qty: 0, sales: 0 };
        x.qty += l.qty;
        x.sales += t.price * l.qty;
        tops.set(t.id, x);
      }
      for (const d of l.discounts) {
        const x = discs.get(d.id) || { name: d.name, count: 0, amount: 0 };
        x.count += 1;
        x.amount += d.amount;
        discs.set(d.id, x);
      }
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
  for (const e of expenses) {
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
    hours: hours.map((h) => ({ ...h, sales: round2(h.sales) })),
    staff: fin([...staff.values()]).sort((a, b) => b.sales - a.sales),
    expenseByCategory: [...expenseByCategory.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
  };
}
