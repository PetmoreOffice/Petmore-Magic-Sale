import { BadRequestException, Body, Controller, ConflictException, Get, Injectable, Module, Post } from '@nestjs/common';
import { isPermission, ROLES, SessionUser } from '@petmore/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { toSessionUser } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import { audit, requireRequestId, requireText } from '../common/util';

interface SaveUserInput {
  requestId: string;
  create: boolean;
  revision: number;
  username: string;
  displayName: string;
  role: string;
  active: boolean;
  password?: string;
  warehouseScope: { all: boolean; codes: string[] };
  permissions: string[];
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const users = await this.prisma.user.findMany({ include: { warehouses: true }, orderBy: { username: 'asc' } });
    return users.map((u) => ({ ...toSessionUser(u), active: u.active, revision: u.revision }));
  }

  async save(actor: SessionUser, input: SaveUserInput) {
    requireRequestId(input.requestId);
    const username = requireText(input.username, 'ชื่อผู้ใช้', 50);
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(username)) throw new BadRequestException('ชื่อผู้ใช้ต้องยาว 3 ตัวขึ้นไป ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข . _ และ -');
    const displayName = requireText(input.displayName, 'ชื่อที่แสดง', 100);
    if (!(input.role in ROLES)) throw new BadRequestException('เลือกตำแหน่ง');
    const permissions = [...new Set((input.permissions ?? []).filter(isPermission))];
    const codes = [...new Set(input.warehouseScope?.codes ?? [])];
    const password = input.password ?? '';
    if ((input.create || password) && password.length < 8) throw new BadRequestException('รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
    if (actor.username === username && !input.active) throw new BadRequestException('ปิดใช้งานบัญชีที่กำลังใช้อยู่ไม่ได้ ให้ผู้ดูแลคนอื่นปิดแทน');

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

  audit() {
    return this.prisma.auditLog.findMany({ where: { entity: 'user' }, orderBy: { createdAt: 'desc' }, take: 200 });
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
  save(@CurrentUser() actor: SessionUser, @Body() body: SaveUserInput) {
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
