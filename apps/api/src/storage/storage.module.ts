import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Post,
} from '@nestjs/common';
import type { SessionUser, StorageWorkspace } from '@petmore/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { assertWarehouse, warehouseFilter } from '../common/scope';
import { audit, optionalText, requireRequestId, requireText, toLocationDto } from '../common/util';

interface SaveEntryInput {
  requestId: string;
  create: boolean;
  id?: string;
  revision: number;
  warehouse: string;
  zoneId?: string;
  code: string;
  name: string;
  active: boolean;
}

@Injectable()
export class StorageService {
  constructor(private readonly prisma: PrismaService) {}

  async workspace(user: SessionUser): Promise<StorageWorkspace> {
    const scope = warehouseFilter(user);
    const [warehouses, zones, locations] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { active: true, ...(scope.warehouseCode ? { code: scope.warehouseCode } : {}) },
        orderBy: { code: 'asc' },
      }),
      this.prisma.zone.findMany({ where: scope, orderBy: { code: 'asc' } }),
      this.prisma.location.findMany({ where: scope, include: { zone: true }, orderBy: [{ zone: { code: 'asc' } }, { code: 'asc' }] }),
    ]);
    return {
      warehouses,
      zones: zones.map((z) => ({ id: z.id, warehouse: z.warehouseCode, code: z.code, name: z.name, active: z.active, revision: z.revision })),
      locations: locations.map(toLocationDto),
    };
  }

  async save(actor: SessionUser, kind: 'zone' | 'location', input: SaveEntryInput) {
    requireRequestId(input.requestId);
    assertWarehouse(actor, input.warehouse);
    const code = requireText(input.code, 'รหัส', 30).toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(code)) throw new BadRequestException('รหัสใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข _ และ - (ห้ามเว้นวรรค)');
    const name = kind === 'zone' ? requireText(input.name, 'ชื่อโซน', 100) : optionalText(input.name, 100);

    return this.prisma.$transaction(async (tx) => {
      if (kind === 'zone') {
        const before = input.create ? null : await tx.zone.findUnique({ where: { id: input.id ?? '' } });
        if (!input.create && (!before || before.revision !== input.revision || before.warehouseCode !== input.warehouse)) {
          throw new ConflictException('มีคนแก้รายการนี้ไปก่อน โหลดหน้าใหม่แล้วแก้อีกครั้ง');
        }
        const data = { code, name, active: !!input.active };
        const after = before
          ? await tx.zone.update({ where: { id: before.id }, data: { ...data, revision: { increment: 1 } } })
          : await tx.zone.create({ data: { ...data, warehouseCode: input.warehouse } });
        await audit(tx, 'zone', after.id, actor.id, before, after);
        return after;
      }
      const zone = await tx.zone.findUnique({ where: { id: input.zoneId ?? '' } });
      if (!zone || zone.warehouseCode !== input.warehouse) throw new BadRequestException('โซนที่เลือกไม่อยู่ในคลังนี้ เลือกโซนของคลังนี้');
      const before = input.create ? null : await tx.location.findUnique({ where: { id: input.id ?? '' } });
      if (!input.create && (!before || before.revision !== input.revision || before.warehouseCode !== input.warehouse)) {
        throw new ConflictException('มีคนแก้รายการนี้ไปก่อน โหลดหน้าใหม่แล้วแก้อีกครั้ง');
      }
      const data = { code, name, active: !!input.active, zoneId: zone.id };
      const after = before
        ? await tx.location.update({ where: { id: before.id }, data: { ...data, revision: { increment: 1 } } })
        : await tx.location.create({ data: { ...data, warehouseCode: input.warehouse } });
      await audit(tx, 'location', after.id, actor.id, before, after);
      return after;
    });
  }

  /** เตรียมชุดป้าย (QR + Code128 ของ Location ID) เรียกซ้ำด้วย requestId เดิมได้ */
  async prepareLabels(actor: SessionUser, body: { requestId: string; locationIds: string[] }) {
    const requestId = requireRequestId(body.requestId);
    const ids = [...new Set(body.locationIds ?? [])].slice(0, 300);
    if (!ids.length) throw new BadRequestException('เลือก Location อย่างน้อย 1 รายการ');
    const locations = await this.prisma.location.findMany({ where: { id: { in: ids } }, include: { zone: true } });
    for (const l of locations) assertWarehouse(actor, l.warehouseCode);
    const usable = locations.filter((l) => l.active && l.zone.active);
    if (usable.length !== ids.length) throw new BadRequestException('มี Location ที่ถูกลบหรือปิดใช้งาน โหลดหน้าใหม่แล้วเลือกอีกครั้ง');
    const batch = await this.prisma.labelBatch.upsert({
      where: { requestId },
      create: { requestId, actorId: actor.id, locationIds: ids },
      update: {},
    });
    const byId = new Map(usable.map((l) => [l.id, toLocationDto(l)]));
    return { id: batch.id, actor: actor.displayName, time: batch.createdAt, labels: ids.map((id) => byId.get(id)!) };
  }
}

@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get()
  @RequirePermissions('locations.view', 'locations.edit', 'locations.print')
  workspace(@CurrentUser() user: SessionUser) {
    return this.storage.workspace(user);
  }

  @Post(':kind')
  @RequirePermissions('locations.edit')
  save(@CurrentUser() user: SessionUser, @Param('kind') kind: string, @Body() body: SaveEntryInput) {
    if (kind !== 'zone' && kind !== 'location') throw new BadRequestException('บันทึกไม่สำเร็จ โหลดหน้าใหม่แล้วลองอีกครั้ง');
    return this.storage.save(user, kind, body);
  }

  @Post('labels/prepare')
  @RequirePermissions('locations.print')
  prepareLabels(@CurrentUser() user: SessionUser, @Body() body: { requestId: string; locationIds: string[] }) {
    return this.storage.prepareLabels(user, body);
  }
}

@Module({ controllers: [StorageController], providers: [StorageService] })
export class StorageModule {}
