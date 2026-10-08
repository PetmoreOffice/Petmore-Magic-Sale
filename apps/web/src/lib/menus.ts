import type { ComponentType } from 'react';
import {
  ArrowLeftRightIcon, BoxesIcon, ClipboardCheckIcon, ClipboardListIcon, PackagePlusIcon, QrCodeIcon, Undo2Icon, UsersIcon,
} from 'lucide-react';
import type { Permission } from '@petmore/shared';
import type { Tone } from '@/components/magic';

/**
 * เมนูทั้งหมดของแอป ที่เดียว: หน้าแรกใช้วาดการ์ดเมนู หน้าจัดการผู้ใช้ใช้วาดแถบ "เมนูที่เปิดได้"
 * perms = มีข้อใดข้อหนึ่งก็เปิดเมนูได้ (ตรงกับ has() และ RequirePermissions ฝั่งเซิร์ฟเวอร์)
 */
export interface AppMenu {
  to: string;
  title: string;
  /** ชื่อสั้นในคำอธิบายไอคอน */
  short: string;
  hint: string;
  perms: Permission[];
  /** สิทธิ์ทุกข้อที่เกี่ยวกับเมนูนี้ (หน้าจัดการผู้ใช้จัดกลุ่มสิทธิ์ตามเมนู) */
  related: Permission[];
  icon: ComponentType<{ className?: string }>;
  tone: Tone;
  group: 'sales' | 'warehouse' | 'system';
}

export const APP_MENUS: AppMenu[] = [
  { group: 'sales', to: '/orders', related: ['orders.view', 'orders.create'], title: 'ออเดอร์สินค้า', short: 'ออเดอร์', hint: 'จดออเดอร์ของผู้สั่ง และดูออเดอร์ย้อนหลัง', perms: ['orders.view', 'orders.create'], icon: ClipboardListIcon, tone: 'star' },
  { group: 'sales', to: '/check', related: ['picks.check'], title: 'ตรวจของเบิก', short: 'ตรวจของเบิก', hint: 'สแกนของที่เบิกมา เทียบกับออเดอร์ว่าครบ ขาด หรือเกิน', perms: ['picks.check'], icon: ClipboardCheckIcon, tone: 'mint' },
  { group: 'sales', to: '/returns', related: ['returns.create'], title: 'คืนสินค้า', short: 'คืนสินค้า', hint: 'คืนของที่เบิกเกิน ขายไม่หมด หรือปิดงานอีเวนต์', perms: ['returns.create'], icon: Undo2Icon, tone: 'kibble' },
  { group: 'warehouse', to: '/receive', related: ['receive.view', 'receive.create', 'receive.print'], title: 'รับสินค้า', short: 'รับสินค้า', hint: 'สแกนสินค้าและ Location เพิ่มสต็อก', perms: ['receive.create'], icon: PackagePlusIcon, tone: 'sky' },
  { group: 'warehouse', to: '/move', related: ['move.view', 'move.create'], title: 'ย้าย Location', short: 'ย้าย', hint: 'สแกนต้นทาง เลือกสินค้า สแกนปลายทาง', perms: ['move.create'], icon: ArrowLeftRightIcon, tone: 'plum' },
  { group: 'warehouse', to: '/stock', related: ['stock.view', 'stock.print'], title: 'ดูสต็อก', short: 'สต็อก', hint: 'ค้นตาม SKU บาร์โค้ด Location ล็อต', perms: ['stock.view'], icon: BoxesIcon, tone: 'rose' },
  { group: 'warehouse', to: '/labels', related: ['locations.print'], title: 'พิมพ์ป้าย Location', short: 'ป้าย', hint: 'ป้าย QR + บาร์โค้ด A4 หน้าละ 3 ป้าย', perms: ['locations.print'], icon: QrCodeIcon, tone: 'mint' },
  { group: 'system', to: '/users', related: ['users.view', 'users.manage', 'users.audit'], title: 'จัดการผู้ใช้', short: 'ผู้ใช้', hint: 'เพิ่มผู้ใช้ ตั้งตำแหน่ง สิทธิ์ และคลัง', perms: ['users.view', 'users.manage'], icon: UsersIcon, tone: 'star' },
];

/** สิทธิ์ที่ไม่ผูกกับเมนูใด (ทะเบียนสินค้า คลัง/โซน) แสดงต่อท้ายกลุ่มเมนูในหน้าจัดการผู้ใช้ */
export const OTHER_PERMISSION_GROUPS: { name: string; items: Permission[] }[] = [
  { name: 'ทะเบียนสินค้า', items: ['products.manage'] },
  { name: 'คลัง โซน และ Location', items: ['locations.view', 'locations.edit', 'locations.manage'] },
];

export function canOpen(menu: AppMenu, permissions: readonly Permission[]) {
  return menu.perms.some((p) => permissions.includes(p));
}
