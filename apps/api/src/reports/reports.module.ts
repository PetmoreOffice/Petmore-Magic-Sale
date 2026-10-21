import { BadRequestException, Controller, Get, Header, Injectable, Module, Query, StreamableFile } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { PickCheckStatus, RETURN_REASONS, ReturnReason, SessionUser } from '@petmore/shared';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { isIsoDate } from '../common/util';
import { PrismaService } from '../prisma/prisma.service';

/** ช่วงวันที่ส่งออกได้นานสุด (กันไฟล์ใหญ่จนเครื่องค้าง) */
const MAX_DAYS = 93;
/** เวลาในไฟล์เป็นเวลาไทย */
const TZ_OFFSET_MS = 7 * 3600_000;
const CHECK_LABEL: Record<PickCheckStatus | '', string> = { '': 'รอตรวจ', MATCH: 'ครบ', PARTIAL: 'ของไม่พอ ให้ตามที่มี', MISMATCH: 'ไม่ตรงออเดอร์' };
const QTY_FMT = '#,##0.###';

type Num = Prisma.Decimal | number;
const n = (v: Num | null | undefined) => (v === null || v === undefined ? 0 : Number(v));
const thaiTime = (d: Date) => new Date(d.getTime() + TZ_OFFSET_MS);

/** แถวสรุปต่อสินค้า (ชิ้น) สินค้ากรอกเองใช้หน่วยที่กรอก */
interface SummaryRow {
  code: string; name: string; unit: string;
  ordered: number; picked: number; returnedGood: number; returnedDamaged: number; freeGood: number; freeDamaged: number;
}

