// Menu permissions. Owners always have every permission; staff get the ones ticked for them.
export const PERMISSIONS = [
  { key: 'pos', label: 'ขายหน้าร้าน' },
  { key: 'orders', label: 'ประวัติการขาย' },
  { key: 'reports', label: 'รายงานยอดขาย / กำไร' },
  { key: 'products', label: 'จัดการเมนู / ท็อปปิ้ง / ส่วนลด' },
  { key: 'stock', label: 'จัดการสต๊อก' },
  { key: 'expenses', label: 'ค่าใช้จ่าย' },
  { key: 'customers', label: 'ข้อมูลลูกค้า' },
  { key: 'settings', label: 'ตั้งค่าร้าน' },
];

// User management is owner-only and cannot be granted to staff.
export const OWNER_ONLY = ['users'];

export const DEFAULT_STAFF_PERMISSIONS = ['pos', 'orders'];

export const ROLES = { owner: 'เจ้าของร้าน', staff: 'พนักงาน' };

export function hasPerm(user, key) {
  if (!user) return false;
  if (user.role === 'owner') return true;
  if (OWNER_ONLY.includes(key)) return false;
  return Array.isArray(user.permissions) && user.permissions.includes(key);
}
