import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  MAX_RECEIPT_LINES,
  RECEIPT_KINDS,
  Receipt,
  ReceiptInput,
  ReceivingSetup,
  STOCK_STATUSES,
  SessionUser,
} from '@petmore/shared';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { resolvePack } from '../products/products.module';
import { assertWarehouse, warehouseFilter } from '../common/scope';
import {
  isIsoDate,
  nextDocNo,
  optionalText,
  requireRequestId,
  requireText,
  toLocationDto,
} from '../common/util';

type ReceiptWithLines = Prisma.ReceiptGetPayload<{ include: { lines: true } }>;

@Injectable()
export class ReceivingService {
  constructor(private readonly prisma: PrismaService) {}

  /** ไม่ส่งรายการสินค้าทั้งหมดมา หน้าเว็บค้นสินค้าทีละตัวผ่าน /scan หรือ /products/lookup */
  async setup(user: SessionUser): Promise<ReceivingSetup> {
    const scope = warehouseFilter(user);
    const [warehouses, locations] = await Promise.all([
      this.prisma.warehouse.findMany({
        where: { active: true, ...(scope.warehouseCode ? { code: scope.warehouseCode } : {}) },
        orderBy: { code: 'asc' },
      }),
      this.prisma.location.findMany({
        where: { ...scope, active: true, zone: { active: true } },
        include: { zone: true },
        orderBy: [{ zone: { code: 'asc' } }, { code: 'asc' }],
      }),
    ]);
    return { warehouses, locations: locations.map(toLocationDto) };
  }

