import { useEffect, useId, useMemo, useState } from 'react';
import { Building2Icon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { boothOf, EVENT_BOOTHS, searchKey as fold, type Customer } from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Message, Notice } from '@/components/wms';
import { touchInput } from '@/lib/touch';
import { api } from '../api';

const SHOW = 8;
// โหลดครั้งเดียวต่อการเปิดแอป รายชื่อมีแค่ ~256 ราย และเปลี่ยนตามรอบ sync เท่านั้น
let cache: Promise<Customer[]> | null = null;

/** ป้ายเลขบูธ ขนาดเท่ากันทุกแถว ให้ชื่อบริษัทเริ่มตรงกัน */
function BoothTag({ booth }: { booth: number }) {
  return <span className="inline-flex h-7 w-16 shrink-0 items-center justify-center rounded-full bg-star-soft text-xs font-semibold text-star-ink tabular-nums">บูธ {booth}</span>;
}

/**
 * เลือกผู้สั่งจากทะเบียน dbo.ICCAT (บริษัทคู่ค้า)
 * เลือกจากบูธในงาน 1–23 เรียงตามเลขบูธพร้อมชื่อบริษัท (EVENT_BOOTHS ใน shared) มือถือเป็นเมนูของเครื่อง จอกว้างเป็นรายการ 2 คอลัมน์
 * ไม่มีช่องพิมพ์ค้น (ตัดออกตามที่ผู้ใช้ขอ 2026-10-18) ช่องค้นทั้งทะเบียนขึ้นเฉพาะเมื่อไม่มีบริษัทของบูธในทะเบียนเลย
 */
