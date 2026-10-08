import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import type { Move as MoveRow } from '@prisma/client';
import type { Move, MoveInput, Paged, SessionUser } from '@petmore/shared';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { assertWarehouse, warehouseFilter } from '../common/scope';
import { nextDocNo, optionalText, requireRequestId, toLocationDto } from '../common/util';

const PAGE_SIZE = 30;

@Injectable()
export class MovesService {
  constructor(private readonly prisma: PrismaService) {}

  async post(user: SessionUser, input: MoveInput): Promise<Move> {
    const requestId = requireRequestId(input.requestId);
    const existing = await this.prisma.move.findUnique({ where: { requestId } });
    if (existing) return (await this.toDto([existing]))[0];

    const qty = Number(input.qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new BadRequestException('ใส่จำนวนที่ย้ายมากกว่า 0');

    try {
      const move = await this.prisma.$transaction(async (tx) => {
        const source = await tx.stockBalance.findUnique({ where: { id: String(input.sourceId ?? '') } });
        if (!source) throw new BadRequestException('ไม่พบสินค้านี้ที่ Location ต้นทางแล้ว อาจมีคนย้ายไปก่อน โหลดหน้าใหม่แล้วลองอีกครั้ง');
        assertWarehouse(user, source.warehouseCode);
        const dest = await tx.location.findUnique({ where: { id: String(input.destinationId ?? '') }, include: { zone: true } });
        if (!dest || dest.warehouseCode !== source.warehouseCode || !dest.active || !dest.zone.active) {
          throw new BadRequestException('ย้ายไป Location นี้ไม่ได้ เพราะอยู่คนละคลังหรือปิดใช้งาน สแกน Location อื่นในคลังเดียวกัน');
        }
        if (dest.id === source.locationId) throw new BadRequestException('Location ปลายทางเป็นที่เดิม สแกน Location อื่น');

        // ตัดยอดแบบมีเงื่อนไขในคำสั่งเดียว กันสองคนย้ายของชิ้นเดียวกันพร้อมกันจนติดลบ
        const taken = await tx.stockBalance.updateMany({
          where: { id: source.id, qty: { gte: qty } },
          data: { qty: { decrement: qty } },
        });
        if (taken.count === 0) throw new BadRequestException('ยอดคงเหลือไม่พอให้ย้าย อาจมีคนย้ายไปก่อน โหลดหน้าใหม่เพื่อดูยอดล่าสุด');

        const key = { warehouseCode: source.warehouseCode, sku: source.sku, lot: source.lot, expiry: source.expiry, status: source.status };
        await tx.stockBalance.upsert({
          where: { stockKey: { ...key, locationId: dest.id } },
          create: { ...key, locationId: dest.id, qty },
          update: { qty: { increment: qty } },
        });

        const id = await nextDocNo(tx, 'MV');
        const created = await tx.move.create({
          data: {
            id,
            requestId,
            ...key,
            fromLocationId: source.locationId,
            toLocationId: dest.id,
            qty,
            note: optionalText(input.note, 500),
            actorId: user.id,
          },
        });
        await tx.stockMovement.create({
          data: { kind: 'MOVE', refId: id, lineNo: 1, ...key, fromLocationId: source.locationId, toLocationId: dest.id, qty, actorId: user.id },
        });
        return created;
      });
      return (await this.toDto([move]))[0];
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await this.prisma.move.findUnique({ where: { requestId } });
        if (again) return (await this.toDto([again]))[0];
      }
      throw e;
    }
  }

  async history(user: SessionUser, q: string, pageInput: number): Promise<Paged<Move>> {
    const term = q.trim();
    const where = {
      ...warehouseFilter(user),
      ...(term ? { OR: [{ sku: { contains: term, mode: 'insensitive' as const } }, { id: { contains: term, mode: 'insensitive' as const } }] } : {}),
    };
    const total = await this.prisma.move.count({ where });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(0, pageInput || 0), pages - 1);
    const rows = await this.prisma.move.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * PAGE_SIZE, take: PAGE_SIZE });
    return { rows: await this.toDto(rows), total, page, pages };
  }

  private async toDto(rows: MoveRow[]): Promise<Move[]> {
    const [products, locations, users] = await Promise.all([
      this.prisma.product.findMany({ where: { sku: { in: rows.map((r) => r.sku) } } }),
      this.prisma.location.findMany({
        where: { id: { in: rows.flatMap((r) => [r.fromLocationId, r.toLocationId]) } },
        include: { zone: true },
      }),
      this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.actorId) } } }),
    ]);
    const p = new Map(products.map((x) => [x.sku, x]));
    const l = new Map(locations.map((x) => [x.id, toLocationDto(x).displayCode]));
    const u = new Map(users.map((x) => [x.id, x.displayName]));
    return rows.map((r) => ({
      id: r.id,
      warehouse: r.warehouseCode,
      sku: r.sku,
      name: p.get(r.sku)?.name ?? '',
      unit: p.get(r.sku)?.unit ?? '',
      fromCode: l.get(r.fromLocationId) ?? r.fromLocationId,
      toCode: l.get(r.toLocationId) ?? r.toLocationId,
      lot: r.lot,
      expiry: r.expiry,
      status: r.status,
      qty: Number(r.qty),
      note: r.note,
      actor: u.get(r.actorId) ?? r.actorId,
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

@Controller('moves')
export class MovesController {
  constructor(private readonly moves: MovesService) {}

  @Get()
  @RequirePermissions('move.view')
  history(@CurrentUser() user: SessionUser, @Query('q') q = '', @Query('page') page = '0') {
    return this.moves.history(user, q, Number(page));
  }

  @Post()
  @RequirePermissions('move.create')
  post(@CurrentUser() user: SessionUser, @Body() body: MoveInput) {
    return this.moves.post(user, body);
  }
}

@Module({ controllers: [MovesController], providers: [MovesService] })
export class MovesModule {}
