import { BadRequestException, Body, Controller, ConflictException, Get, Injectable, Module, Post } from '@nestjs/common';
import { isPermission, isRoleCode, ManagedUser, SessionUser, UserAuditEntry, UserInput } from '@petmore/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { toSessionUser } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import { audit, requireRequestId, requireText } from '../common/util';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<ManagedUser[]> {
    const users = await this.prisma.user.findMany({ include: { warehouses: true }, orderBy: { username: 'asc' } });
    return users.map((u) => ({ ...toSessionUser(u), active: u.active, revision: u.revision }));
  }

  async save(actor: SessionUser, input: UserInput): Promise<ManagedUser> {
    requireRequestId(input.requestId);
    const username = requireText(input.username, 'ชื่อผู้ใช้', 50);
    // ตรวจรูปแบบเฉพาะตอนสร้าง ชื่อผู้ใช้เปลี่ยนไม่ได้ บัญชีเดิมที่ชื่อสั้นกว่า (เช่น sa) ต้องแก้ได้
    if (input.create && !/^[a-zA-Z0-9._-]{3,50}$/.test(username)) throw new BadRequestException('ชื่อผู้ใช้ต้องยาว 3 ตัวขึ้นไป ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข . _ และ -');
    const displayName = requireText(input.displayName, 'ชื่อที่แสดง', 100);
    if (!isRoleCode(String(input.role))) throw new BadRequestException('เลือกตำแหน่ง');
    const permissions = [...new Set((input.permissions ?? []).filter(isPermission))];
    const codes = [...new Set(input.warehouseScope?.codes ?? [])];
    const password = input.password ?? '';
    if ((input.create || password) && password.length < 8) throw new BadRequestException('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
    if (actor.username === username && !input.active) throw new BadRequestException('ปิดใช้งานบัญชีที่กำลังใช้อยู่ไม่ได้ ให้ผู้ดูแลคนอื่นปิดแทน');
    // กันล็อกตัวเองออก: ถ้าเอาสิทธิ์จัดการผู้ใช้ของตัวเองออก จะไม่มีใครเข้ามาแก้คืนได้
    if (actor.username === username && !permissions.includes('users.manage')) {
      throw new BadRequestException('เอาสิทธิ์ "จัดการผู้ใช้และสิทธิ์" ออกจากบัญชีที่กำลังใช้อยู่ไม่ได้ ให้ผู้ดูแลคนอื่นทำแทน');
    }

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { username }, include: { warehouses: true } });
      if (input.create && before) throw new ConflictException('ชื่อผู้ใช้นี้มีคนใช้แล้ว ใช้ชื่ออื่น');
      if (!input.create && (!before || before.revision !== input.revision)) {
        throw new ConflictException('มีคนแก้ผู้ใช้นี้ไปก่อน โหลดหน้าใหม่แล้วแก้อีกครั้ง');
      }
      const validCodes = (await tx.warehouse.findMany({ where: { code: { in: codes }, active: true } })).map((w) => w.code);
      const data = {
        displayName,
        roleCode: input.role,
        active: !!input.active,
        permissions,
        allWarehouses: !!input.warehouseScope?.all,
        ...(password ? { passwordHash: await hashPassword(password) } : {}),
      };
      const user = before
        ? await tx.user.update({ where: { id: before.id }, data: { ...data, revision: { increment: 1 } } })
        : await tx.user.create({ data: { ...data, username, passwordHash: data.passwordHash! } });
      await tx.userWarehouse.deleteMany({ where: { userId: user.id } });
      await tx.userWarehouse.createMany({ data: validCodes.map((warehouseCode) => ({ userId: user.id, warehouseCode })) });
      if (!user.active || password) await tx.session.deleteMany({ where: { userId: user.id, NOT: { userId: actor.id } } });
      const after = await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: { warehouses: true } });
      await audit(tx, 'user', username, actor.id, before && toSessionUser(before), {
        ...toSessionUser(after),
        active: after.active,
        passwordChanged: !!password,
      });
      return { ...toSessionUser(after), active: after.active, revision: after.revision };
    });
  }

  /** ประวัติ 200 ครั้งล่าสุด พร้อมชื่อคนแก้ (auditLog เก็บแค่ id) */
  async audit(): Promise<UserAuditEntry[]> {
    const logs = await this.prisma.auditLog.findMany({ where: { entity: 'user' }, orderBy: { createdAt: 'desc' }, take: 200 });
    const actors = await this.prisma.user.findMany({
      where: { id: { in: [...new Set(logs.map((l) => l.actorId))] } },
      select: { id: true, displayName: true },
    });
    const names = new Map(actors.map((a) => [a.id, a.displayName]));
    return logs.map((l) => ({
      id: l.id,
      username: l.entityId,
      actor: names.get(l.actorId) ?? 'ไม่ทราบ',
      createdAt: l.createdAt.toISOString(),
      before: l.before as UserAuditEntry['before'],
      after: l.after as UserAuditEntry['after'],
    }));
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @RequirePermissions('users.view')
  list() {
    return this.users.list();
  }

  @Post()
  @RequirePermissions('users.manage')
  save(@CurrentUser() actor: SessionUser, @Body() body: UserInput) {
    return this.users.save(actor, body);
  }

  @Get('audit')
  @RequirePermissions('users.audit')
  audit() {
    return this.users.audit();
  }
}

@Module({ controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
