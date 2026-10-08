import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Injectable, Module, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { CheckCounts, CheckFilter, Customer, MAX_ORDER_LINES, OrderInput, Paged, PickCheck, PickCheckInput, SalesOrder, SessionUser } from '@petmore/shared';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { audit, nextDocNo, optionalText, requireRequestId, requireText } from '../common/util';
import { isUniqueViolation, PrismaService } from '../prisma/prisma.service';
import { resolvePack } from '../products/products.module';

// ผลตรวจของเบิกครั้งล่าสุดแนบไปกับออเดอร์ทุกครั้ง หน้ารายการจะได้แสดงป้ายสถานะ
const ORDER_INCLUDE = {
  lines: true,
  checks: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, status: true, createdAt: true, pickerName: true } },
} satisfies Prisma.SalesOrderInclude;
type StoredOrder = Prisma.SalesOrderGetPayload<{ include: typeof ORDER_INCLUDE }>;
type StoredCheck = Prisma.PickCheckGetPayload<{ include: { lines: true } }>;

function dateOnly(value: unknown, label: string, optional = false): string {
  if (optional && !value) return '';
  const text = typeof value === 'string' ? value : '';
  const parsed = new Date(text + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new BadRequestException(`${label}ไม่ถูกต้อง เลือกวันที่ใหม่`);
  }
  return text;
}

