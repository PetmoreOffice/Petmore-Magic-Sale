import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { PackSize, Paged, SessionUser, StockMovementRow, StockRow } from '@petmore/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { warehouseFilter } from '../common/scope';
import { toLocationDto } from '../common/util';

const PAGE_SIZE = 50;

export interface StockQuery {
  q?: string;
  warehouse?: string;
  locationId?: string;
  sku?: string;
}

@Injectable()
export class StockService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: SessionUser, query: StockQuery): Promise<StockRow[]> {
    const where: Prisma.StockBalanceWhereInput = { ...warehouseFilter(user), qty: { gt: 0 } };
    if (query.warehouse) where.AND = [{ warehouseCode: query.warehouse }];
    if (query.locationId) where.locationId = query.locationId;
    if (query.sku) where.sku = query.sku;
    const term = query.q?.trim();
    if (term) {
      const [products, locations] = await Promise.all([
        this.prisma.product.findMany({
          where: { OR: [{ name: { contains: term, mode: 'insensitive' } }, { barcode: term }] },
          select: { sku: true },
          take: 500,
        }),
        this.prisma.location.findMany({ where: { code: { contains: term, mode: 'insensitive' } }, select: { id: true }, take: 500 }),
      ]);
      where.OR = [
        { sku: { contains: term, mode: 'insensitive' } },
        { lot: { contains: term, mode: 'insensitive' } },
        { sku: { in: products.map((p) => p.sku) } },
        { locationId: { in: locations.map((l) => l.id) } },
      ];
    }
    const rows = await this.prisma.stockBalance.findMany({
      where,
      orderBy: [{ warehouseCode: 'asc' }, { sku: 'asc' }, { expiry: 'asc' }],
      take: 1000,
    });
    return this.decorate(rows);
  }

  async decorate(rows: Prisma.StockBalanceGetPayload<object>[]): Promise<StockRow[]> {
    const skus = [...new Set(rows.map((r) => r.sku))];
    const [products, locations, packs] = await Promise.all([
      this.prisma.product.findMany({ where: { sku: { in: skus } } }),
      this.prisma.location.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.locationId))] } }, include: { zone: true } }),
      this.prisma.productPack.findMany({ where: { sku: { in: skus }, active: true }, select: { sku: true, unitName: true, unitQty: true, factor: true } }),
    ]);
    const p = new Map(products.map((x) => [x.sku, x]));
    const l = new Map(locations.map((x) => [x.id, toLocationDto(x)]));
    // ขนาดที่ไม่ซ้ำต่อสินค้า (หลายบาร์โค้ดของหน่วยเดียวกันนับเป็นขนาดเดียว) เรียงใหญ่ไปเล็ก
    const sizes = new Map<string, Map<string, PackSize>>();
    for (const k of packs) {
      const factor = Number(k.factor);
      const unitQty = Number(k.unitQty);
      if (!(factor > 0) || !(unitQty > 0)) continue;
      const bySku = sizes.get(k.sku) ?? new Map<string, PackSize>();
      bySku.set(`${k.unitName}|${unitQty}`, { unitName: k.unitName, unitQty, factor });
      sizes.set(k.sku, bySku);
    }
    const sizesOf = (sku: string, unit: string, unitQty: number): PackSize[] => {
      const list = [...(sizes.get(sku)?.values() ?? [])];
      // ต้องมีหน่วยนับสต็อกเสมอ ไว้รับเศษที่แตกเป็นขนาดใหญ่ไม่ลง
      if (!list.some((s) => s.factor === 1)) list.push({ unitName: unit, unitQty, factor: 1 });
      return list.sort((a, b) => b.unitQty - a.unitQty);
    };
    return rows.map((r) => ({
      id: r.id,
      warehouse: r.warehouseCode,
      sku: r.sku,
      name: p.get(r.sku)?.name ?? '',
      barcode: p.get(r.sku)?.barcode ?? null,
      unit: p.get(r.sku)?.unit ?? '',
      locationId: r.locationId,
      locationCode: l.get(r.locationId)?.displayCode ?? r.locationId,
      lot: r.lot,
      expiry: r.expiry,
      status: r.status,
      qty: Number(r.qty),
      brand: p.get(r.sku)?.brand ?? '',
      unitQty: Number(p.get(r.sku)?.unitQty ?? 1) || 1,
      sizes: sizesOf(r.sku, p.get(r.sku)?.unit ?? '', Number(p.get(r.sku)?.unitQty ?? 1) || 1),
    }));
  }

  async movements(user: SessionUser, q: string, pageInput: number): Promise<Paged<StockMovementRow>> {
    const term = q.trim();
    const where: Prisma.StockMovementWhereInput = {
      ...warehouseFilter(user),
      ...(term ? { OR: [{ sku: { contains: term, mode: 'insensitive' } }, { refId: { contains: term, mode: 'insensitive' } }] } : {}),
    };
    const total = await this.prisma.stockMovement.count({ where });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const page = Math.min(Math.max(0, pageInput || 0), pages - 1);
    const rows = await this.prisma.stockMovement.findMany({ where, orderBy: { createdAt: 'desc' }, skip: page * PAGE_SIZE, take: PAGE_SIZE });
    const locIds = [...new Set(rows.flatMap((r) => [r.fromLocationId, r.toLocationId]).filter((x): x is string => !!x))];
    const [products, locations, users] = await Promise.all([
      this.prisma.product.findMany({ where: { sku: { in: rows.map((r) => r.sku) } } }),
      this.prisma.location.findMany({ where: { id: { in: locIds } }, include: { zone: true } }),
      this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.actorId) } } }),
    ]);
    const p = new Map(products.map((x) => [x.sku, x.name]));
    const l = new Map(locations.map((x) => [x.id, toLocationDto(x).displayCode]));
    const u = new Map(users.map((x) => [x.id, x.displayName]));
    return {
      total,
      page,
      pages,
      rows: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        refId: r.refId,
        lineNo: r.lineNo,
        warehouse: r.warehouseCode,
        sku: r.sku,
        name: p.get(r.sku) ?? '',
        fromCode: r.fromLocationId ? l.get(r.fromLocationId) ?? r.fromLocationId : null,
        toCode: r.toLocationId ? l.get(r.toLocationId) ?? r.toLocationId : null,
        qty: Number(r.qty),
        actor: u.get(r.actorId) ?? r.actorId,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get()
  @RequirePermissions('stock.view', 'move.create')
  list(@CurrentUser() user: SessionUser, @Query() query: StockQuery) {
    return this.stock.list(user, query);
  }

  @Get('movements')
  @RequirePermissions('stock.view')
  movements(@CurrentUser() user: SessionUser, @Query('q') q = '', @Query('page') page = '0') {
    return this.stock.movements(user, q, Number(page));
  }
}

@Module({ controllers: [StockController], providers: [StockService], exports: [StockService] })
export class StockModule {}
