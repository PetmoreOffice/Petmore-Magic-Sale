import { useState } from 'react';
import { FileSpreadsheetIcon, LoaderCircleIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Message, Notice } from '@/components/wms';
import { touchInput } from '@/lib/touch';
import { downloadFile, todayIso } from '../api';

/** วันที่ ISO บวก/ลบจำนวนวัน (เทียบแบบวันล้วน ไม่ขึ้นกับเขตเวลาเครื่อง) */
const shift = (iso: string, days: number) => new Date(Date.parse(iso + 'T00:00:00Z') + days * 86_400_000).toISOString().slice(0, 10);

/**
 * ส่งออก Excel สรุปงานขายหน้างาน (สรุปสินค้าเป็นชิ้น / ออเดอร์ / ใบคืน) ตามช่วงวันที่รับออเดอร์
 * ใครเห็นข้อมูลแค่ไหนเป็นไปตามสิทธิ์เดียวกับหน้าออเดอร์ (เซิร์ฟเวอร์ตัดสิน)
 */
export function ExportExcel() {
  const today = todayIso();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function run() {
    setMessage(null);
    if (!from || !to) return setMessage({ kind: 'error', text: 'เลือกวันที่เริ่มและวันที่สิ้นสุดก่อนส่งออก' });
    if (from > to) return setMessage({ kind: 'error', text: 'วันที่เริ่มต้องไม่หลังวันที่สิ้นสุด' });
    setBusy(true);
    try {
      const name = await downloadFile(`/reports/export?from=${from}&to=${to}`, `petmore-magic-sale_${from}_${to}.xlsx`);
      setMessage({ kind: 'info', text: `ดาวน์โหลด ${name} แล้ว เปิดด้วย Excel หรือ Google Sheets ได้เลย` });
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="export-title" className="grid gap-3 rounded-xl border border-border bg-secondary/40 p-4">
      <div className="grid gap-0.5">
        <p id="export-title" className="flex items-center gap-2 font-heading font-semibold"><FileSpreadsheetIcon className="size-5 text-mint" aria-hidden />ส่งออก Excel</p>
        <p className="text-sm text-muted-foreground">สรุปสินค้า (สั่ง เบิกจริง คืน ขายได้จริง เป็นชิ้น) รายการออเดอร์ และใบคืน ตามวันที่รับออเดอร์</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Field id="export-from" label="ตั้งแต่วันที่"><Input id="export-from" type="date" className={touchInput} value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field id="export-to" label="ถึงวันที่"><Input id="export-to" type="date" className={touchInput} value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Field>
        <Button size="touch" onClick={() => void run()} disabled={busy}>
          {busy ? <LoaderCircleIcon className="animate-spin" /> : <FileSpreadsheetIcon />}ส่งออก Excel
        </Button>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="ช่วงวันที่ที่ใช้บ่อย">
        <Button variant="outline" size="touch" disabled={busy} onClick={() => { setFrom(today); setTo(today); }}>วันนี้</Button>
        <Button variant="outline" size="touch" disabled={busy} onClick={() => { setFrom(shift(today, -6)); setTo(today); }}>7 วันล่าสุด</Button>
        <Button variant="outline" size="touch" disabled={busy} onClick={() => { setFrom(shift(today, -29)); setTo(today); }}>30 วันล่าสุด</Button>
      </div>
      <Notice message={message} />
    </section>
  );
}
