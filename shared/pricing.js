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
 * Menu recipe for one cup after the chosen toppings that replace an ingredient
 * (e.g. "oat milk" replaces fresh milk: the fresh milk line is dropped, the topping's own recipe adds the oat milk).
 * `replaced` = ingredient ids to drop; defaults to what the toppings say.
 */
export function effectiveRecipe(item, toppings = [], replaced = null) {
  const removed = new Set(replaced || toppings.flatMap((t) => t?.replaceIngredientIds || []));
  const recipe = item?.recipe || [];
  return removed.size ? recipe.filter((r) => !removed.has(r.ingredientId)) : recipe;
}

// ---------- sweetness -> stock ----------
// Recipe lines can carry a role: 'sweet' (condensed milk / syrup: scales with the sweetness level) or
// 'fill' (e.g. fresh milk: takes up whatever the sweetener gave back, so the cup's volume stays the same).
export const DEFAULT_SWEET_AMOUNTS = { 0: 0, 25: 7, 50: 15, 75: 22, 100: 30 };
export const DEFAULT_CUP_VOLUME = 180;

/** Share of the 100% sweetener amount for a level, from the shop's table (100 = 30 ml, 50 = 15 ml ...). */
export function sweetRatio(level, amounts = DEFAULT_SWEET_AMOUNTS) {
  if (level == null || level === '') return 1; // no level chosen = the recipe as written
  const table = { ...DEFAULT_SWEET_AMOUNTS, ...(amounts || {}) };
  const full = Number(table[100]) || 0;
  if (!(full > 0)) return Number(level) / 100;
  const v = table[level];
  return v != null && v !== '' ? Math.max(0, Number(v) || 0) / full : Math.max(0, Number(level)) / 100;
}

/**
 * Ingredients for ONE cup of a line: the menu recipe after replacements (oat milk instead of fresh milk)
 * and sweetness (sweetener scaled, the 'fill' line topped up by the difference), plus the toppings' recipes.
 * If the fill ingredient was replaced by a topping, that topping's first recipe line takes the top-up instead.
 * Returns [{ ingredientId, qty }] (same ingredient may appear more than once).
 */
export function cupStock(item, chosenToppings = [], { replaced = null, sweetness = null, sweetAmounts } = {}) {
  const removed = new Set(replaced || chosenToppings.flatMap((t) => t?.replaceIngredientIds || []));
  const ratio = sweetRatio(sweetness, sweetAmounts);
  const recipe = item?.recipe || [];
  let given = 0; // sweetener taken out (or added) vs. the recipe, in recipe units
  const out = [];
  for (const r of recipe) {
    if (r.role !== 'sweet') continue;
    const q = round2((Number(r.qty) || 0) * ratio);
    given += (Number(r.qty) || 0) - q;
    if (!removed.has(r.ingredientId)) out.push({ ingredientId: r.ingredientId, qty: q });
  }
  const fill = recipe.find((r) => r.role === 'fill');
  for (const r of recipe) {
    if (r.role === 'sweet' || removed.has(r.ingredientId)) continue;
    const q = Number(r.qty) || 0;
    out.push({ ingredientId: r.ingredientId, qty: round2(r === fill ? Math.max(0, q + given) : q) });
  }
  const fillMovesTo = fill && removed.has(fill.ingredientId)
    ? chosenToppings.find((t) => (t?.replaceIngredientIds || []).includes(fill.ingredientId) && t.recipe?.length) : null;
  for (const t of chosenToppings) {
    (t?.recipe || []).forEach((r, i) => {
      const extra = t === fillMovesTo && i === 0 ? given : 0;
      out.push({ ingredientId: r.ingredientId, qty: round2(Math.max(0, (Number(r.qty) || 0) + extra)) });
    });
  }
  return out;
}

export const CUSTOM_DISCOUNT_ID = 'custom';
const fmtNum = (n) => String(round2(n));

/**
 * A discount typed in at the counter for one line: { name, type: 'percent' | 'amount', value }.
 * amount = baht off per cup (same as catalog discounts). Returns null when there's nothing to apply;
 * a discount without a name is not applied (the server rejects it, the POS asks for one).
 */
export function cleanCustomDiscount(c) {
  if (!c) return null;
  const type = c.type === 'percent' ? 'percent' : 'amount';
  const raw = Math.max(0, Number(c.value) || 0);
  const value = type === 'percent' ? Math.min(100, raw) : raw;
  const name = String(c.name || '').trim().slice(0, 60);
  if (!value || !name) return null;
  return { name, type, value: round2(value) };
}
export const customDiscountLabel = (c) => (c.type === 'percent' ? `ลด ${fmtNum(c.value)}%` : `ลด ${fmtNum(c.value)} ฿/แก้ว`);

/**
 * Roast toppings a menu item must choose one of: the given (available) roast toppings when its category
 * asks for a roast (e.g. coffee). Empty = no roast choice for this item.
 */
export function roastChoices(item, categories = [], toppings = []) {
  const cat = item && categories.find((c) => c.id === item.categoryId);
  return cat?.requireRoast ? toppings.filter((t) => t.isRoast) : [];
}

/**
 * Build a priced cart line from ids + catalog.
 * input: { menuItemId, toppingIds, discountIds, customDiscount, sweetness, qty, note, rewardQty }
 * rewardQty: cups of this line redeemed with loyalty stamps (each free up to catalog.loyalty.rewardMaxValue).
 */
export function priceLine(input, catalog) {
  const { menuItems = [], toppings = [], discounts = [], categories = [], ingredients = [] } = catalog;
  const item = menuItems.find((m) => m.id === input.menuItemId);
  if (!item) throw new Error('ไม่พบเมนูที่เลือก');
  const qty = Math.max(1, Math.floor(Number(input.qty) || 1));
  const cat = categories.find((c) => c.id === item.categoryId);

  const chosen = (input.toppingIds || []).map((id) => toppings.find((t) => t.id === id)).filter(Boolean);
  const tops = chosen.map((t) => ({ id: t.id, name: t.name, price: round2(t.price), cost: unitCost(t, ingredients) }));
  // Ingredients of the menu recipe that a chosen topping replaces: not costed here, not cut from stock.
  const recipeIds = new Set((item.recipe || []).map((r) => r.ingredientId));
  const replaced = [...new Set(chosen.flatMap((t) => t.replaceIngredientIds || []))].filter((id) => recipeIds.has(id));
  const sweetAmounts = catalog.settings?.sweetAmounts;
  // What one cup really uses (sweetness + replacements); stored on the line so a void puts back exactly this.
  const stockPerCup = item.recipe ? cupStock(item, chosen, { replaced, sweetness: input.sweetness, sweetAmounts }) : [];
  const menuPart = item.recipe ? cupStock(item, [], { replaced, sweetness: input.sweetness, sweetAmounts }) : [];
  // Costs follow the cup: recipe-costed menus use the adjusted recipe; a topping that took the milk top-up pays for it.
  const itemCost = item.costMode === 'recipe' && item.recipe?.length ? round2(recipeCost(menuPart, ingredients)) : unitCost(item, ingredients);
  const topExtra = item.recipe ? round2(recipeCost(stockPerCup, ingredients) - recipeCost(menuPart, ingredients)
    - chosen.reduce((s, t) => s + recipeCost(t.recipe || [], ingredients), 0)) : 0;
  const recipeTops = chosen.some((t) => t.costMode === 'recipe');

  const unitPrice = round2(Number(item.price) + tops.reduce((s, t) => s + t.price, 0));
  const unitCostVal = round2(itemCost + tops.reduce((s, t) => s + t.cost, 0) + (recipeTops ? topExtra : 0));
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
  const custom = cleanCustomDiscount(input.customDiscount);
  if (custom) {
    const amt = Math.min(remaining, discountAmount(custom, unitPrice, qty));
    remaining = round2(remaining - amt);
    discs.push({ id: CUSTOM_DISCOUNT_ID, name: `${custom.name} (${customDiscountLabel(custom)})`, type: custom.type, value: custom.value, custom: true, amount: round2(amt) });
  }

  const discountTotal = round2(discs.reduce((s, d) => s + d.amount, 0));
  return {
    menuItemId: item.id,
    name: item.name,
    categoryId: item.categoryId,
    categoryName: cat ? cat.name : '',
    price: round2(item.price),
    sweetness: input.sweetness ?? null,
    toppings: tops,
    replacedIngredientIds: replaced,
    stockPerCup,
    discounts: discs,
    customDiscount: custom,
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
