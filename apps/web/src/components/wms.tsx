import { ReactNode, RefObject } from 'react';
import { AlertCircleIcon, CheckCircle2Icon, MinusIcon, PlusIcon } from 'lucide-react';
import { cn } from 'cn';
import { boothOf, type OrderPrep, type PackSize, type PickCheckStatus, type StockStatus } from '@petmore/shared';
import { breakdown, formatQty } from '@/lib/packs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Seal, SlotSparkles, SPELL_SLOT } from '@/components/magic';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SparkBurst, SparkBurstHandle } from '@/components/SparkBurst';

// ชิ้นส่วนหน้าจองานคลังที่ใช้ร่วมกันหลายหน้า (รับสินค้า ย้าย Location ดูสต็อก)

export type Message = { text: string; kind: 'error' | 'info' };

/** ชื่อผู้สั่งพร้อมเลขบูธในงาน ("บูธ 4 · บริษัท ...") คนหน้างานเรียกออเดอร์กันด้วยเลขบูธ ใช้ทุกหน้าที่แสดงออเดอร์ */
export function BoothName({ code, name }: { code: string; name: string }) {
  const booth = boothOf(code);
  return <>{booth ? `บูธ ${booth} · ` : ''}{name}</>;
}

/** ข้อความที่มีเลขเอกสาร (SO-2026-000002, RT-…) ห้ามตัดบรรทัดตรงขีดกลางเลข */
export function KeepIds({ text }: { text: string }) {
  return <>{text.split(/([A-Z]{2}-\d{4}-\d{6})/).map((part, i) => (i % 2 ? <span key={i} className="whitespace-nowrap">{part}</span> : part))}</>;
}

