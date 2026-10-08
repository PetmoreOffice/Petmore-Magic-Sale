import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, CheckIcon, LoaderCircleIcon, PrinterIcon, SearchIcon, TagIcon, XIcon } from 'lucide-react';
import { cn } from 'cn';
import type { Location, StorageWorkspace } from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { LabelBatchInfo, LocationLabel } from '@/components/LocationLabel';
import { Field, Message, Notice } from '@/components/wms';
import { touchInput } from '@/lib/touch';
import { api, formatTime, newRequestId } from '../api';

const PER_PAGE = 3;
const MAX_LABELS = 300;

interface PreparedBatch extends LabelBatchInfo {
  labels: Location[];
}

/** แบ่งป้ายเป็นหน้า A4 หน้าละ 3 ป้าย */
function chunk<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

export function LabelsPage() {
  const [workspace, setWorkspace] = useState<StorageWorkspace | null>(null);
  const [warehouse, setWarehouse] = useState('');
  const [zoneId, setZoneId] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<Message | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [batch, setBatch] = useState<PreparedBatch | null>(null);
  const attempt = useRef<{ key: string; requestId: string } | null>(null);

  useEffect(() => {
    api<StorageWorkspace>('/storage')
      .then((w) => {
        setWorkspace(w);
        if (w.warehouses.length === 1) setWarehouse(w.warehouses[0].code);
      })
      .catch((e: Error) => setMessage({ text: e.message, kind: 'error' }));
  }, []);

  const zoneNames = useMemo(() => new Map(workspace?.zones.map((z) => [z.id, z.name ? `${z.code} · ${z.name}` : z.code]) ?? []), [workspace]);
  const zones = useMemo(() => workspace?.zones.filter((z) => z.warehouse === warehouse) ?? [], [workspace, warehouse]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (workspace?.locations ?? []).filter(
      (l) =>
        l.warehouse === warehouse &&
        (!zoneId || l.zoneId === zoneId) &&
        (!q || [l.displayCode, l.name, zoneNames.get(l.zoneId) ?? ''].join(' ').toLowerCase().includes(q)),
    );
  }, [workspace, warehouse, zoneId, query, zoneNames]);
  const printable = visible.filter((l) => l.active);
  const allVisibleSelected = printable.length > 0 && printable.every((l) => selected.has(l.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_LABELS) next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) printable.forEach((l) => next.delete(l.id));
      else for (const l of printable) if (next.size < MAX_LABELS) next.add(l.id);
      return next;
    });
  }

  async function prepare() {
    if (!selected.size) return;
    // เลือกชุดเดิมใช้ requestId เดิม กดซ้ำได้ชุดเดิม ไม่สร้างประวัติซ้ำ
    const ids = (workspace?.locations ?? []).filter((l) => selected.has(l.id)).map((l) => l.id);
    const key = ids.join(',');
    if (!attempt.current || attempt.current.key !== key) attempt.current = { key, requestId: newRequestId() };
    setPreparing(true);
    setMessage(null);
    try {
      const r = await api<PreparedBatch>('/storage/labels/prepare', {
        method: 'POST',
        body: { requestId: attempt.current.requestId, locationIds: ids },
      });
      setBatch(r);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), kind: 'error' });
    } finally {
      setPreparing(false);
    }
  }

  if (batch) {
    const pages = chunk(batch.labels, PER_PAGE);
    return (
      <div className="grid gap-4">
        <Card className="print:hidden">
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              พร้อมพิมพ์ {batch.labels.length.toLocaleString('th-TH')} ป้าย
            </CardTitle>
            <CardDescription>
              กระดาษ A4 หน้าละ {PER_PAGE} ป้าย · {pages.length.toLocaleString('th-TH')} หน้า · ชุด {batch.id.slice(-8)} · {formatTime(batch.time)}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              ในหน้าต่างพิมพ์ ให้ตั้งขนาดกระดาษ A4, สเกล 100% และไม่เลือก "ส่วนหัวและส่วนท้าย" ป้ายจะได้ขนาดจริงและไม่มีชื่อเว็บติดบนกระดาษ
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button size="touch" onClick={() => window.print()}>
                <PrinterIcon />
                พิมพ์ป้าย
              </Button>
              <Button size="touch" variant="secondary" onClick={() => setBatch(null)}>
                <ArrowLeftIcon />
                กลับไปเลือก Location
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ชุดเดียวกันใช้ทั้งดูตัวอย่างบนจอและพิมพ์ */}
        <div className="label-sheet grid gap-6 print:gap-0">
          {pages.map((page, i) => (
            <section key={i} className="label-page grid gap-3" aria-label={`หน้า ${i + 1}`}>
              <p className="text-xs text-muted-foreground print:hidden">
                หน้า {i + 1} / {pages.length}
              </p>
              {page.map((l) => (
                <LocationLabel key={l.id} location={l} zoneName={zoneNames.get(l.zoneId)} batch={batch} />
              ))}
            </section>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-4 pb-24">
      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            เลือก Location ที่จะพิมพ์ป้าย
          </CardTitle>
          <CardDescription>ป้ายมี QR และบาร์โค้ด Code128 ของ Location สแกนได้ทั้ง Handheld และกล้องมือถือ</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <Field id="lb-warehouse" label="คลัง">
            <NativeSelect
              id="lb-warehouse"
              size="touch"
              className="w-full"
              value={warehouse}
              onChange={(e) => {
                setWarehouse(e.target.value);
                setZoneId('');
              }}
            >
              <NativeSelectOption value="">เลือกคลัง</NativeSelectOption>
              {workspace?.warehouses.map((w) => (
                <NativeSelectOption key={w.code} value={w.code}>
                  {w.code} — {w.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field id="lb-zone" label="โซน">
            <NativeSelect id="lb-zone" size="touch" className="w-full" value={zoneId} onChange={(e) => setZoneId(e.target.value)} disabled={!warehouse}>
              <NativeSelectOption value="">ทุกโซน</NativeSelectOption>
              {zones.map((z) => (
                <NativeSelectOption key={z.id} value={z.id}>
                  {z.code} — {z.name}
                  {z.active ? '' : ' (ปิดใช้งาน)'}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field id="lb-search" label="ค้นหา Location" className="sm:col-span-2">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                id="lb-search"
                className={cn(touchInput, 'pl-10')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="เช่น A-01 หรือชื่อชั้นวาง"
                disabled={!warehouse}
              />
            </div>
          </Field>
          <div className="sm:col-span-2">
            <Notice message={message} />
          </div>
        </CardContent>
      </Card>

      {!workspace && !message && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          กำลังโหลดโซนและ Location…
        </p>
      )}

      {workspace && !warehouse && (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">เลือกคลังด้านบนก่อน แล้วจะแสดง Location ของคลังนั้นให้เลือกพิมพ์ป้าย</p>
      )}

      {workspace && warehouse && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle role="heading" aria-level={2}>
                Location ({visible.length.toLocaleString('th-TH')})
              </CardTitle>
              <CardDescription>แตะแถวเพื่อเลือก · พิมพ์ได้สูงสุด {MAX_LABELS} ป้ายต่อชุด</CardDescription>
            </div>
            <Button variant="outline" size="touch" className="shrink-0 px-3" onClick={toggleAllVisible} disabled={!printable.length}>
              {allVisibleSelected ? <XIcon /> : <CheckIcon />}
              {allVisibleSelected ? 'ยกเลิกที่เลือก' : 'เลือกทั้งหมด'}
            </Button>
          </CardHeader>
          <CardContent>
            {!visible.length && (
              <p className="text-sm text-muted-foreground">
                {query || zoneId ? 'ไม่พบ Location ที่ตรงกับคำค้นหรือโซนที่เลือก ลองเปลี่ยนคำค้นหรือเลือก "ทุกโซน"' : 'คลังนี้ยังไม่มี Location สร้างโซนและ Location ก่อน แล้วจึงพิมพ์ป้าย'}
              </p>
            )}
            <ul className="grid gap-2">
              {visible.map((l) => {
                const on = selected.has(l.id);
                return (
                  <li key={l.id}>
                    <label
                      className={cn(
                        'flex min-h-14 items-center gap-3 rounded-xl border-2 px-3 py-2 transition-colors',
                        !l.active && 'cursor-not-allowed opacity-60',
                        l.active && 'cursor-pointer',
                        on ? 'border-star bg-star-soft' : 'border-border bg-card hover:bg-secondary',
                      )}
                    >
                      <input
                        type="checkbox"
                        className="size-5 shrink-0"
                        checked={on}
                        disabled={!l.active}
                        onChange={() => toggle(l.id)}
                      />
                      <span className="grid min-w-0 flex-1">
                        <span className="font-heading text-lg font-semibold">{l.displayCode}</span>
                        <span className="truncate text-sm text-muted-foreground">
                          {[zoneNames.get(l.zoneId), l.name, !l.active && 'ปิดใช้งาน พิมพ์ไม่ได้']
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                      <TagIcon className={cn('size-5 shrink-0', on ? 'text-star-ink' : 'text-muted-foreground/50')} aria-hidden="true" />
                    </label>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* แถบล่างติดขอบจอ: เห็นจำนวนที่เลือกและปุ่มเตรียมป้ายตลอด ไม่ต้องเลื่อนกลับขึ้นไป */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <p className="min-w-0 flex-1 text-sm" aria-live="polite">
            เลือกแล้ว <strong className="font-heading text-lg tabular-nums">{selected.size.toLocaleString('th-TH')}</strong> ป้าย
            {selected.size > 0 && (
              <span className="text-muted-foreground"> · {Math.ceil(selected.size / PER_PAGE).toLocaleString('th-TH')} หน้า A4</span>
            )}
          </p>
          <Button size="touch" onClick={() => void prepare()} disabled={!selected.size || preparing}>
            {preparing ? <LoaderCircleIcon className="animate-spin" /> : <PrinterIcon />}
            {preparing ? 'กำลังเตรียมป้าย…' : 'ดูตัวอย่างป้าย'}
          </Button>
        </div>
      </div>
    </div>
  );
}
