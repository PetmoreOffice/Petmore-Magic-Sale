import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
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

/** ใส่รหัสผิดกี่ครั้งติดกันถึงล็อก และล็อกนานเท่าไร */
export const LOCK_AFTER = 5;
export const LOCK_MS = 15 * 60_000;

/**
 * กันเดารหัสผ่านรายชื่อผู้ใช้: ผิด 5 ครั้งติดกันต้องรอ 15 นาที เข้าถูกแล้วนับใหม่
 * นับตามชื่อที่พิมพ์ทุกชื่อ (มีบัญชีจริงหรือไม่ก็ตอบเหมือนกัน คนนอกเดาไม่ได้ว่าชื่อไหนมีอยู่)
 * เก็บในหน่วยความจำ (API มีโปรเซสเดียว) เปิด API ใหม่แล้วนับใหม่ ผู้ดูแลจึงปลดล็อกด่วนได้ด้วยการรีสตาร์ท
 */
export class LoginLockout {
  private readonly fails = new Map<string, { count: number; lockedUntil: number }>();

  /** มิลลิวินาทีที่ยังต้องรอ (0 = ลองได้) */
  waitMs(key: string, now = Date.now()): number {
    const f = this.fails.get(key);
    return f && f.lockedUntil > now ? f.lockedUntil - now : 0;
  }

  /** บันทึกว่าผิด คืนจำนวนครั้งที่ยังเหลือก่อนล็อก (0 = เพิ่งถูกล็อก) */
  fail(key: string, now = Date.now()): number {
    const f = this.fails.get(key);
    // ล็อกรอบก่อนหมดเวลาแล้ว เริ่มนับใหม่
    const count = (f && f.lockedUntil <= now && f.count >= LOCK_AFTER ? 0 : f?.count ?? 0) + 1;
    this.fails.set(key, { count, lockedUntil: count >= LOCK_AFTER ? now + LOCK_MS : 0 });
    if (this.fails.size > 10_000) for (const [k, v] of this.fails) if (v.lockedUntil <= now) this.fails.delete(k);
    return Math.max(0, LOCK_AFTER - count);
  }

  clear(key: string) {
    this.fails.delete(key);
  }
}

@Injectable()
export class AuthService {
  private readonly lockout = new LoginLockout();

  constructor(private readonly prisma: PrismaService) {}

  async login(username: string, password: string): Promise<LoginResult> {
    const name = String(username ?? '').trim();
    const key = name.toLowerCase();
    const wait = this.lockout.waitMs(key);
    if (wait) throw new HttpException(`ใส่รหัสผ่านผิดหลายครั้ง บัญชีนี้ถูกพักไว้ชั่วคราว รอ ${Math.ceil(wait / 60_000)} นาทีแล้วลองใหม่ หรือติดต่อผู้ดูแลระบบ`, HttpStatus.TOO_MANY_REQUESTS);
    const user = await this.prisma.user.findUnique({
      where: { username: name },
      include: { warehouses: true },
    });
    if (!user || !user.active || !(await verifyPassword(String(password ?? ''), user.passwordHash))) {
      const left = this.lockout.fail(key);
      throw new UnauthorizedException(
        left === 0
          ? `ใส่รหัสผ่านผิด ${LOCK_AFTER} ครั้ง บัญชีนี้ถูกพักไว้ ${LOCK_MS / 60_000} นาที แล้วลองใหม่ หรือติดต่อผู้ดูแลระบบ`
          : left <= 2
            ? `ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง ลองได้อีก ${left} ครั้งก่อนถูกพัก ${LOCK_MS / 60_000} นาที`
            : 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง ตรวจแล้วลองอีกครั้ง',
      );
    }
    this.lockout.clear(key);
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
