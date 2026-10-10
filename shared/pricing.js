// Pricing rules shared by the browser (for display) and the server (authoritative).

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Cost of one unit of a menu item / topping. */
export function unitCost(entity, ingredients = []) {
  if (!entity) return 0;
  if (entity.costMode === 'recipe' && Array.isArray(entity.recipe) && entity.recipe.length) {
    return round2(recipeCost(entity.recipe, ingredients));
  }
  return round2(entity.cost);
}

export function recipeCost(recipe = [], ingredients = []) {
  return recipe.reduce((sum, r) => {
    const ing = ingredients.find((i) => i.id === r.ingredientId);
    return sum + (ing ? (Number(ing.costPerUnit) || 0) * (Number(r.qty) || 0) : 0);
  }, 0);
}

/**
 * Discount amount for one cart line.
 * - amount:  baht off per cup
 * - percent: % off per cup
 * - free:    one cup free, up to maxValue baht (e.g. LINE points: free drink ≤ 40 ฿)
 * Total discount is capped at the line's gross total.
 */
export function discountAmount(discount, unitPrice, qty) {
  const v = Number(discount.value) || 0;
  switch (discount.type) {
    case 'percent':
      return round2(((unitPrice * v) / 100) * qty);
    case 'free': {
      const max = Number(discount.maxValue) || 0;
      return round2(max > 0 ? Math.min(unitPrice, max) : unitPrice);
    }
    case 'amount':
    default:
      return round2(v * qty);
  }
}

/**
 * Build a priced cart line from ids + catalog.
 * input: { menuItemId, toppingIds, discountIds, sweetness, qty, note, rewardQty }
 * rewardQty: cups of this line redeemed with loyalty stamps (each free up to catalog.loyalty.rewardMaxValue).
 */
export function priceLine(input, catalog) {
  const { menuItems = [], toppings = [], discounts = [], categories = [], ingredients = [] } = catalog;
  const item = menuItems.find((m) => m.id === input.menuItemId);
  if (!item) throw new Error('ไม่พบเมนูที่เลือก');
  const qty = Math.max(1, Math.floor(Number(input.qty) || 1));
  const cat = categories.find((c) => c.id === item.categoryId);

  const tops = (input.toppingIds || [])
    .map((id) => toppings.find((t) => t.id === id))
    .filter(Boolean)
    .map((t) => ({ id: t.id, name: t.name, price: round2(t.price), cost: unitCost(t, ingredients) }));

  const unitPrice = round2(Number(item.price) + tops.reduce((s, t) => s + t.price, 0));
  const unitCostVal = round2(unitCost(item, ingredients) + tops.reduce((s, t) => s + t.cost, 0));
  const gross = round2(unitPrice * qty);

  let remaining = gross;
  const discs = [];
  const rewardQty = Math.min(qty, Math.max(0, Math.floor(Number(input.rewardQty) || 0)));
  if (rewardQty > 0) {
    const max = Number(catalog.loyalty?.rewardMaxValue) || 0;
    const amt = Math.min(remaining, round2((max > 0 ? Math.min(unitPrice, max) : unitPrice) * rewardQty));
    remaining = round2(remaining - amt);
    discs.push({ id: LOYALTY_DISCOUNT_ID, name: `แลกแต้มสะสม ${rewardQty} แก้ว`, type: 'loyalty', amount: round2(amt) });
  }
  discs.push(...(input.discountIds || [])
    .map((id) => discounts.find((d) => d.id === id))
    .filter(Boolean)
    .map((d) => {
      const amt = Math.min(remaining, discountAmount(d, unitPrice, qty));
      remaining = round2(remaining - amt);
      return { id: d.id, name: d.name, type: d.type, amount: round2(amt) };
    }));

  const discountTotal = round2(discs.reduce((s, d) => s + d.amount, 0));
  return {
    menuItemId: item.id,
    name: item.name,
    categoryId: item.categoryId,
    categoryName: cat ? cat.name : '',
    price: round2(item.price),
    sweetness: input.sweetness ?? null,
    toppings: tops,
    discounts: discs,
    note: (input.note || '').toString().slice(0, 200),
    qty,
    rewardQty,
    unitPrice,
    unitCost: unitCostVal,
    gross,
    discountTotal,
    total: round2(gross - discountTotal),
    cost: round2(unitCostVal * qty),
  };
}

export function summarize(lines) {
  const gross = round2(lines.reduce((s, l) => s + l.gross, 0));
  const discountTotal = round2(lines.reduce((s, l) => s + l.discountTotal, 0));
  const total = round2(lines.reduce((s, l) => s + l.total, 0));
  const cost = round2(lines.reduce((s, l) => s + l.cost, 0));
  const cups = lines.reduce((s, l) => s + l.qty, 0);
  return { gross, discountTotal, total, cost, cups };
}

// ---------- loyalty stamps ----------
export const LOYALTY_DISCOUNT_ID = 'loyalty';

/**
 * Stamps earned by priced lines: 1 per cup, except excluded categories (e.g. snacks),
 * cups redeemed with stamps, and cups given free by another "free cup" discount.
 */
export function stampsEarned(lines, loyalty) {
  if (!loyalty?.enabled) return 0;
  const excluded = new Set(loyalty.excludeCategoryIds || []);
  return lines.reduce((sum, l) => {
    if (excluded.has(l.categoryId)) return sum;
    const otherFree = (l.discounts || []).some((d) => d.type === 'free') ? 1 : 0;
    return sum + Math.max(0, l.qty - (l.rewardQty || 0) - otherFree);
  }, 0);
}

export const rewardsAvailable = (points, loyalty) =>
  loyalty?.enabled && loyalty.cupsPerReward > 0 ? Math.floor(Math.max(0, points || 0) / loyalty.cupsPerReward) : 0;
