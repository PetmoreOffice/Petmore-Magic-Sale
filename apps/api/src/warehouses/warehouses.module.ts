import { BadRequestException, Body, Controller, ConflictException, Get, Injectable, Module, Post } from '@nestjs/common';
import { SessionUser, WAREHOUSE_KINDS, WarehouseKind } from '@petmore/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { audit, requireRequestId, requireText } from '../common/util';

interface SaveWarehouseInput {
  requestId: string;
  create: boolean;
  revision: number;
  code: string;
  name: string;
  kind: WarehouseKind;
  active: boolean;
}

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.warehouse.findMany({ orderBy: { code: 'asc' } });
  }

  async save(actor: SessionUser, input: SaveWarehouseInput) {
    requireRequestId(input.requestId);
    const code = requireText(input.code, 'รหัสคลัง', 20).toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(code)) throw new BadRequestException('รหัสคลังใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข _ และ - (ห้ามเว้นวรรค)');
    const name = requireText(input.name, 'ชื่อคลัง', 100);
    if (!(input.kind in WAREHOUSE_KINDS)) throw new BadRequestException('เลือกประเภทคลัง');

    return this.prisma.$transaction(async (tx) => {
      const before = await tx.warehouse.findUnique({ where: { code } });
      if (input.create && before) throw new ConflictException('รหัสคลังนี้มีอยู่แล้ว ใช้รหัสอื่น');
      if (!input.create && (!before || before.revision !== input.revision)) {
        throw new ConflictException('มีคนแก้คลังนี้ไปก่อน โหลดหน้าใหม่แล้วแก้อีกครั้ง');
      }
      const data = { name, kind: input.kind, active: !!input.active };
      const after = before
        ? await tx.warehouse.update({ where: { code }, data: { ...data, revision: { increment: 1 } } })
        : await tx.warehouse.create({ data: { ...data, code } });
      await audit(tx, 'warehouse', code, actor.id, before, after);
      return after;
    });
  }
}

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly warehouses: WarehousesService) {}

  @Get()
  @RequirePermissions('locations.manage', 'users.manage')
  list() {
    return this.warehouses.list();
  }

  @Post()
  @RequirePermissions('locations.manage')
  save(@CurrentUser() actor: SessionUser, @Body() body: SaveWarehouseInput) {
    return this.warehouses.save(actor, body);
  }
}

@Module({ controllers: [WarehousesController], providers: [WarehousesService] })
export class WarehousesModule {}
