import { BadRequestException, Body, ConflictException, Controller, Get, Injectable, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MAX_ORDER_LINES, OrderReturnSummary, Paged, ProductReturn, RETURN_REASONS, ReturnInput, ReturnReason, SessionUser } from '@petmore/shared';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { audit, nextDocNo, optionalText, requireRequestId, requireText } from '../common/util';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { resolvePack } from '../products/products.module';

type StoredReturn = Prisma.ProductReturnGetPayload<{ include: { lines: true; order: { select: { customerName: true } } } }>;
const INCLUDE = { lines: true, order: { select: { customerName: true } } } satisfies Prisma.ProductReturnInclude;
/** เผื่อเศษทศนิยม 3 ตำแหน่งตอนเทียบยอดคืนกับยอดเบิก */
const EPS = 0.0005;

function qtyValue(value: unknown, label: string): number {
  if (value === 0 || value === undefined || value === null) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000_000) throw new BadRequestException(`${label}ต้องไม่ติดลบ และไม่เกิน 100,000,000`);
  if (new Prisma.Decimal(value).decimalPlaces() > 3) throw new BadRequestException(`${label}มีทศนิยมได้ไม่เกิน 3 ตำแหน่ง`);
  return value;
}

/**
 * คืนสินค้า: คืนจากออเดอร์ (เบิกเกิน/ขายไม่หมด) หรือใบคืนอิสระ (ปิดงานอีเว้นท์)
 * แยกของดี (FG) / ของเสียหาย (DM) ตอนนี้บันทึกประวัติอย่างเดียว ไม่เปลี่ยนยอดสต็อก
 * คืนจากออเดอร์ห้ามเกินที่เบิกไป: ยอดเบิก = ยอดที่นับได้จากผลตรวจของเบิกล่าสุด (ยังไม่ตรวจใช้ยอดในออเดอร์)
 */
@Injectable()
export class ReturnsService {
  constructor(private readonly prisma: PrismaService) {}

  private dto(r: StoredReturn): ProductReturn {
    return {
      id: r.id, orderId: r.orderId, customerName: r.order?.customerName ?? '', reason: r.reason as ReturnReason,
      returnerName: r.returnerName, note: r.note, createdBy: r.createdById, createdAt: r.createdAt.toISOString(),
      lines: r.lines.sort((a, b) => a.lineNo - b.lineNo).map((l) => ({
        lineNo: l.lineNo, orderLineNo: l.orderLineNo, sku: l.sku, itemCode: l.itemCode, packCode: l.packCode, name: l.name, unit: l.unit,
        goodQty: Number(l.goodQty), damagedQty: Number(l.damagedQty),
      })),
    };
  }