export function Field({ id, label, children, className }: { id: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid min-w-0 gap-1.5', className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

export function StatusBadge({ status }: { status: StockStatus }) {
  return status === 'DM' ? <Seal tone="rose" state="broken">DM</Seal> : <Seal tone="mint">{status}</Seal>;
}

/**
 * กล่องแสดงสิ่งที่สแกนแล้ว ("วงเวทรอร่าย"): ตอนว่างเป็นกรอบเส้นประทองจาง ไอคอนอยู่ในวงประ ประกายเส้นประที่มุม
 * สแกนเจอแล้วกรอบทองเต็ม วงไอคอนเป็นเส้นเต็ม ประกายมุมเต็มดวง พร้อมประกายระเบิด (SparkBurst)
 */
export function PickTile({
  icon,
  label,
  value,
  detail,
  emptyText = 'ยังไม่ได้สแกน',
  sparkRef,
}: {
  icon: ReactNode;
  label: string;
  value?: string;
  detail?: string;
  emptyText?: string;
  sparkRef?: RefObject<SparkBurstHandle | null>;
}) {
  const ok = !!value;
  return (
    <div
      className={cn(
        'flex min-w-0 items-start gap-3 p-3 pr-7 transition-colors',
        ok ? 'relative rounded-xl border border-star bg-star-soft shadow-[inset_0_1px_0_color-mix(in_oklab,white_45%,transparent)] dark:shadow-none' : SPELL_SLOT,
      )}
    >
      {sparkRef && <SparkBurst ref={sparkRef} />}
      <SlotSparkles filled={ok} />
      <span className={cn('relative grid size-10 shrink-0 place-items-center', ok ? 'text-star-ink dark:text-star' : 'text-muted-foreground')} aria-hidden="true">
        <svg viewBox="0 0 40 40" className="absolute inset-0 size-full">
          <circle cx="20" cy="20" r="18.5" fill="none" stroke="currentColor" strokeOpacity={ok ? 0.7 : 0.5} strokeWidth={1.2} strokeDasharray={ok ? undefined : '2.5 3.5'} />
        </svg>
        {icon}
      </span>
      <div className="grid min-w-0 gap-0.5">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <strong className={cn('font-heading text-lg leading-tight break-all', !ok && 'font-normal text-muted-foreground')}>
          {value ?? emptyText}
        </strong>
        {detail && <span className="text-sm text-muted-foreground">{detail}</span>}
      </div>
    </div>
  );
}

/**
 * ยอดคงเหลือแตกเป็นขนาดบรรจุ เช่น [1 PACK x 4 x 12] [2 PACK x 12] [5 PC]
 * ไม่แสดงถ้าแตกแล้วได้แค่หน่วยนับสต็อกเหมือนยอดรวม (ไม่มีข้อมูลเพิ่ม)
 */
export function QtyBreakdown({
  qty,
  unit,
  unitQty,
  sizes,
  className,
}: {
  qty: number;
  unit: string;
  unitQty: number;
  sizes: PackSize[];
  className?: string;
}) {
  const parts = breakdown(qty, sizes, unitQty);
  if (parts.length < 2 && (!parts[0] || parts[0].unitName === unit)) return null;
  return (
    <span className={cn('flex flex-wrap gap-1', className)} aria-label={`แยกเป็น ${parts.map((p) => `${formatQty(p.count)} ${p.unitName}`).join(' ')}`}>
      {parts.map((p) => (
        <span key={p.unitName} className="rounded-md bg-secondary px-1.5 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums" aria-hidden="true">
          <strong className="font-semibold">{formatQty(p.count)}</strong> {p.unitName}
        </span>
      ))}
    </span>
  );
}

/** ข้อความแจ้งผล: ข้อผิดพลาดอ่านออกเสียงทันที (role=alert) ข้อความสำเร็จอ่านเมื่อว่าง (role=status) */
export function Notice({ message }: { message: Message | null }) {
  if (!message) return null;
  const error = message.kind === 'error';
  return (
    <Alert variant={error ? 'destructive' : 'default'} role={error ? 'alert' : 'status'} className={cn(!error && 'border-mint/40')}>
      {error ? <AlertCircleIcon /> : <CheckCircle2Icon className="text-mint" />}
      <AlertDescription className={cn('whitespace-pre-wrap', !error && 'text-foreground')}>{message.text}</AlertDescription>
    </Alert>
  );
}

/**
 * ช่องจำนวนพร้อมปุ่ม − / + สูง 48px กดบน Handheld ได้โดยไม่ต้องเปิดแป้นตัวเลข ยังพิมพ์ทศนิยมได้
 * ลดไม่ต่ำกว่า min (ค่าเริ่ม 1) ค่าที่พิมพ์ผิดรูปให้หน้าที่ใช้ตรวจตอนบันทึก
 */
export function QtyStepper({ id, value, onChange, label, min = 1, max = 100_000_000, disabled, className }: {
  id?: string; value: string; onChange: (value: string) => void; label: string; min?: number; max?: number; disabled?: boolean; className?: string;
}) {
  const current = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(current);
  const step = (delta: number) => {
    const base = valid ? current : min;
    // ปัดทศนิยม 3 ตำแหน่ง กันเศษจากการบวกลบ float
    const next = Math.min(max, Math.max(min, Math.round((base + delta) * 1000) / 1000));
    onChange(String(next));
  };
  return (
    <div className={cn('flex min-w-0 items-stretch', className)} role="group" aria-label={label}>
      <Button type="button" variant="outline" size="icon-touch" className="rounded-r-none" aria-label={`ลด${label}`} disabled={disabled || (valid && current <= min)} onClick={() => step(-1)}>
        <MinusIcon />
      </Button>
      <Input
        id={id}
        className="h-12 min-w-0 flex-1 rounded-none border-x-0 text-center text-lg font-semibold tabular-nums md:text-lg"
        type="number" inputMode="decimal" min={min} max={max} step="any"
        value={value} onChange={(e) => onChange(e.target.value)} onFocus={(e) => e.target.select()} disabled={disabled}
      />
      <Button type="button" variant="outline" size="icon-touch" className="rounded-l-none" aria-label={`เพิ่ม${label}`} disabled={disabled || (valid && current >= max)} onClick={() => step(1)}>
        <PlusIcon />
      </Button>
    </div>
  );
}

/** ป้ายผลตรวจของเบิกล่าสุดของออเดอร์: ครบ (มิ้นต์) / ของไม่พอ ให้ตามที่มี (คาราเมล) / ไม่ครบ (แดง) / รอตรวจ */
export function CheckBadge({ check, className }: { check: { status: PickCheckStatus } | null | undefined; className?: string }) {
  // รูปประกายบอกสถานะได้แม้ไม่เห็นสี: เส้นประ = ยังไม่ร่าย, เต็ม = ครบ, ครึ่ง = ให้ตามที่มี, ขีดฆ่า = ไม่ตรง
  if (!check) return <Seal tone="plum" state="outline" className={className}>รอตรวจ</Seal>;
  if (check.status === 'MATCH') return <Seal tone="mint" className={className}>ตรวจแล้ว ครบ</Seal>;
  if (check.status === 'PARTIAL') return <Seal tone="kibble" state="half" className={className}>ของไม่พอ ให้ตามที่มี</Seal>;
  return <Seal tone="rose" state="broken" className={className}>ตรวจแล้ว ไม่ตรงออเดอร์</Seal>;
}

/** ป้ายการจัดสินค้า: รอจัด (เส้นประ) / กำลังจัด · ชื่อคนจัด (ครึ่ง คาราเมล) / จัดเสร็จ (เต็ม ฟ้า) */
export function PrepBadge({ prep, className }: { prep: Pick<OrderPrep, 'status' | 'byName'> | null | undefined; className?: string }) {
  if (!prep?.status) return <Seal tone="muted" state="outline" className={className}>รอจัด</Seal>;
  if (prep.status === 'PREPARING') return <Seal tone="kibble" state="half" className={className}>กำลังจัด{prep.byName && ` · ${prep.byName}`}</Seal>;
  return <Seal tone="sky" className={className}>จัดเสร็จ</Seal>;
}
