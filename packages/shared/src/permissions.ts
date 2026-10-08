// สิทธิ์รายข้อ ยกมาจากระบบเดิม (Google Apps Script) ให้ตรงกันทุก key
export const PERMISSIONS = {
  'orders.view': 'ดูออเดอร์สินค้า',
  'orders.create': 'สร้างออเดอร์สินค้า',
  'picks.check': 'ตรวจของที่เบิกตอนส่งมอบ',
  'returns.create': 'บันทึกคืนสินค้า',
  'receive.view': 'ดูใบรับสินค้า',
  'receive.create': 'สร้างใบรับสินค้า',
  'receive.print': 'พิมพ์ใบรับสินค้า',
  'stock.view': 'ดูสต็อก',
  'stock.print': 'พิมพ์รายงานสต็อก',
  'move.view': 'ดูประวัติการย้าย',
  'move.create': 'ย้าย Location',
  'products.manage': 'จัดการทะเบียนสินค้า',
  'locations.view': 'ดูโซนและ Location',
  'locations.edit': 'แก้ไขโซนและ Location',
  'locations.print': 'พิมพ์ป้าย Location',
  'locations.manage': 'จัดการทะเบียนคลัง',
  'users.view': 'ดูผู้ใช้',
  'users.manage': 'จัดการผู้ใช้และสิทธิ์',
  'users.audit': 'ดูประวัติการแก้ไขผู้ใช้',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const PERMISSION_GROUPS: { name: string; items: Permission[] }[] = [
  { name: 'ออเดอร์สินค้า', items: ['orders.view', 'orders.create', 'picks.check', 'returns.create'] },
  { name: 'รับสินค้า', items: ['receive.view', 'receive.create', 'receive.print'] },
  { name: 'สต็อก', items: ['stock.view', 'stock.print'] },
  { name: 'ย้าย Location', items: ['move.view', 'move.create'] },
  { name: 'สินค้า', items: ['products.manage'] },
  { name: 'คลัง โซน และ Location', items: ['locations.view', 'locations.edit', 'locations.print', 'locations.manage'] },
  { name: 'ผู้ใช้', items: ['users.view', 'users.manage', 'users.audit'] },
];

// ตำแหน่งเป็นแค่ค่าเริ่มต้นของสิทธิ์ แก้รายคนได้
export const ROLES = {
  ADMIN: 'ผู้ดูแลระบบ',
  MANAGER: 'ผู้จัดการคลัง',
  WH: 'พนักงานคลัง',
} as const;

export type RoleCode = keyof typeof ROLES;

export const ROLE_DEFAULTS: Record<RoleCode, Permission[]> = {
  ADMIN: ALL_PERMISSIONS,
  MANAGER: ALL_PERMISSIONS.filter((p) => p !== 'users.manage'),
  WH: ['receive.view', 'receive.create', 'stock.view', 'move.view', 'move.create', 'locations.view'],
};

export function isPermission(value: string): value is Permission {
  return value in PERMISSIONS;
}
