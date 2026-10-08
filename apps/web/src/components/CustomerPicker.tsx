import { useEffect, useId, useMemo, useState } from 'react';
import { Building2Icon, LoaderCircleIcon, XIcon } from 'lucide-react';
import { searchKey as fold, type Customer } from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Message, Notice } from '@/components/wms';
import { touchInput } from '@/lib/touch';
import { api } from '../api';

const SHOW = 8;
// โหลดครั้งเดียวต่อการเปิดแอป รายชื่อมีแค่ ~256 ราย และเปลี่ยนตามรอบ sync เท่านั้น
let cache: Promise<Customer[]> | null = null;

/**
 * เลือกผู้สั่งจากทะเบียน dbo.ICCAT (บริษัทคู่ค้า) พิมพ์รหัสหรือชื่อบางส่วนแล้วแตะเลือก
 * ไม่ให้พิมพ์ชื่อเอง เพื่อให้ออเดอร์ผูกกับรหัสในระบบบริษัทเสมอ
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

  const index = useMemo(() => all?.map((c) => ({ c, code: fold(c.code), text: fold(`${c.code} ${c.name}`) })) ?? null, [all]);
  const matches = useMemo(() => {
    const q = fold(term);
    if (!index || !q) return [];
    // รหัสตรงตัวขึ้นก่อน แล้วตามด้วยรหัส/ชื่อที่มีคำค้น
    return index
      .filter((x) => x.text.includes(q))
      .sort((a, b) => Number(b.code === q) - Number(a.code === q) || Number(b.code.startsWith(q)) - Number(a.code.startsWith(q)))
      .map((x) => x.c);
  }, [index, term]);

  if (value) {
    return (
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">ผู้สั่ง *</span>
        <div className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-star bg-star-soft px-3 py-2">
          <Building2Icon className="size-5 shrink-0 text-star-ink" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="font-semibold break-words">{value.name}</p>
            <p className="font-mono text-sm text-muted-foreground">{value.code}</p>
          </div>
          <Button type="button" variant="ghost" size="touch" className="-mr-2 px-3" disabled={disabled} onClick={() => { onChange(null); setTerm(''); }}>
            <XIcon />เปลี่ยนผู้สั่ง
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-1.5">
      <label htmlFor={`${id}-q`} className="text-sm font-medium">ผู้สั่ง *</label>
      <Input
        id={`${id}-q`}
        className={touchInput}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (matches.length === 1) onChange(matches[0]); } }}
        placeholder={all ? `พิมพ์รหัสหรือชื่อบริษัท (${all.length} ราย)` : 'พิมพ์รหัสหรือชื่อบริษัท'}
        disabled={disabled || !all}
        autoComplete="off"
        aria-describedby={`${id}-hint`}
      />
      {/* ว่างไว้ตอนยังไม่พิมพ์ จะขึ้นข้อความเฉพาะตอนโหลดหรือมีผลค้น */}
      <p id={`${id}-hint`} className="text-sm text-muted-foreground empty:hidden" aria-live="polite">
        {!all ? <span className="inline-flex items-center gap-1"><LoaderCircleIcon className="size-4 animate-spin" aria-hidden />กำลังโหลดรายชื่อผู้สั่ง…</span>
          : !term.trim() ? null
          : matches.length ? `พบ ${matches.length} ราย${matches.length > SHOW ? ` แสดง ${SHOW} รายแรก พิมพ์เพิ่มเพื่อให้แคบลง` : ''}`
          : 'ไม่พบผู้สั่งที่ตรงกับคำค้น ลองพิมพ์รหัสหรือชื่อสั้นลง'}
      </p>
      {matches.length > 0 && (
        <ul className="grid gap-1 rounded-xl border border-border p-1" aria-label="ผลค้นผู้สั่ง">
          {matches.slice(0, SHOW).map((c) => (
            <li key={c.code}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onChange(c)}
                className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <span className="w-24 shrink-0 truncate font-mono text-sm text-muted-foreground">{c.code}</span>
                <span className="min-w-0 flex-1 break-words">{c.name}</span>
                <span className={c.products ? 'shrink-0 text-sm text-muted-foreground tabular-nums' : 'shrink-0 text-sm text-destructive'}>{c.products ? `${c.products.toLocaleString('th-TH')} สินค้า` : 'ไม่มีสินค้าในทะเบียน'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Notice message={message} />
    </div>
  );
}
