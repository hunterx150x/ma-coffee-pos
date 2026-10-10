// Expense categories shown as chips on the expenses page. "อื่นๆ" lets the user type their own category.
export const INGREDIENT_EXPENSE = 'ค่าวัตถุดิบ';
export const OTHER_EXPENSE = 'อื่นๆ';
export const EXPENSE_CATEGORIES = ['ค่าเช่า', 'ค่าน้ำ-ไฟ', 'ค่าจ้างพนักงาน', INGREDIENT_EXPENSE, 'อุปกรณ์', 'การตลาด', 'ค่าขนส่ง', OTHER_EXPENSE];

// Ingredient purchases are real cash out, but the P&L already charges ingredients as cost of goods sold
// (from each menu's recipe), so they are kept out of operating expenses to avoid counting them twice.
export const isIngredientPurchase = (e) => e?.category === INGREDIENT_EXPENSE;