/**
 * ส่งออก Excel สรุปงานขายหน้างาน: สรุปสินค้า / ออเดอร์ / ใบคืน / ข้อมูลไฟล์
 * ขอบเขตข้อมูลเหมือนหน้าออเดอร์: ผู้มีสิทธิ์ดูทุกออเดอร์เห็นทั้งหมด ที่เหลือเห็นเฉพาะออเดอร์ที่ตัวเองจด (และใบคืนของออเดอร์นั้น)
 * ยอดสรุปเป็น "ชิ้น" (UTQ_QTY จากทะเบียน) เหมือนหน้าตรวจของเบิก/คืนสินค้า ขายได้จริง = เบิก − คืน (เฉพาะคืนที่ผูกออเดอร์)
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private seesAll(user: SessionUser) {
    return (['users.manage', 'picks.check', 'returns.create'] as const).some((p) => user.permissions.includes(p));
  }

  async exportXlsx(user: SessionUser, fromValue = '', toValue = ''): Promise<{ file: Buffer; name: string }> {
    const from = String(fromValue ?? '').trim(), to = String(toValue ?? '').trim();
    if (!isIsoDate(from) || !isIsoDate(to)) throw new BadRequestException('เลือกวันที่เริ่มและวันที่สิ้นสุดก่อนส่งออก');
    if (from > to) throw new BadRequestException('วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด');
    const fromDate = new Date(from + 'T00:00:00Z'), toDate = new Date(to + 'T00:00:00Z');
    if ((toDate.getTime() - fromDate.getTime()) / 86_400_000 > MAX_DAYS) throw new BadRequestException(`ส่งออกได้ครั้งละไม่เกิน ${MAX_DAYS} วัน เลือกช่วงวันที่ให้สั้นลง`);

    const all = this.seesAll(user);
    // ออเดอร์ตามวันที่รับออเดอร์, ใบคืนตามวันที่บันทึก (เวลาไทย)
    const orders = await this.prisma.salesOrder.findMany({
      where: { date: { gte: fromDate, lte: toDate }, ...(all ? {} : { createdById: user.id }) },
      include: { lines: true, checks: { orderBy: { createdAt: 'desc' }, take: 1, include: { lines: true } } },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
    });
    const retFrom = new Date(fromDate.getTime() - TZ_OFFSET_MS), retTo = new Date(toDate.getTime() + 86_400_000 - TZ_OFFSET_MS);
    const returns = await this.prisma.productReturn.findMany({
      where: { createdAt: { gte: retFrom, lt: retTo }, ...(all ? {} : { order: { createdById: user.id } }) },
      include: { lines: true, order: { select: { customerName: true, customerCode: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // ชิ้นต่อ 1 หน่วยของรหัส: บาร์โค้ดขนาดบรรจุ หรือรหัส SKU = หน่วยนับสต็อก
    const skus = [...new Set([...orders.flatMap((o) => o.lines.map((l) => l.sku)), ...returns.flatMap((r) => r.lines.map((l) => l.sku))].filter(Boolean))];
    const [products, packs] = await Promise.all([
      this.prisma.product.findMany({ where: { sku: { in: skus } }, select: { sku: true, name: true, unitQty: true } }),
      this.prisma.productPack.findMany({ where: { sku: { in: skus } }, select: { code: true, sku: true, unitQty: true } }),
    ]);
    const productBySku = new Map(products.map((p) => [p.sku, p]));
    const packPieces = new Map(packs.map((k) => [k.code, n(k.unitQty)]));
    const perUnit = (sku: string, code: string) => (code && packPieces.get(code)) || (code === sku || !code ? n(productBySku.get(sku)?.unitQty) : 0) || 1;
    const users = new Map((await this.prisma.user.findMany({ select: { id: true, displayName: true, username: true } })).map((u) => [u.id, u.displayName || u.username]));

    // ---------- สรุปต่อสินค้า ----------
    const summary = new Map<string, SummaryRow>();
    const rowFor = (sku: string, itemCode: string, name: string, unit: string) => {
      const key = sku ? `S|${sku}` : `M|${itemCode}|${name}|${unit}`;
      let row = summary.get(key);
      if (!row) {
        row = { code: sku || itemCode, name: sku ? productBySku.get(sku)?.name ?? name : name, unit: sku ? 'ชิ้น' : unit,
          ordered: 0, picked: 0, returnedGood: 0, returnedDamaged: 0, freeGood: 0, freeDamaged: 0 };
        summary.set(key, row);
      }
      return row;
    };
    for (const o of orders) {
      const check = o.checks[0];
      for (const l of o.lines) {
        const per = l.sku ? perUnit(l.sku, l.packCode) : 1;
        const row = rowFor(l.sku, l.itemCode, l.name, l.unit);
        row.ordered += n(l.qty) * per;
        const c = check?.lines.find((x) => x.orderLineNo === l.lineNo);
        // ยังไม่ตรวจ = ถือว่าเบิกตามออเดอร์ (กติกาเดียวกับหน้าคืนสินค้า)
        row.picked += !check ? n(l.qty) * per : c?.actualPieces ? n(c.actualPieces) : n(c?.actualQty) * per;
      }
    }
    for (const r of returns) {
      for (const l of r.lines) {
        const per = l.inPieces || !l.sku ? 1 : perUnit(l.sku, l.packCode);
        const row = rowFor(l.sku, l.itemCode, l.name, l.unit);
        if (r.orderId) { row.returnedGood += n(l.goodQty) * per; row.returnedDamaged += n(l.damagedQty) * per; }
        else { row.freeGood += n(l.goodQty) * per; row.freeDamaged += n(l.damagedQty) * per; }
      }
    }

    // ---------- สร้างไฟล์ ----------
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Petmore Magic Sale';
    wb.created = new Date();
    const sheet = (name: string, columns: { header: string; key: string; width: number; fmt?: string }[]) => {
      const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = columns.map((c) => ({ header: c.header, key: c.key, width: c.width, style: c.fmt ? { numFmt: c.fmt } : {} }));
      ws.getRow(1).font = { bold: true };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE7F6' } };
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
      return ws;
    };

    const sum = sheet('สรุปสินค้า', [
      { header: 'รหัสสินค้า', key: 'code', width: 22 }, { header: 'ชื่อสินค้า', key: 'name', width: 46 }, { header: 'หน่วยนับ', key: 'unit', width: 10 },
      { header: 'สั่ง', key: 'ordered', width: 10, fmt: QTY_FMT }, { header: 'เบิกจริง', key: 'picked', width: 10, fmt: QTY_FMT },
      { header: 'คืนของดี', key: 'returnedGood', width: 10, fmt: QTY_FMT }, { header: 'คืนเสียหาย', key: 'returnedDamaged', width: 11, fmt: QTY_FMT },
      { header: 'ขายได้จริง', key: 'sold', width: 11, fmt: QTY_FMT },
      { header: 'คืนใบอิสระ ดี', key: 'freeGood', width: 13, fmt: QTY_FMT }, { header: 'คืนใบอิสระ เสีย', key: 'freeDamaged', width: 14, fmt: QTY_FMT },
    ]);
    const round = (v: number) => Math.round(v * 1000) / 1000;
    for (const r of [...summary.values()].sort((a, b) => a.name.localeCompare(b.name, 'th') || a.code.localeCompare(b.code))) {
      sum.addRow({ ...r, ordered: round(r.ordered), picked: round(r.picked), returnedGood: round(r.returnedGood), returnedDamaged: round(r.returnedDamaged),
        sold: round(r.picked - r.returnedGood - r.returnedDamaged), freeGood: round(r.freeGood), freeDamaged: round(r.freeDamaged) });
    }

    const ord = sheet('ออเดอร์', [
      { header: 'เลขออเดอร์', key: 'id', width: 16 }, { header: 'วันที่รับออเดอร์', key: 'date', width: 14, fmt: 'dd/mm/yyyy' },
      { header: 'บันทึกเมื่อ', key: 'createdAt', width: 17, fmt: 'dd/mm/yyyy hh:mm' }, { header: 'รหัสผู้สั่ง', key: 'customerCode', width: 11 },
      { header: 'ผู้สั่ง', key: 'customerName', width: 32 }, { header: 'เบอร์ติดต่อ', key: 'phone', width: 14 }, { header: 'ผู้จด', key: 'createdBy', width: 18 },
      { header: 'สถานะตรวจ', key: 'status', width: 18 }, { header: 'ผู้ตรวจ', key: 'picker', width: 16 },
      { header: 'รายการที่', key: 'lineNo', width: 9 }, { header: 'รหัสสินค้า', key: 'sku', width: 20 }, { header: 'บาร์โค้ด', key: 'packCode', width: 20 },
      { header: 'ชื่อสินค้า', key: 'name', width: 44 }, { header: 'หน่วย', key: 'unit', width: 12 },
      { header: 'จำนวนสั่ง', key: 'qty', width: 10, fmt: QTY_FMT }, { header: 'นับได้', key: 'actual', width: 10, fmt: QTY_FMT },
      { header: 'สั่ง (ชิ้น)', key: 'orderedPieces', width: 11, fmt: QTY_FMT }, { header: 'เบิกจริง (ชิ้น)', key: 'pickedPieces', width: 13, fmt: QTY_FMT },
      { header: 'นับเองเพราะ', key: 'manual', width: 22 }, { header: 'เลขอ้างอิง', key: 'reference', width: 14 }, { header: 'หมายเหตุ', key: 'note', width: 30 },
    ]);
    for (const o of orders) {
      const check = o.checks[0];
      for (const l of [...o.lines].sort((a, b) => a.lineNo - b.lineNo)) {
        const c = check?.lines.find((x) => x.orderLineNo === l.lineNo);
        const per = l.sku ? perUnit(l.sku, l.packCode) : 1;
        ord.addRow({
          id: o.id, date: o.date, createdAt: thaiTime(o.createdAt), customerCode: o.customerCode, customerName: o.customerName, phone: o.phone,
          createdBy: users.get(o.createdById) ?? '', status: CHECK_LABEL[(check?.status ?? '') as PickCheckStatus | ''] ?? check?.status, picker: check?.pickerName ?? '',
          lineNo: l.lineNo, sku: l.sku || l.itemCode, packCode: l.packCode, name: l.name, unit: l.unit, qty: n(l.qty),
          actual: check ? n(c?.actualQty) : null,
          orderedPieces: l.sku ? round(n(l.qty) * per) : null,
          pickedPieces: !l.sku ? null : !check ? round(n(l.qty) * per) : c?.actualPieces ? n(c.actualPieces) : round(n(c?.actualQty) * per),
          manual: c?.manualReason ?? '', reference: o.reference, note: o.note,
        });
      }
      // ของที่ไม่อยู่ในออเดอร์ (ตรวจเจอ) ใส่ต่อท้ายออเดอร์นั้น
      for (const x of check?.lines.filter((x) => x.orderLineNo === null) ?? []) {
        ord.addRow({ id: o.id, date: o.date, createdAt: thaiTime(o.createdAt), customerCode: o.customerCode, customerName: o.customerName, phone: o.phone,
          createdBy: users.get(o.createdById) ?? '', status: 'ของไม่อยู่ในออเดอร์', picker: check?.pickerName ?? '', lineNo: null,
          sku: x.sku || x.itemCode, packCode: x.packCode, name: x.name, unit: x.unit, qty: 0, actual: n(x.actualQty), manual: '', reference: o.reference, note: o.note });
      }
    }

    const ret = sheet('ใบคืน', [
      { header: 'เลขใบคืน', key: 'id', width: 16 }, { header: 'บันทึกเมื่อ', key: 'createdAt', width: 17, fmt: 'dd/mm/yyyy hh:mm' },
      { header: 'จากออเดอร์', key: 'orderId', width: 16 }, { header: 'ผู้สั่ง', key: 'customerName', width: 32 }, { header: 'สาเหตุ', key: 'reason', width: 14 },
      { header: 'ผู้คืนสินค้า', key: 'returner', width: 16 }, { header: 'ผู้บันทึก', key: 'createdBy', width: 18 },
      { header: 'รหัสสินค้า', key: 'sku', width: 20 }, { header: 'บาร์โค้ด', key: 'packCode', width: 20 }, { header: 'ชื่อสินค้า', key: 'name', width: 44 },
      { header: 'หน่วย', key: 'unit', width: 12 }, { header: 'ของดี', key: 'good', width: 9, fmt: QTY_FMT }, { header: 'เสียหาย', key: 'damaged', width: 9, fmt: QTY_FMT },
      { header: 'หมายเหตุ', key: 'note', width: 30 },
    ]);
    for (const r of returns) {
      for (const l of [...r.lines].sort((a, b) => a.lineNo - b.lineNo)) {
        ret.addRow({ id: r.id, createdAt: thaiTime(r.createdAt), orderId: r.orderId ?? 'ใบคืนอิสระ', customerName: r.order?.customerName ?? '',
          reason: RETURN_REASONS[r.reason as ReturnReason] ?? r.reason, returner: r.returnerName, createdBy: users.get(r.createdById) ?? '',
          sku: l.sku || l.itemCode, packCode: l.packCode, name: l.name, unit: l.unit, good: n(l.goodQty), damaged: n(l.damagedQty), note: r.note });
      }
    }

    const info = wb.addWorksheet('ข้อมูลไฟล์');
    info.columns = [{ width: 24 }, { width: 50 }];
    const thaiDate = (iso: string) => new Date(iso + 'T00:00:00Z').toLocaleDateString('th-TH', { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' });
    const rows: [string, string | number][] = [
      ['รายงาน', 'Petmore Magic Sale สรุปงานขายหน้างาน'],
      ['ช่วงวันที่', from === to ? thaiDate(from) : `${thaiDate(from)} – ${thaiDate(to)}`],
      ['ส่งออกโดย', `${user.displayName} (${user.username})`],
      ['ส่งออกเมื่อ', new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })],
      ['ขอบเขต', all ? 'ออเดอร์ทุกคน' : 'เฉพาะออเดอร์ที่ตัวเองจด'],
      ['จำนวนออเดอร์', orders.length],
      ['จำนวนใบคืน', returns.length],
      ['หมายเหตุ', 'สรุปสินค้าเป็นจำนวนชิ้น · ยังไม่ตรวจ = นับว่าเบิกตามออเดอร์ · ขายได้จริง = เบิกจริง − คืน (เฉพาะใบคืนที่ผูกออเดอร์) · ใบคืนอิสระแยกคอลัมน์'],
    ];
    for (const r of rows) info.addRow(r);
    info.getColumn(1).font = { bold: true };
    info.getColumn(2).alignment = { wrapText: true, vertical: 'top' };

    const file = Buffer.from(await wb.xlsx.writeBuffer());
    return { file, name: `petmore-magic-sale_${from}_${to}.xlsx` };
  }
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('export')
  @RequirePermissions('reports.export')
  @Header('Cache-Control', 'no-store')
  async export(@CurrentUser() user: SessionUser, @Query('from') from?: string, @Query('to') to?: string) {
    const { file, name } = await this.reports.exportXlsx(user, from, to);
    return new StreamableFile(file, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', disposition: `attachment; filename="${name}"` });
  }
}

@Module({ controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