  async list(q = '', pageValue = '1'): Promise<Paged<ProductReturn>> {
    const page = /^\d+$/.test(pageValue) ? Math.max(1, Math.min(100_000, Number(pageValue))) : 1;
    const term = q.trim().slice(0, 100);
    const where: Prisma.ProductReturnWhereInput = term
      ? { OR: [{ id: { contains: term, mode: 'insensitive' } }, { orderId: { contains: term, mode: 'insensitive' } }, { returnerName: { contains: term, mode: 'insensitive' } }, { order: { customerName: { contains: term, mode: 'insensitive' } } }] }
      : {};
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.productReturn.count({ where }),
      this.prisma.productReturn.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 20, include: INCLUDE }),
    ]);
    return { rows: rows.map((r) => this.dto(r)), total, page, pages: Math.max(1, Math.ceil(total / 20)) };
  }

  async get(id: string): Promise<ProductReturn> {
    const r = await this.prisma.productReturn.findUnique({ where: { id }, include: INCLUDE });
    if (!r) throw new NotFoundException('ไม่พบใบคืนนี้ ตรวจเลขที่แล้วลองอีกครั้ง');
    return this.dto(r);
  }

  /** ยอดเบิกและยอดคืนแล้วของแต่ละรายการในออเดอร์ */
  async summary(orderId: string, db: Tx | PrismaService = this.prisma): Promise<OrderReturnSummary> {
    const order = await db.salesOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
    if (!order) throw new NotFoundException('ไม่พบออเดอร์นี้ ตรวจเลขออเดอร์แล้วลองอีกครั้ง');
    const check = await db.pickCheck.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' }, include: { lines: true } });
    const returned = await db.returnLine.groupBy({
      by: ['orderLineNo'], where: { ret: { orderId }, orderLineNo: { not: null } }, _sum: { goodQty: true, damagedQty: true },
    });
    return {
      orderId,
      checked: !!check,
      lines: order.lines.sort((a, b) => a.lineNo - b.lineNo).map((l) => {
        const counted = check?.lines.find((c) => c.orderLineNo === l.lineNo);
        const back = returned.find((r) => r.orderLineNo === l.lineNo);
        return {
          orderLineNo: l.lineNo,
          taken: Number(counted ? counted.actualQty : l.qty),
          returned: Number(back?._sum.goodQty ?? 0) + Number(back?._sum.damagedQty ?? 0),
        };
      }),
    };
  }

  async create(user: SessionUser, input: ReturnInput): Promise<ProductReturn> {
    if (!input || typeof input !== 'object' || !Array.isArray(input.lines)) throw new BadRequestException('ส่งใบคืนไม่สำเร็จ โหลดหน้าใหม่แล้วลองอีกครั้ง');
    const requestId = requireRequestId(input.requestId);
    if (!(input.reason in RETURN_REASONS)) throw new BadRequestException('เลือกสาเหตุการคืน');
    const existing = await this.prisma.productReturn.findUnique({ where: { requestId }, include: INCLUDE });
    if (existing) {
      if (existing.createdById !== user.id) throw new ConflictException('ใบคืนนี้ถูกส่งไปแล้ว โหลดหน้าใหม่เพื่อดูผลล่าสุด');
      return this.dto(existing);
    }
    if (input.lines.length > MAX_ORDER_LINES * 4) throw new BadRequestException('รายการคืนมากเกินที่ระบบรองรับ แยกเป็นใบคืนหลายใบ');
    const orderId = input.orderId ? requireText(input.orderId, 'เลขออเดอร์', 50) : null;

    const id = await this.prisma.$transaction(async (tx) => {
      const lines: Prisma.ReturnLineCreateWithoutRetInput[] = [];
      if (orderId) {
        const order = await tx.salesOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
        if (!order) throw new NotFoundException('ไม่พบออเดอร์นี้ ตรวจเลขออเดอร์แล้วลองอีกครั้ง');
        // คิดยอดในธุรกรรมเดียวกัน กันสองเครื่องคืนพร้อมกันจนเกินยอดเบิก
        const summary = await this.summary(orderId, tx);
        for (const line of input.lines) {
          const good = qtyValue(line.goodQty, 'จำนวนของดี'), damaged = qtyValue(line.damagedQty, 'จำนวนของเสียหาย');
          if (!good && !damaged) continue;
          const ol = order.lines.find((l) => l.lineNo === line.orderLineNo);
          if (!ol) throw new BadRequestException('มีสินค้าที่ไม่อยู่ในออเดอร์นี้ ลบรายการนั้น หรือทำใบคืนแบบไม่อ้างออเดอร์');
          const s = summary.lines.find((x) => x.orderLineNo === ol.lineNo)!;
          if (s.returned + good + damaged > s.taken + EPS) {
            throw new BadRequestException(`${ol.name} คืนเกินที่เบิกไป (เบิก ${s.taken} คืนแล้ว ${s.returned} ${ol.unit}) ลดจำนวนคืนแล้วลองอีกครั้ง`);
          }
          lines.push({ lineNo: lines.length + 1, orderLineNo: ol.lineNo, sku: ol.sku, itemCode: ol.itemCode, packCode: ol.packCode, name: ol.name, unit: ol.unit, goodQty: good, damagedQty: damaged });
        }
      } else {
        for (const line of input.lines) {
          const good = qtyValue(line.goodQty, 'จำนวนของดี'), damaged = qtyValue(line.damagedQty, 'จำนวนของเสียหาย');
          if (!good && !damaged) continue;
          const sku = optionalText(line.sku, 50);
          if (sku) {
            const product = await tx.product.findUnique({ where: { sku } });
            if (!product) throw new BadRequestException(`ไม่พบสินค้า ${sku} ลบรายการนี้แล้วสแกนใหม่`);
            const pack = await resolvePack(tx, product, optionalText(line.packCode, 100));
            if (!pack) throw new BadRequestException(`ขนาดบรรจุของ ${sku} ใช้ไม่ได้แล้ว เลือกขนาดบรรจุใหม่`);
            lines.push({ lineNo: lines.length + 1, orderLineNo: null, sku, itemCode: '', packCode: pack.code, name: pack.name, unit: pack.unitName, goodQty: good, damagedQty: damaged });
          } else {
            lines.push({
              lineNo: lines.length + 1, orderLineNo: null, sku: '', itemCode: optionalText(line.itemCode, 50), packCode: '',
              name: requireText(line.name, 'ชื่อสินค้า', 200), unit: requireText(line.unit, 'หน่วย', 30), goodQty: good, damagedQty: damaged,
            });
          }
        }
      }
      if (!lines.length) throw new BadRequestException('ยังไม่มีของที่คืน สแกนหรือใส่จำนวนอย่างน้อย 1 รายการ');
      const returnId = await nextDocNo(tx, 'RT');
      await tx.productReturn.create({ data: {
        id: returnId, requestId, orderId, reason: input.reason, returnerName: optionalText(input.returnerName, 100), note: optionalText(input.note, 1000),
        createdById: user.id, lines: { create: lines },
      } });
      await audit(tx, 'productReturn', returnId, user.id, null, { orderId, reason: input.reason, lines: lines.length });
      return returnId;
    });
    return this.get(id);
  }
}

@Controller('returns')
export class ReturnsController {
  constructor(private readonly returns: ReturnsService) {}

  @Get()
  @RequirePermissions('returns.create')
  list(@Query('q') q?: string, @Query('page') page?: string) { return this.returns.list(q, page); }

  @Get('order/:orderId')
  @RequirePermissions('returns.create')
  summary(@Param('orderId') orderId: string) { return this.returns.summary(orderId); }

  @Get(':id')
  @RequirePermissions('returns.create')
  get(@Param('id') id: string) { return this.returns.get(id); }

  @Post()
  @RequirePermissions('returns.create')
  create(@CurrentUser() user: SessionUser, @Body() body: ReturnInput) { return this.returns.create(user, body); }
}

@Module({ controllers: [ReturnsController], providers: [ReturnsService] })
export class ReturnsModule {}
