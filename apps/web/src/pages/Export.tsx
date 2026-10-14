import { ShieldAlertIcon } from 'lucide-react';
import { ExportExcel } from '@/components/ExportExcel';

/** แผ่นงานในไฟล์ที่ส่งออก (ตรงกับ reports.module.ts ฝั่งเซิร์ฟเวอร์) */
const SHEETS = [
  { name: 'สรุปสินค้า', text: 'สั่ง เบิกจริง คืนของดี/เสียหาย ขายได้จริง เป็นชิ้นต่อสินค้า' },
  { name: 'ออเดอร์', text: 'เลขออเดอร์ ผู้สั่ง เบอร์ติดต่อ ผู้จด รายการสินค้า และผลตรวจล่าสุด' },
  { name: 'ใบคืน', text: 'เลขใบคืน สาเหตุ ผู้คืน ของดีและของเสียต่อรายการ' },
  { name: 'ข้อมูลไฟล์', text: 'ช่วงวันที่ ผู้ส่งออก และเวลาที่ส่งออก' },
];

/** หน้าส่งออก Excel สรุปงานขายหน้างาน (สิทธิ์ reports.export ตั้งต้นเฉพาะผู้ดูแลระบบ) */
export function ExportPage() {
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4">
      <ExportExcel />
      <section aria-labelledby="export-sheets" className="grid gap-3 rounded-xl border border-border p-4">
        <p id="export-sheets" className="font-heading font-semibold">ในไฟล์มีอะไรบ้าง</p>
        <ul className="grid gap-2 text-sm">
          {SHEETS.map((s) => (
            <li key={s.name} className="grid gap-0.5 sm:grid-cols-[7rem_minmax(0,1fr)]">
              <span className="font-medium">{s.name}</span>
              <span className="text-muted-foreground">{s.text}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-2 rounded-lg bg-secondary p-3 text-sm">
          <ShieldAlertIcon className="mt-0.5 size-4 shrink-0 text-kibble" aria-hidden />
          ไฟล์มีชื่อและเบอร์โทรของผู้สั่ง ส่งต่อเฉพาะคนที่เกี่ยวข้อง (ไม่มีข้อมูลผู้ใช้หรือรหัสผ่าน)
        </p>
      </section>
    </div>
  );
}