function numberValue(value: unknown, label: string, scale: number, positive: boolean): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || (positive ? value <= 0 : value < 0) || value > 100_000_000) {
    throw new BadRequestException(`${label}ต้อง${positive ? 'มากกว่า 0' : 'ไม่ติดลบ'} และไม่เกิน 100,000,000`);
  }
  if (new Prisma.Decimal(value).decimalPlaces() > scale) throw new BadRequestException(`${label}มีทศนิยมได้ไม่เกิน ${scale} ตำแหน่ง`);
  return value;
}

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  /** ผู้จัดการผู้ใช้และคนตรวจของเบิกเห็นออเดอร์ทุกคน ที่เหลือเห็นเฉพาะที่ตัวเองจด */
  private seesAll(user: SessionUser) {
    return (['users.manage', 'picks.check', 'returns.create'] as const).some((p) => user.permissions.includes(p));
  }

  private scope(user: SessionUser) {
    return this.seesAll(user) ? {} : { createdById: user.id };
  }

  private dto(order: StoredOrder): SalesOrder {
    return {
      id: order.id, customerCode: order.customerCode, customerName: order.customerName, customerType: order.customerType as SalesOrder['customerType'],
      phone: order.phone, channel: order.channel, date: order.date.toISOString().slice(0, 10), dueDate: order.dueDate,
      reference: order.reference, note: order.note, createdAt: order.createdAt.toISOString(), createdBy: order.createdById,
      total: Number(order.total), lines: order.lines.sort((a, b) => a.lineNo - b.lineNo).map((line) => ({
        lineNo: line.lineNo, sku: line.sku, itemCode: line.itemCode, name: line.name, unit: line.unit, packCode: line.packCode,
        qty: Number(line.qty), unitPrice: Number(line.unitPrice), amount: Number(line.amount),
      })),
      lastCheck: order.checks[0]
        ? { id: order.checks[0].id, status: order.checks[0].status as PickCheck['status'], createdAt: order.checks[0].createdAt.toISOString(), pickerName: order.checks[0].pickerName }
        : null,
    };
  }

  private checkDto(check: StoredCheck): PickCheck {
    return {
      id: check.id, orderId: check.orderId, pickerName: check.pickerName, status: check.status as PickCheck['status'], note: check.note,
      checkedBy: check.checkedById, createdAt: check.createdAt.toISOString(),
      lines: check.lines.sort((a, b) => a.lineNo - b.lineNo).map((l) => ({
        lineNo: l.lineNo, orderLineNo: l.orderLineNo, sku: l.sku, itemCode: l.itemCode, packCode: l.packCode, name: l.name, unit: l.unit,
        expectedQty: Number(l.expectedQty), actualQty: Number(l.actualQty),
      })),
    };
  }

  /** ผลตรวจครั้งล่าสุดของออเดอร์ (ใช้เปิดดูรายละเอียดว่าขาด/เกินอะไร) */
  async lastCheck(user: SessionUser, orderId: string): Promise<PickCheck | null> {
    await this.get(user, orderId);
    const check = await this.prisma.pickCheck.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' }, include: { lines: true } });
    return check ? this.checkDto(check) : null;
  }

  /**
   * บันทึกผลตรวจของเบิกตอนส่งมอบ ยอดที่ควรได้มาจากออเดอร์ที่เซิร์ฟเวอร์เท่านั้น
   * รายการในออเดอร์ที่ไม่ได้ส่งมา = นับได้ 0 (ขาดทั้งรายการ) ของที่ไม่อยู่ในออเดอร์ต้องมีจำนวน > 0
   */
  async check(user: SessionUser, orderId: string, input: PickCheckInput): Promise<PickCheck> {
    if (!input || typeof input !== 'object' || !Array.isArray(input.lines)) throw new BadRequestException('ส่งผลตรวจของเบิกไม่สำเร็จ โหลดหน้าใหม่แล้วตรวจอีกครั้ง');
    const requestId = requireRequestId(input.requestId);
    const existing = await this.prisma.pickCheck.findUnique({ where: { requestId }, include: { lines: true } });
    if (existing) {
      if (existing.orderId !== orderId || existing.checkedById !== user.id) throw new ConflictException('ผลตรวจนี้ถูกส่งไปแล้ว โหลดหน้าใหม่เพื่อดูผลล่าสุด');
      return this.checkDto(existing);
    }
    const order = await this.prisma.salesOrder.findUnique({ where: { id: orderId }, include: { lines: true } });
    if (!order) throw new NotFoundException('ไม่พบออเดอร์นี้ กลับไปเลือกจากรายการออเดอร์อีกครั้ง');
    if (input.lines.length > MAX_ORDER_LINES * 3) throw new BadRequestException('รายการตรวจมากเกินที่ระบบรองรับ ลบรายการที่ซ้ำแล้วลองอีกครั้ง');
    const actual = new Map<number, number>();
    const extras: { sku: string; itemCode: string; packCode: string; name: string; unit: string; qty: number }[] = [];
    for (const line of input.lines) {
      const qty = line.actualQty === 0 ? 0 : numberValue(line.actualQty, 'จำนวนที่นับได้', 3, false);
      if (line.orderLineNo !== null && line.orderLineNo !== undefined) {
        if (!order.lines.some((l) => l.lineNo === line.orderLineNo)) throw new BadRequestException(`ออเดอร์นี้ไม่มีรายการที่ ${line.orderLineNo} โหลดหน้าใหม่แล้วตรวจอีกครั้ง`);
        actual.set(line.orderLineNo, qty);
      } else if (qty > 0) {
        extras.push({
          sku: optionalText(line.sku, 50), itemCode: optionalText(line.itemCode, 50), packCode: optionalText(line.packCode, 100),
          name: requireText(line.name, 'ชื่อสินค้าที่เกินมา', 200), unit: requireText(line.unit, 'หน่วย', 30), qty,
        });
      }
    }
    const lines = [
      ...order.lines.sort((a, b) => a.lineNo - b.lineNo).map((l) => ({
        orderLineNo: l.lineNo, sku: l.sku, itemCode: l.itemCode, packCode: l.packCode, name: l.name, unit: l.unit,
        expectedQty: l.qty, actualQty: new Prisma.Decimal(actual.get(l.lineNo) ?? 0),
      })),
      ...extras.map((x) => ({ orderLineNo: null, sku: x.sku, itemCode: x.itemCode, packCode: x.packCode, name: x.name, unit: x.unit, expectedQty: new Prisma.Decimal(0), actualQty: new Prisma.Decimal(x.qty) })),
    ];
    const status = lines.every((l) => l.actualQty.equals(l.expectedQty)) ? 'MATCH' : 'MISMATCH';
    const id = await this.prisma.$transaction(async (tx) => {
      const checkId = await nextDocNo(tx, 'CK');
      await tx.pickCheck.create({ data: {
        id: checkId, requestId, orderId, status, pickerName: optionalText(input.pickerName, 100), note: optionalText(input.note, 1000), checkedById: user.id,
        lines: { create: lines.map((l, i) => ({ ...l, lineNo: i + 1 })) },
      } });
      await tx.salesOrder.update({ where: { id: orderId }, data: { checkStatus: status } });
      await audit(tx, 'pickCheck', checkId, user.id, null, { orderId, status, lines: lines.length });
      return checkId;
    });
    return this.checkDto((await this.prisma.pickCheck.findUnique({ where: { id }, include: { lines: true } }))!);
  }

  /** จำนวนออเดอร์ในแต่ละแท็บของหน้าตรวจของเบิก (ตามสิทธิ์ที่เห็น) */
  async checkCounts(user: SessionUser): Promise<CheckCounts> {
    const groups = await this.prisma.salesOrder.groupBy({ by: ['checkStatus'], where: this.scope(user), _count: { _all: true } });
    const n = (s: string) => groups.find((g) => g.checkStatus === s)?._count._all ?? 0;
    return { PENDING: n(''), MATCH: n('MATCH'), MISMATCH: n('MISMATCH'), ALL: groups.reduce((t, g) => t + g._count._all, 0) };
  }

  async list(user: SessionUser, q = '', pageValue = '1', check = ''): Promise<Paged<SalesOrder>> {
    const page = /^\d+$/.test(pageValue) ? Math.max(1, Math.min(100_000, Number(pageValue))) : 1;
    const term = q.trim().slice(0, 100);
    const where: Prisma.SalesOrderWhereInput = {
      ...this.scope(user),
      ...(check === 'PENDING' ? { checkStatus: '' } : check === 'MATCH' || check === 'MISMATCH' ? { checkStatus: check } : {}),
      ...(term ? { OR: ['id', 'customerCode', 'customerName', 'phone', 'reference'].map((field) => ({ [field]: { contains: term, mode: 'insensitive' } })) } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.salesOrder.count({ where }),
      this.prisma.salesOrder.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * 20, take: 20, include: ORDER_INCLUDE }),
    ]);
    return { rows: rows.map((row) => this.dto(row)), total, page, pages: Math.max(1, Math.ceil(total / 20)) };
  }

  async get(user: SessionUser, id: string): Promise<SalesOrder> {
    const order = await this.prisma.salesOrder.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('ไม่พบออเดอร์นี้ กลับไปเลือกจากรายการออเดอร์อีกครั้ง');
    if (!this.seesAll(user) && order.createdById !== user.id) throw new ForbiddenException('บัญชีนี้ดูได้เฉพาะออเดอร์ที่ตัวเองจด');
    return this.dto(order);
  }

  /** รายชื่อผู้สั่งทั้งหมด (~256 ราย) โหลดครั้งเดียวแล้วค้นในเครื่อง */
  async customers(): Promise<Customer[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.customer.findMany({ where: { active: true }, select: { code: true, name: true }, orderBy: { name: 'asc' } }),
      this.prisma.product.groupBy({ by: ['customerCode'], where: { active: true, customerCode: { not: '' } }, _count: { _all: true } }),
    ]);
    const count = new Map(counts.map((c) => [c.customerCode, c._count._all]));
    // ผู้สั่งที่มีสินค้ามากขึ้นก่อน คนที่ไม่มีสินค้าในทะเบียนไปท้ายสุด
    return rows.map((c) => ({ ...c, products: count.get(c.code) ?? 0 })).sort((a, b) => Number(!a.products) - Number(!b.products) || a.name.localeCompare(b.name, 'th'));
  }

  async post(user: SessionUser, input: OrderInput): Promise<SalesOrder> {
    if (!input || typeof input !== 'object') throw new BadRequestException('ส่งออเดอร์ไม่สำเร็จ โหลดหน้าใหม่แล้วลองอีกครั้ง');
    const requestId = requireRequestId(input.requestId);
    // ผู้สั่งต้องมาจากทะเบียน dbo.ICCAT ใช้ชื่อจากฐานข้อมูล ไม่เชื่อชื่อที่หน้าเว็บส่งมา
    const customerCode = requireText(input.customerCode, 'ผู้สั่ง', 50);
    const customer = await this.prisma.customer.findUnique({ where: { code: customerCode } });
    if (!customer?.active) throw new BadRequestException('ไม่พบผู้สั่งนี้ในทะเบียน เลือกผู้สั่งจากรายการอีกครั้ง');
    const customerName = customer.name;
    const date = dateOnly(input.date, 'วันที่รับออเดอร์');
    if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > MAX_ORDER_LINES) throw new BadRequestException(`เพิ่มสินค้า 1–${MAX_ORDER_LINES} รายการ`);
    const body = {
      customerCode, date,
      phone: optionalText(input.phone, 50), reference: optionalText(input.reference, 100), note: optionalText(input.note, 1000),
      lines: input.lines.map((line) => {
        if (!line || typeof line !== 'object') throw new BadRequestException('มีรายการสินค้าที่อ่านไม่ได้ ลบรายการนั้นแล้วเพิ่มใหม่');
        return { sku: optionalText(line.sku, 50), itemCode: optionalText(line.itemCode, 50), packCode: optionalText(line.packCode, 100), name: optionalText(line.name, 200), unit: optionalText(line.unit, 30),
          qty: numberValue(line.qty, 'จำนวน', 3, true), unitPrice: line.unitPrice === undefined ? 0 : numberValue(line.unitPrice, 'ราคา', 2, false) };
      }),
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    const replay = (existing: StoredOrder): SalesOrder => {
      if (existing.createdById !== user.id || existing.fingerprint !== fingerprint) throw new ConflictException('ออเดอร์นี้อาจบันทึกไปแล้ว ตรวจในรายการออเดอร์ก่อนสร้างใหม่');
      return this.dto(existing);
    };
    const existing = await this.prisma.salesOrder.findUnique({ where: { requestId }, include: ORDER_INCLUDE });
    if (existing) return replay(existing);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const lines = [];
        let total = new Prisma.Decimal(0);
        for (const [index, line] of body.lines.entries()) {
          let name = requireText(line.name, 'ชื่อสินค้า', 200);
          let unit = requireText(line.unit, 'หน่วย', 30);
          if (line.sku) {
            const product = await tx.product.findUnique({ where: { sku: line.sku } });
            if (!product?.active) throw new BadRequestException(`ไม่พบสินค้า ${line.sku} หรือสินค้าถูกปิดใช้งาน ลบรายการนี้แล้วเลือกสินค้าอื่น`);
            const pack = await resolvePack(tx, product, line.packCode);
            if (!pack) throw new BadRequestException(`ขนาดบรรจุของ ${line.sku} ใช้ไม่ได้แล้ว เลือกขนาดบรรจุใหม่`);
            name = pack.name;
            unit = pack.unitName;
            if (line.itemCode) throw new BadRequestException('สินค้าที่เลือกจากรายการไม่ต้องกรอกรหัสสินค้าเอง ลบรหัสที่กรอกออก');
          } else if (line.packCode) throw new BadRequestException('สินค้าที่กรอกเองเลือกขนาดบรรจุไม่ได้ ลบรายการแล้วเพิ่มใหม่');
          const amount = new Prisma.Decimal(line.unitPrice).mul(line.qty).toDecimalPlaces(2);
          total = total.add(amount);
          if (total.gte('1000000000000')) throw new BadRequestException('ยอดรวมออเดอร์สูงเกินที่ระบบรองรับ ตรวจจำนวนและราคาอีกครั้ง');
          lines.push({ ...line, name, unit, lineNo: index + 1, amount });
        }
        const id = await nextDocNo(tx, 'SO');
        const order = await tx.salesOrder.create({ data: {
          // ประเภท ช่องทาง วันนัดรับ เลิกใช้ในหน้าจอแล้ว คอลัมน์ยังอยู่เพื่อออเดอร์เก่า
          id, requestId, fingerprint, customerCode, customerName, customerType: 'CUSTOMER',
          phone: body.phone, channel: '', reference: body.reference, note: body.note, dueDate: '',
          date: new Date(date + 'T00:00:00Z'), createdById: user.id, total, lines: { create: lines },
        }, include: ORDER_INCLUDE });
        await audit(tx, 'salesOrder', id, user.id, null, { id, customerName, total: total.toString(), count: lines.length });
        return this.dto(order);
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        const duplicate = await this.prisma.salesOrder.findUnique({ where: { requestId }, include: ORDER_INCLUDE });
        if (duplicate) return replay(duplicate);
      }
      throw e;
    }
  }
}

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  @RequirePermissions('orders.view', 'orders.create', 'picks.check', 'returns.create')
  list(@CurrentUser() user: SessionUser, @Query('q') q?: string, @Query('page') page?: string, @Query('check') check?: CheckFilter) { return this.orders.list(user, q, page, check); }

  @Get('check-counts')
  @RequirePermissions('picks.check')
  checkCounts(@CurrentUser() user: SessionUser) { return this.orders.checkCounts(user); }

  @Get('customers')
  @RequirePermissions('orders.create')
  customers() { return this.orders.customers(); }

  @Get(':id')
  @RequirePermissions('orders.view', 'orders.create', 'picks.check', 'returns.create')
  get(@CurrentUser() user: SessionUser, @Param('id') id: string) { return this.orders.get(user, id); }

  @Get(':id/checks/last')
  @RequirePermissions('orders.view', 'picks.check')
  lastCheck(@CurrentUser() user: SessionUser, @Param('id') id: string) { return this.orders.lastCheck(user, id); }

  @Post(':id/checks')
  @RequirePermissions('picks.check')
  check(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body() body: PickCheckInput) { return this.orders.check(user, id, body); }

  @Post()
  @RequirePermissions('orders.create')
  post(@CurrentUser() user: SessionUser, @Body() body: OrderInput) { return this.orders.post(user, body); }
}

@Module({ controllers: [OrdersController], providers: [OrdersService] })
export class OrdersModule {}