  async list(user: SessionUser) {
    const rows = await this.prisma.receipt.findMany({
      where: warehouseFilter(user),
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { _count: { select: { lines: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      date: r.date.toISOString().slice(0, 10),
      reference: r.reference,
      poNumber: r.poNumber,
      warehouse: r.warehouseCode,
      source: r.source,
      count: r._count.lines,
    }));
  }

  async get(user: SessionUser, id: string): Promise<Receipt> {
    const receipt = await this.prisma.receipt.findUnique({ where: { id }, include: { lines: true } });
    if (!receipt) throw new NotFoundException('ไม่พบใบรับสินค้านี้ ตรวจเลขที่แล้วลองอีกครั้ง');
    assertWarehouse(user, receipt.warehouseCode);
    return this.toDto(receipt);
  }

  async post(user: SessionUser, input: ReceiptInput): Promise<Receipt> {
    const requestId = requireRequestId(input.requestId);
    // กดบันทึกซ้ำ (เน็ตหลุดแล้วส่งใหม่) ได้ใบเดิมกลับไป ไม่เพิ่มสต็อกซ้ำ
    const existing = await this.prisma.receipt.findUnique({ where: { requestId }, include: { lines: true } });
    if (existing) return this.toDto(existing);

    const warehouse = requireText(input.warehouse, 'คลัง', 20);
    assertWarehouse(user, warehouse);
    if (!(input.kind in RECEIPT_KINDS)) throw new BadRequestException('เลือกประเภทใบรับสินค้า');
    if (!isIsoDate(input.date)) throw new BadRequestException('วันที่รับไม่ถูกต้อง เลือกวันที่ใหม่');
    const reference = requireText(input.reference, 'เลขที่เอกสารอ้างอิง', 100);
    const source = requireText(input.source, 'ผู้ส่ง / ที่มา', 200);
    const lines = Array.isArray(input.lines) ? input.lines : [];
    if (!lines.length) throw new BadRequestException('เพิ่มสินค้าอย่างน้อย 1 รายการ');
    if (lines.length > MAX_RECEIPT_LINES) throw new BadRequestException(`ใบรับสินค้า 1 ใบมีได้ไม่เกิน ${MAX_RECEIPT_LINES} รายการ แยกเป็นใบใหม่`);

    try {
      const receipt = await this.prisma.$transaction(async (tx) => {
        const products = new Map(
          (await tx.product.findMany({ where: { sku: { in: lines.map((l) => l.sku) } } })).map((p) => [p.sku, p]),
        );
        const locations = new Map(
          (
            await tx.location.findMany({ where: { id: { in: lines.map((l) => l.locationId) } }, include: { zone: true } })
          ).map((l) => [l.id, l]),
        );

        const clean = [];
        for (const [i, line] of lines.entries()) {
          const no = i + 1;
          const product = products.get(line.sku);
          if (!product || !product.active) throw new BadRequestException(`แถว ${no}: ไม่พบสินค้า ${line.sku} หรือสินค้าถูกปิดใช้งาน ลบแถวนี้แล้วสแกนสินค้าใหม่`);
          const location = locations.get(line.locationId);
          if (!location || location.warehouseCode !== warehouse || !location.active || !location.zone.active) {
            throw new BadRequestException(`แถว ${no}: Location ไม่อยู่ในคลัง ${warehouse} หรือปิดใช้งาน สแกน Location ในคลังนี้`);
          }
          // ตัวคูณขนาดบรรจุอ่านจากฐานข้อมูลเสมอ ไม่ใช้ค่าที่หน้าเว็บส่งมา
          const pack = await resolvePack(tx, product, String(line.packCode ?? ''));
          if (!pack) throw new BadRequestException(`แถว ${no}: ขนาดบรรจุ ${line.packCode} ใช้กับ ${product.sku} ไม่ได้ เลือกขนาดบรรจุใหม่`);
          const packQty = Number(line.packQty);
          if (!Number.isFinite(packQty) || packQty <= 0) throw new BadRequestException(`แถว ${no}: ใส่จำนวนมากกว่า 0`);
          const qty = Math.round(packQty * pack.factor * 1000) / 1000;
          const expiry = optionalText(line.expiry, 10);
          if (expiry && !isIsoDate(expiry)) throw new BadRequestException(`แถว ${no}: วันหมดอายุไม่ถูกต้อง เลือกวันที่ใหม่`);
          if (product.expiryRequired && !expiry) throw new BadRequestException(`แถว ${no}: ${product.sku} ต้องกรอกวันหมดอายุก่อนบันทึก`);
          if (!(line.status in STOCK_STATUSES)) throw new BadRequestException(`แถว ${no}: เลือกสถานะ FG (ของดี) หรือ DM (เสียหาย)`);
          clean.push({
            lineNo: no,
            sku: product.sku,
            locationId: location.id,
            qty,
            packCode: pack.code,
            packName: pack.name,
            packUnit: pack.unitName,
            packQty,
            factor: pack.factor,
            lot: optionalText(line.lot, 50),
            expiry,
            status: line.status,
          });
        }

        const id = await nextDocNo(tx, input.kind === 'OPENING' ? 'OP' : 'RC');
        const created = await tx.receipt.create({
          data: {
            id,
            requestId,
            kind: input.kind,
            warehouseCode: warehouse,
            date: new Date(input.date + 'T00:00:00Z'),
            reference,
            poNumber: optionalText(input.poNumber, 100),
            source,
            note: optionalText(input.note, 500),
            createdById: user.id,
            lines: { create: clean },
          },
          include: { lines: true },
        });

        for (const l of clean) {
          await tx.stockBalance.upsert({
            where: {
              stockKey: { warehouseCode: warehouse, sku: l.sku, locationId: l.locationId, lot: l.lot, expiry: l.expiry, status: l.status },
            },
            create: { warehouseCode: warehouse, sku: l.sku, locationId: l.locationId, lot: l.lot, expiry: l.expiry, status: l.status, qty: l.qty },
            update: { qty: { increment: l.qty } },
          });
        }
        await tx.stockMovement.createMany({
          data: clean.map((l) => ({
            kind: input.kind,
            refId: id,
            lineNo: l.lineNo,
            warehouseCode: warehouse,
            sku: l.sku,
            toLocationId: l.locationId,
            lot: l.lot,
            expiry: l.expiry,
            status: l.status,
            qty: l.qty,
            actorId: user.id,
          })),
        });
        return created;
      });
      return this.toDto(receipt);
    } catch (e) {
      if (isUniqueViolation(e)) {
        const again = await this.prisma.receipt.findUnique({ where: { requestId }, include: { lines: true } });
        if (again) return this.toDto(again);
      }
      throw e;
    }
  }

  private async toDto(r: ReceiptWithLines): Promise<Receipt> {
    const [products, locations, creator] = await Promise.all([
      this.prisma.product.findMany({ where: { sku: { in: r.lines.map((l) => l.sku) } } }),
      this.prisma.location.findMany({ where: { id: { in: r.lines.map((l) => l.locationId) } }, include: { zone: true } }),
      this.prisma.user.findUnique({ where: { id: r.createdById } }),
    ]);
    const p = new Map(products.map((x) => [x.sku, x]));
    const loc = new Map(locations.map((x) => [x.id, toLocationDto(x)]));
    return {
      id: r.id,
      kind: r.kind,
      warehouse: r.warehouseCode,
      date: r.date.toISOString().slice(0, 10),
      reference: r.reference,
      poNumber: r.poNumber,
      source: r.source,
      note: r.note,
      createdBy: creator?.displayName ?? r.createdById,
      createdAt: r.createdAt.toISOString(),
      lines: r.lines
        .sort((a, b) => a.lineNo - b.lineNo)
        .map((l) => ({
          lineNo: l.lineNo,
          sku: l.sku,
          name: p.get(l.sku)?.name ?? '',
          unit: p.get(l.sku)?.unit ?? '',
          locationId: l.locationId,
          locationCode: loc.get(l.locationId)?.displayCode ?? l.locationId,
          qty: Number(l.qty),
          packCode: l.packCode,
          packName: l.packName || (p.get(l.sku)?.name ?? ''),
          packUnit: l.packUnit || (p.get(l.sku)?.unit ?? ''),
          packQty: Number(l.packQty) || Number(l.qty),
          factor: Number(l.factor) || 1,
          lot: l.lot,
          expiry: l.expiry,
          status: l.status,
        })),
    };
  }
}

@Controller('receipts')
export class ReceivingController {
  constructor(private readonly receiving: ReceivingService) {}

  @Get('setup')
  @RequirePermissions('receive.create')
  setup(@CurrentUser() user: SessionUser) {
    return this.receiving.setup(user);
  }

  @Get()
  @RequirePermissions('receive.view')
  list(@CurrentUser() user: SessionUser) {
    return this.receiving.list(user);
  }

  @Get(':id')
  @RequirePermissions('receive.view', 'receive.create')
  get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.receiving.get(user, id);
  }

  @Post()
  @RequirePermissions('receive.create')
  post(@CurrentUser() user: SessionUser, @Body() body: ReceiptInput) {
    return this.receiving.post(user, body);
  }
}

@Module({ controllers: [ReceivingController], providers: [ReceivingService] })
export class ReceivingModule {}
