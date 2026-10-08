import { useEffect, useRef, useState } from 'react';
import { ArrowRightIcon, CheckCircle2Icon, MapPinIcon, PackageIcon, RotateCcwIcon } from 'lucide-react';
import { cn } from 'cn';
import type { Location, Move, ScanResult, StockRow } from '@petmore/shared';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScanFeedback, ScanInput, ScanInputHandle } from '@/components/ScanInput';
import { SparkBurst, SparkBurstHandle } from '@/components/SparkBurst';
import { Field, Message, Notice, PickTile, QtyBreakdown, StatusBadge } from '@/components/wms';
import { touchInput } from '@/lib/touch';
import { api, formatTime, newRequestId } from '../api';

/** ขั้นตอน: สแกน Location ต้นทาง (หรือสินค้า) → เลือกแถวสต็อก → สแกนปลายทาง → จำนวน → ยืนยัน */
export function MovePage() {
  const [candidates, setCandidates] = useState<StockRow[] | null>(null);
  const [source, setSource] = useState<StockRow | null>(null);
  const [dest, setDest] = useState<Location | null>(null);
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<Message | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<Move | null>(null);
  const attempt = useRef<{ key: string; requestId: string } | null>(null);
  const destRef = useRef<ScanInputHandle>(null);
  const sourceSpark = useRef<SparkBurstHandle>(null);
  const destSpark = useRef<SparkBurstHandle>(null);
  const doneSpark = useRef<SparkBurstHandle>(null);

  // ได้ต้นทางแล้ว ย้ายเคอร์เซอร์ไปช่องปลายทางให้สแกนต่อได้เลย
  useEffect(() => {
    if (!source) return;
    sourceSpark.current?.burst();
    destRef.current?.focus();
  }, [source]);

  useEffect(() => {
    if (done) doneSpark.current?.burst();
  }, [done]);

  function fail(e: unknown) {
    setMessage({ text: e instanceof Error ? e.message : String(e), kind: 'error' });
    navigator.vibrate?.([60, 60, 60]);
  }

  function chooseSource(r: StockRow | null) {
    setSource(r);
    setQty(r ? String(r.qty) : '');
    setDest(null);
  }

  async function scanSource(code: string): Promise<ScanFeedback> {
    setMessage(null);
    try {
      const r = await api<ScanResult>('/scan/' + encodeURIComponent(code));
      const query = r.type === 'location' ? `locationId=${encodeURIComponent(r.location.id)}` : `sku=${encodeURIComponent(r.product.sku)}`;
      const rows = await api<StockRow[]>('/stock?' + query);
      setCandidates(rows);
      chooseSource(rows.length === 1 ? rows[0] : null);
      if (!rows.length) {
        setMessage({ text: 'ไม่พบสต็อกคงเหลือของที่สแกน ลองสแกน Location หรือสินค้าอื่น', kind: 'error' });
        navigator.vibrate?.([60, 60, 60]);
        return { ok: false };
      }
      const what = r.type === 'location' ? `Location ${r.location.displayCode}` : r.product.sku;
      return { ok: true, text: `${what} · ${rows.length} รายการ` };
    } catch (e) {
      fail(e);
      return { ok: false };
    }
  }

  async function scanDest(code: string): Promise<ScanFeedback> {
    setMessage(null);
    try {
      const r = await api<ScanResult>('/scan/' + encodeURIComponent(code));
      if (r.type !== 'location') throw new Error('ปลายทางต้องเป็น Location สแกนป้าย Location แทนบาร์โค้ดสินค้า');
      if (!source) throw new Error('เลือกต้นทางก่อน แล้วสแกนปลายทาง');
      if (r.location.warehouse !== source.warehouse) throw new Error(`Location ${r.location.displayCode} อยู่คลัง ${r.location.warehouse} ปลายทางต้องอยู่คลัง ${source.warehouse}`);
      if (r.location.id === source.locationId) throw new Error('Location นี้คือต้นทาง สแกน Location ปลายทางอื่น');
      if (!r.location.active) throw new Error(`Location ${r.location.displayCode} ปิดใช้งานอยู่ สแกน Location อื่น`);
      setDest(r.location);
      destSpark.current?.burst();
      return { ok: true, text: `Location ${r.location.displayCode}` };
    } catch (e) {
      fail(e);
      return { ok: false };
    }
  }

  function openConfirm() {
    if (!source || !dest) return;
    const n = Number(qty);
    if (!Number.isFinite(n) || n <= 0 || n > source.qty) {
      return setMessage({ text: `กรอกจำนวนมากกว่า 0 และไม่เกิน ${source.qty.toLocaleString('th-TH')} ${source.unit}`, kind: 'error' });
    }
    setMessage(null);
    setConfirmOpen(true);
  }

  async function save() {
    if (!source || !dest) return;
    const body = { sourceId: source.id, destinationId: dest.id, qty: Number(qty), note };
    // ข้อมูลชุดเดิมใช้ requestId เดิม ถ้าเน็ตหลุดแล้วกดซ้ำ เซิร์ฟเวอร์จะไม่ย้ายซ้ำ
    const key = JSON.stringify(body);
    if (!attempt.current || attempt.current.key !== key) attempt.current = { key, requestId: newRequestId() };
    setSaving(true);
    try {
      const r = await api<Move>('/moves', { method: 'POST', body: { ...body, requestId: attempt.current.requestId } });
      setConfirmOpen(false);
      setDone(r);
    } catch (e) {
      setConfirmOpen(false);
      fail(e);
    } finally {
      setSaving(false);
    }
  }

  function reset() {
    setCandidates(null);
    chooseSource(null);
    setNote('');
    setDone(null);
    setMessage(null);
    attempt.current = null;
  }

  if (done) {
    return (
      <div className="grid gap-4">
        <Card className="relative overflow-visible">
          <SparkBurst ref={doneSpark} count={16} reach={30} />
          <CardHeader>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-mint">
              <CheckCircle2Icon className="size-4" aria-hidden="true" />
              ย้ายแล้ว สต็อกอัปเดตแล้ว
            </span>
            <CardTitle role="heading" aria-level={2} className="text-2xl">
              {done.id}
            </CardTitle>
            <CardDescription>
              {formatTime(done.createdAt)} · {done.actor}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <div>
              <span className="font-semibold">{done.sku}</span> <span className="text-muted-foreground">{done.name}</span>
            </div>
            <div className="flex flex-wrap items-center gap-3 font-heading text-2xl font-semibold">
              <span>{done.fromCode}</span>
              <ArrowRightIcon className="size-6 text-star-ink" aria-label="ไปที่" />
              <span>{done.toCode}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground tabular-nums">
                {done.qty.toLocaleString('th-TH')} {done.unit}
              </span>
              <span>ล็อต {done.lot || '—'}</span>
              <StatusBadge status={done.status} />
            </div>
          </CardContent>
        </Card>
        <Button size="touch" className="w-full" onClick={reset}>
          <RotateCcwIcon />
          ย้ายรายการถัดไป
        </Button>
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      {/* แต่ละขั้นเป็น section มีหัวข้อ เวทีสแกนไม่อยู่ซ้อนในการ์ด */}
      <section aria-labelledby="mv-source-title" className="grid gap-3">
        <div className="grid gap-0.5">
          <h2 id="mv-source-title" className="font-heading text-lg font-semibold">
            ต้นทาง
          </h2>
          <p className="text-sm text-muted-foreground">สแกนสินค้าจะแสดงทุก Location ที่มีสินค้านั้น</p>
        </div>
          <ScanInput label="สแกน Location ต้นทาง หรือสินค้า" onScan={scanSource} autoFocus />
          {candidates && candidates.length > 1 && (
            <div className="grid gap-2" role="radiogroup" aria-label="เลือกสต็อกต้นทาง">
              <p className="text-sm text-muted-foreground">พบ {candidates.length} รายการ เลือกรายการที่จะย้าย</p>
              {candidates.map((r) => {
                const selected = source?.id === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    data-slot="choice"
                    aria-checked={selected}
                    onClick={() => chooseSource(r)}
                    className={cn(
                      'grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 rounded-xl border-2 px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                      selected ? 'border-star bg-star-soft' : 'border-border bg-card hover:bg-secondary',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="font-semibold">{r.sku}</span> <span className="text-muted-foreground">{r.name}</span>
                    </span>
                    <span className="row-span-2 font-heading text-lg font-semibold tabular-nums">
                      {r.qty.toLocaleString('th-TH')} <span className="text-sm font-normal text-muted-foreground">{r.unit}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <span>{r.locationCode}</span>
                      <span>ล็อต {r.lot || '—'}</span>
                      <span>หมดอายุ {r.expiry || '—'}</span>
                      <StatusBadge status={r.status} />
                    </span>
                    <QtyBreakdown qty={r.qty} unit={r.unit} unitQty={r.unitQty} sizes={r.sizes} className="col-span-2" />
                  </button>
                );
              })}
            </div>
          )}
          <PickTile
            icon={<PackageIcon className="size-5" />}
            label="ต้นทางที่เลือก"
            value={source ? `${source.sku} @ ${source.locationCode}` : undefined}
            emptyText="ยังไม่ได้เลือก"
            detail={source ? `คงเหลือ ${source.qty.toLocaleString('th-TH')} ${source.unit} · ล็อต ${source.lot || '—'} · ${source.status}` : undefined}
            sparkRef={sourceSpark}
          />
      </section>

      <section aria-labelledby="mv-dest-title" className="grid gap-3">
        <div className="grid gap-0.5">
          <h2 id="mv-dest-title" className="font-heading text-lg font-semibold">
            ปลายทาง
          </h2>
          <p className="text-sm text-muted-foreground">ต้องอยู่คลังเดียวกับต้นทาง</p>
        </div>
          <ScanInput
            ref={destRef}
            label="สแกน Location ปลายทาง"
            onScan={scanDest}
            disabled={!source}
            hint={source ? 'สแกนป้าย Location ที่จะวางสินค้า' : 'เลือกต้นทางก่อน แล้วสแกนปลายทาง'}
          />
          <PickTile
            icon={<MapPinIcon className="size-5" />}
            label="ปลายทาง"
            value={dest?.displayCode}
            detail={dest ? `คลัง ${dest.warehouse}` : undefined}
            sparkRef={destSpark}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field id="mv-qty" label={source ? `จำนวนที่ย้าย (สูงสุด ${source.qty.toLocaleString('th-TH')} ${source.unit})` : 'จำนวนที่ย้าย'}>
              <Input
                id="mv-qty"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                className={cn(touchInput, 'tabular-nums')}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                disabled={!source}
              />
            </Field>
            <Field id="mv-note" label="หมายเหตุ (ถ้ามี)">
              <Input id="mv-note" className={touchInput} value={note} onChange={(e) => setNote(e.target.value)} disabled={!source} />
            </Field>
          </div>
          <Notice message={message} />
          <Button size="touch" className="w-full" onClick={openConfirm} disabled={!source || !dest || saving}>
            <ArrowRightIcon />
            ย้ายสินค้า
          </Button>
      </section>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !saving && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันย้ายสินค้า</AlertDialogTitle>
            <AlertDialogDescription>
              {source && dest
                ? `${source.sku} จำนวน ${Number(qty).toLocaleString('th-TH')} ${source.unit} จาก ${source.locationCode} ไป ${dest.displayCode} ยอดสต็อกเปลี่ยนทันทีที่ยืนยัน`
                : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel size="touch" disabled={saving}>
              กลับไปแก้
            </AlertDialogCancel>
            <AlertDialogAction
              size="touch"
              disabled={saving}
              onClick={(e) => {
                // ปิดหน้าต่างเองหลังบันทึกเสร็จ ไม่ปิดทันทีที่กด
                e.preventDefault();
                void save();
              }}
            >
              {saving ? 'กำลังย้าย…' : 'ย้ายสินค้า'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