export function CustomerPicker({ value, onChange, disabled }: { value: Customer | null; onChange: (customer: Customer | null) => void; disabled?: boolean }) {
  const id = useId();
  const [all, setAll] = useState<Customer[] | null>(null);
  const [term, setTerm] = useState('');
  const [message, setMessage] = useState<Message | null>(null);

  useEffect(() => {
    let live = true;
    cache ??= api<Customer[]>('/orders/customers');
    cache.then((rows) => { if (live) setAll(rows); }).catch((e) => {
      cache = null;
      if (live) setMessage({ kind: 'error', text: `โหลดรายชื่อผู้สั่งไม่สำเร็จ (${e instanceof Error ? e.message : String(e)}) ลองเปิดหน้านี้ใหม่` });
    });
    return () => { live = false; };
  }, []);

  // บูธที่มีบริษัทอยู่ในทะเบียนจริง เรียงตามเลขบูธ
  const booths = useMemo(() => {
    if (!all) return [];
    const byCode = new Map(all.map((c) => [c.code, c]));
    return EVENT_BOOTHS.flatMap((b) => { const c = byCode.get(b.customerCode); return c ? [{ booth: b.booth, c }] : []; });
  }, [all]);

  const index = useMemo(() => all?.map((c) => ({ c, booth: boothOf(c.code), code: fold(c.code), text: fold(`${c.code} ${c.name}`) })) ?? null, [all]);
  const matches = useMemo(() => {
    const q = fold(term);
    if (!index || !q) return [];
    const boothNo = /^\d{1,2}$/.test(q) ? Number(q) : null;
    // เลขบูธตรงตัวขึ้นก่อน แล้วรหัสตรงตัว รหัสขึ้นต้นด้วยคำค้น บริษัทในงาน แล้วที่เหลือ
    return index
      .filter((x) => x.text.includes(q) || (boothNo !== null && x.booth === boothNo))
      .sort((a, b) =>
        Number(b.booth === boothNo) - Number(a.booth === boothNo)
        || Number(b.code === q) - Number(a.code === q)
        || Number(b.code.startsWith(q)) - Number(a.code.startsWith(q))
        || Number(!!b.booth) - Number(!!a.booth)
        || (a.booth ?? 99) - (b.booth ?? 99))
      .map((x) => x.c);
  }, [index, term]);

  if (value) {
    const booth = boothOf(value.code);
    return (
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">ผู้สั่ง *</span>
        <div className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border-2 border-star bg-star-soft px-3 py-2">
          {booth ? <BoothTag booth={booth} /> : <Building2Icon className="size-5 shrink-0 text-star-ink" aria-hidden />}
          <div className="min-w-40 flex-1">
            <p className="font-semibold break-words">{value.name}</p>
            <p className="font-mono text-sm text-muted-foreground">{value.code}</p>
          </div>
          <Button type="button" variant="ghost" size="touch" className="-mr-2 ml-auto px-3" disabled={disabled} onClick={() => { onChange(null); setTerm(''); }}>
            <XIcon />เปลี่ยนผู้สั่ง
          </Button>
        </div>
      </div>
    );
  }

  const row = (c: Customer, booth: number | undefined, showProducts: boolean) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(c)}
      className="flex min-h-12 w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none hover:bg-secondary active:bg-star-soft focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {booth ? <BoothTag booth={booth} /> : <span className="w-16 shrink-0 truncate text-center font-mono text-sm text-muted-foreground">{c.code}</span>}
      <span className="min-w-0 flex-1 break-words">{c.name}</span>
      {showProducts && <span className={c.products ? 'shrink-0 text-sm text-muted-foreground tabular-nums' : 'shrink-0 text-sm text-destructive'}>{c.products ? `${c.products.toLocaleString('th-TH')} สินค้า` : 'ไม่มีสินค้าในทะเบียน'}</span>}
    </button>
  );

  return (
    <div className="grid gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium">ผู้สั่ง *</span>
      {/* มือถือ: เลือกบูธจากเมนูของเครื่อง ช่องเดียว ไม่ดันฟอร์มลงไป 23 แถว (จอกว้างใช้รายการ 2 คอลัมน์ข้างล่าง) */}
      {booths.length > 0 && (
        <div className="grid gap-1.5 sm:hidden">
          <NativeSelect size="touch" className="w-full" aria-label="เลือกบูธ" aria-describedby={`${id}-label`} value="" disabled={disabled}
            onChange={(e) => { const hit = booths.find((b) => b.c.code === e.target.value); if (hit) onChange(hit.c); }}>
            <NativeSelectOption value="">เลือกบูธ 1–{booths[booths.length - 1].booth}</NativeSelectOption>
            {booths.map(({ booth, c }) => <NativeSelectOption key={c.code} value={c.code}>บูธ {booth} · {c.name.replace(/^บริษัท\s*/, '')}</NativeSelectOption>)}
          </NativeSelect>
        </div>
      )}
      {/* เลือกได้เฉพาะบูธในงาน ช่องค้นทั้งทะเบียนใช้สำรองเมื่อไม่มีบริษัทของบูธในทะเบียนเลย */}
      {all && booths.length === 0 && <Input
        id={`${id}-q`}
        aria-labelledby={`${id}-label`}
        className={touchInput}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (matches.length === 1 || (matches[0] && boothOf(matches[0].code) === Number(fold(term)))) onChange(matches[0]); } }}
        placeholder="พิมพ์รหัสหรือชื่อบริษัท"
        disabled={disabled || !all}
        autoComplete="off"
        aria-describedby={`${id}-hint`}
      />}
      <p id={`${id}-hint`} className="text-sm text-muted-foreground empty:hidden" aria-live="polite">
        {!all ? <span className="inline-flex items-center gap-1"><LoaderCircleIcon className="size-4 animate-spin" aria-hidden />กำลังโหลดรายชื่อผู้สั่ง…</span>
          : !term.trim() ? (booths.length ? <span className="hidden sm:inline">แตะเลือกบูธ</span> : null)
          : matches.length ? `พบ ${matches.length} ราย${matches.length > SHOW ? ` แสดง ${SHOW} รายแรก พิมพ์เพิ่มเพื่อจำกัดผลการค้นหา` : ''}`
          : 'ไม่พบผู้สั่งที่ตรงกับคำค้น ลองพิมพ์เลขบูธ รหัส หรือชื่อสั้นลง'}
      </p>
      {/* ยังไม่พิมพ์: บูธในงานเรียง 1–23 จอกว้างเรียงเป็น 2 คอลัมน์ไล่ลงตามเลข */}
      {!term.trim() && booths.length > 0 && (
        <ul aria-label="บูธในงาน" className="hidden gap-0.5 rounded-xl border border-border p-1 sm:grid sm:grid-flow-col sm:grid-cols-2"
          style={{ gridTemplateRows: `repeat(${Math.ceil(booths.length / 2)}, auto)` }}>
          {booths.map(({ booth, c }) => <li key={c.code} className="min-w-0">{row(c, booth, false)}</li>)}
        </ul>
      )}
      {matches.length > 0 && (
        <ul className="grid gap-1 rounded-xl border border-border p-1" aria-label="ผลค้นผู้สั่ง">
          {matches.slice(0, SHOW).map((c) => <li key={c.code}>{row(c, boothOf(c.code), true)}</li>)}
        </ul>
      )}
      <Notice message={message} />
    </div>
  );
}
