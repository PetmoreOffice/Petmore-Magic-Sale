import { ForbiddenException } from '@nestjs/common';
import type { SessionUser } from '@petmore/shared';

export function canAccessWarehouse(user: SessionUser, code: string): boolean {
  return user.warehouseScope.all || user.warehouseScope.codes.includes(code);
}

export function assertWarehouse(user: SessionUser, code: string) {
  if (!canAccessWarehouse(user, code)) throw new ForbiddenException(`บัญชีนี้ไม่มีสิทธิ์ในคลัง ${code} ติดต่อผู้ดูแลระบบหากต้องใช้`);
}

/** เงื่อนไข Prisma สำหรับจำกัดข้อมูลตามคลังที่ผู้ใช้มีสิทธิ์ */
export function warehouseFilter(user: SessionUser): { warehouseCode?: { in: string[] } } {
  return user.warehouseScope.all ? {} : { warehouseCode: { in: user.warehouseScope.codes } };
}
