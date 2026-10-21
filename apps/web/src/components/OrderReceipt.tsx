import { ReactNode } from 'react';
import type { SalesOrder } from '@petmore/shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { BoothName, CheckBadge } from '@/components/wms';
import { OrderBarcode } from '@/components/OrderBarcode';
import { lineCode, sortBySkuCode } from '@/lib/doc-lines';
import { formatQty } from '@/lib/packs';
import { formatTime } from '../api';

/** ใบออเดอร์ที่บันทึกแล้ว ใช้ทั้งหลังบันทึกและดูย้อนหลัง พิมพ์เป็นขาวดำได้ */
export function OrderReceipt({ order, actions }: { order: SalesOrder; actions: ReactNode }) {
  return (
    <Card data-print-doc className="mx-auto w-full max-w-3xl print:max-w-none">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle role="heading" aria-level={2}>{order.id}</CardTitle>
            <CardDescription>บันทึกเมื่อ {formatTime(order.createdAt)}</CardDescription>
            <span className="flex flex-wrap gap-1.5 print:hidden"><CheckBadge check={order.lastCheck} /></span>
          </div>
          {/* คนตรวจของเบิกสแกนบาร์โค้ดนี้เปิดออเดอร์ได้ทันที */}
          <OrderBarcode id={order.id} />
        </div>
      </CardHeader>
      {/* ตอนพิมพ์ใช้ block แทน grid: Chrome ตัดหน้ากระดาษกลาง grid แล้วบรรทัดซ้อนกัน */}
      <CardContent className="grid gap-5 print:block print:space-y-5">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2"><dt className="text-muted-foreground">ผู้สั่ง{order.customerCode && <> · <span className="font-mono break-all">{order.customerCode}</span></>}</dt><dd className="font-heading text-lg font-semibold break-words"><BoothName code={order.customerCode} name={order.customerName} /></dd></div>
          <div><dt className="text-muted-foreground">เบอร์ติดต่อ</dt><dd className="break-words">{order.phone || 'ไม่ได้ระบุ'}</dd></div>
          <div><dt className="text-muted-foreground">วันที่รับออเดอร์</dt><dd>{order.date}</dd></div>
          {/* ออเดอร์เก่าก่อนเลิกใช้ช่องนัดรับ ยังแสดงให้เห็น */}
          {order.dueDate && <div><dt className="text-muted-foreground">วันที่นัดรับ / ส่ง</dt><dd>{order.dueDate}</dd></div>}
        </dl>
        {/* ใบจัดสินค้า: เรียงตามรหัสสินค้า (SKU_CODE) ของเดียวกันอยู่ติดกัน คนจัดหยิบได้ง่าย ช่องท้ายไว้เขียนจำนวนที่จัดได้ */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground print:text-black">
              <th className="hidden py-2 pr-2 font-medium sm:table-cell print:table-cell">รหัสสินค้า</th>
              <th className="py-2 pr-2 font-medium">ชื่อสินค้า</th>
              <th className="py-2 px-2 font-medium">หน่วย</th>
              <th className="py-2 px-2 text-right font-medium">จำนวน</th>
              <th className="py-2 pl-2 text-center font-medium">จำนวนที่จัดได้</th>
            </tr>
          </thead>
          <tbody>
            {sortBySkuCode(order.lines).map((line) => (
              <tr key={line.lineNo} className="break-inside-avoid border-b border-border align-top">
                <td className="hidden py-3 pr-2 font-mono text-xs whitespace-nowrap sm:table-cell print:table-cell print:py-1.5">{line.packCode || lineCode(line) || '–'}</td>
                <td className="py-3 pr-2 print:py-1.5">
                  <p className="font-medium break-words">{line.name}</p>
                  {/* คอลัมน์รหัส = บาร์โค้ดที่สั่ง (แยกขนาดของสินค้าเดียวกันได้) ลำดับยังเรียงตาม SKU_CODE มือถือไม่มีคอลัมน์นี้ จึงแสดงใต้ชื่อแทน */}
                  <p className="font-mono text-xs break-all text-muted-foreground sm:hidden print:hidden">{line.packCode || lineCode(line)}</p>
                </td>
                <td className="py-3 px-2 [overflow-wrap:anywhere] print:py-1.5">{line.unit}</td>
                <td className="py-3 px-2 text-right font-semibold tabular-nums print:py-1.5">{formatQty(line.qty)}</td>
                <td className="py-2 pl-2 text-center print:py-1"><span aria-hidden className="inline-block h-9 w-16 rounded-md border-2 border-card-edge bg-background/40 print:h-7 print:border-black print:bg-transparent sm:w-20" /></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-sm text-muted-foreground">รวม {order.lines.length} รายการ</p>
        {order.reference && <p className="text-sm break-words">อ้างอิง: {order.reference}</p>}
        {order.note && <p className="text-sm whitespace-pre-wrap break-words">หมายเหตุ: {order.note}</p>}
        {/* ช่องเซ็นชื่อ 3 ฝ่าย ถ้าถูกดันไปหน้าใหม่ยังรู้ว่าเป็นของออเดอร์ไหน */}
        <div className="grid break-inside-avoid grid-cols-3 gap-x-4 gap-y-6 pt-4 text-center text-sm sm:gap-x-8">
          <p className="col-span-3 text-left text-xs text-muted-foreground print:text-black">ลงชื่อรับรองออเดอร์ {order.id}</p>
          {['ผู้จัดสินค้า', 'ผู้ตรวจสอบสินค้า', 'ผู้รับสินค้า'].map((who) => (
            <div key={who} className="grid min-w-0 gap-1">
              <span className="border-b border-card-edge pb-8 print:border-black" />
              <span className="text-xs font-medium break-words sm:text-sm">{who}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>
      </CardContent>
    </Card>
  );
}

