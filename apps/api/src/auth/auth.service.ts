import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { User, UserWarehouse } from '@prisma/client';
import { isPermission, LoginResult, RoleCode, SESSION_HOURS, SessionUser } from '@petmore/shared';
import { PrismaService } from '../prisma/prisma.service';
import { verifyPassword } from './password';

export function toSessionUser(user: User & { warehouses: UserWarehouse[] }): SessionUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    roleCode: user.roleCode as RoleCode,
    permissions: user.permissions.filter(isPermission),
    warehouseScope: { all: user.allWarehouses, codes: user.warehouses.map((w) => w.warehouseCode) },
  };
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { username: String(username ?? '').trim() },
      include: { warehouses: true },
    });
    if (!user || !user.active || !(await verifyPassword(String(password ?? ''), user.passwordHash))) {
      throw new UnauthorizedException('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง ตรวจแล้วลองอีกครั้ง');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
    await this.prisma.session.create({ data: { token, userId: user.id, expiresAt } });
    return { token, expiresAt: expiresAt.toISOString(), user: toSessionUser(user) };
  }

  /** คืนผู้ใช้ปัจจุบันจาก token หรือ null ถ้าหมดอายุ / ถูกปิดใช้งาน สิทธิ์อ่านใหม่ทุกครั้ง */
  async resolve(token: string): Promise<{ user: SessionUser; expiresAt: Date } | null> {
    if (!token) return null;
    const session = await this.prisma.session.findUnique({
      where: { token },
      include: { user: { include: { warehouses: true } } },
    });
    if (!session || session.expiresAt.getTime() <= Date.now() || !session.user.active) return null;
    return { user: toSessionUser(session.user), expiresAt: session.expiresAt };
  }

  async logout(token: string) {
    await this.prisma.session.deleteMany({ where: { token } });
  }
}
