import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, CheckIcon, ChevronRightIcon, HandIcon, LoaderCircleIcon, LockIcon, PackageCheckIcon, PrinterIcon, RotateCcwIcon, SparklesIcon, Undo2Icon } from 'lucide-react';
import { cn } from 'cn';
import { type OrderLine, type Paged, type PrepAction, type PrepCounts, type PrepFilter, type Product, type SalesOrder } from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { MagicStage, Medallion, SlotSparkles, Sparkle, SPELL_SLOT, ToneChip, TONES, unitTone, type Tone } from '@/components/magic';
import SpotlightCard from '@/components/SpotlightCard';
import { BoothName as Booth, Message, Notice, PrepBadge, QtyStepper } from '@/components/wms';
import { ScanInput, type ScanInputHandle } from '@/components/ScanInput';
import { OrderReceipt } from '@/components/OrderReceipt';
import { lineCode, sortBySkuCode } from '@/lib/doc-lines';
import { formatQty } from '@/lib/packs';
import { scrollToStart } from '@/lib/touch';
import { api, ApiError } from '../api';
import { useAuth } from '../auth';

/** หน้ารายการรีเฟรชเองทุกกี่มิลลิวินาที (เท่าหน้าตรวจของเบิก) */
const LIST_REFRESH_MS = 20_000;
const TABS: { key: PrepFilter; label: string; tone: Tone }[] = [
  { key: 'WAITING', label: 'รอจัด', tone: 'star' },
  { key: 'PREPARING', label: 'กำลังจัด', tone: 'kibble' },
  { key: 'READY', label: 'จัดเสร็จ', tone: 'sky' },
  { key: 'ALL', label: 'ทั้งหมด', tone: 'plum' },
];
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const clockTime = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' });
const bangkokDay = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
/** เวลาสั่งแบบสั้น วันนี้แสดงแค่เวลา วันอื่นมีวัน/เดือน (หัวเวทีบนมือถือไม่ตัดสองบรรทัด) */
const orderedAt = (iso: string) => {
  const d = new Date(iso);
  return bangkokDay(d) === bangkokDay(new Date()) ? clockTime(iso) : `${d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', timeZone: 'Asia/Bangkok' })} ${clockTime(iso)}`;
};
/** ชิ้นต่อหน่วยจากชื่อหน่วย ("PACK x 4 x 12" = 48, "PC" = 1) ใช้เลือกสีป้ายหน่วย */
const unitPieces = (unit: string) => (unit.match(/x\s*\d+/gi) ?? []).reduce((n, m) => n * Number(m.replace(/\D/g, '')), 1);

function BoothName({ order }: { order: SalesOrder }) {
  return <Booth code={order.customerCode} name={order.customerName} />;
}

/**
 * จัดสินค้า (คนจัดสินค้า): คิวออเดอร์มาก่อนจัดก่อน → รับจัด (คนอื่นเห็นว่าใครจัดอยู่ ไม่หยิบซ้ำ)
 * → ใบจัดเรียงตาม SKU_CODE สแกนของที่หยิบ (หัวสแกน/กล้อง) แล้วใส่จำนวน หรือพิมพ์ใบจัด → จัดเสร็จ ส่งตรวจของเบิก
 */
export function PreparePage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<PrepFilter>('WAITING');
  const [counts, setCounts] = useState<PrepCounts | null>(null);
  const [list, setList] = useState<Paged<SalesOrder> | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<'done' | 'takeover' | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [arrived, setArrived] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const background = useRef(false);
  const last = useRef<{ all: number; latest: string } | null>(null);
  const listTop = useRef<HTMLDivElement>(null);
  const scanRef = useRef<ScanInputHandle>(null);
  // รายการที่กำลังใส่จำนวน (หลังสแกน หรือแตะแถว)
  const [entry, setEntry] = useState<{ lineNo: number; value: string } | null>(null);
  const orderRef = useRef(order);
  orderRef.current = order;

  // คิวรีเฟรชเองทุก 20 วินาที เฉพาะตอนดูคิวและหน้าจอเปิดอยู่
  useEffect(() => {
    if (order) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      background.current = true;
      setRefreshTick((n) => n + 1);
    };
    const timer = setInterval(tick, LIST_REFRESH_MS);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, [order]);

  useEffect(() => {
    if (order) return;
    let live = true;
    const silent = background.current;
    background.current = false;
    if (!silent) setLoading(true);
    Promise.all([api<Paged<SalesOrder>>(`/orders/prep?${new URLSearchParams({ status: tab, page: String(page) })}`), api<PrepCounts>('/orders/prep-counts')])
      .then(([rows, c]) => {
        if (!live) return;
        const before = last.current;
        if (silent && before && c.latest > before.latest) setArrived((n) => n + Math.max(1, c.ALL - before.all));
        else if (!silent) setArrived(0);
        last.current = { all: c.ALL, latest: c.latest };
        setList(rows); setCounts(c); setUpdatedAt(new Date());
      })
      .catch((e) => { if (live && !silent) setMessage({ kind: 'error', text: errorText(e) }); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [order, tab, page, refreshTick]);

  async function open(o: SalesOrder) {
    setMessage(null); setConfirm(null); setEntry(null);
    setOrder(o);
    window.scrollTo({ top: 0 });
    // โหลดสถานะล่าสุด (คิวอาจเก่ากว่า 20 วินาที)
    try { setOrder(await api<SalesOrder>(`/orders/${encodeURIComponent(o.id)}`)); } catch (e) { setMessage({ kind: 'error', text: errorText(e) }); }
  }

  async function act(body: PrepAction) {
    if (!order) return;
    setBusy(true); setMessage(null); setConfirm(null);
    try {
      setOrder(await api<SalesOrder>(`/orders/${encodeURIComponent(order.id)}/prep`, { method: 'POST', body }));
      if (body.action === 'done') setMessage({ kind: 'info', text: `จัด ${order.id} เสร็จแล้ว ส่งตรวจของเบิกได้เลย` });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
      // สถานะเปลี่ยนไปแล้ว (เช่น มีคนรับจัดก่อน) โหลดใหม่ให้เห็นความจริง
      api<SalesOrder>(`/orders/${encodeURIComponent(order.id)}`).then(setOrder).catch(() => undefined);
    } finally { setBusy(false); }
  }

  const pickedOf = (o: SalesOrder, l: OrderLine) => o.prep.picked[String(l.lineNo)] ?? 0;

  /** เปิดช่องใส่จำนวนของรายการ ตั้งต้นเป็นจำนวนที่ยังขาด แล้วโฟกัสช่องจำนวน (Handheld พิมพ์เลขแล้ว Enter ได้เลย) */
  function startEntry(l: OrderLine) {
    const o = orderRef.current;
    if (!o) return;
    const remaining = Math.max(0, l.qty - pickedOf(o, l));
    setEntry({ lineNo: l.lineNo, value: String(remaining || l.qty) });
    setConfirm(null);
    setTimeout(() => {
      const el = document.getElementById('prep-qty') as HTMLInputElement | null;
      if (!el) return;
      el.focus({ preventScroll: true }); el.select();
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.closest('form')?.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
    }, 50);
  }

  /** สแกนบาร์โค้ดของที่หยิบ: ตรงบาร์ในออเดอร์ หรือบาร์อื่นของขนาดเดียวกัน แล้วให้ใส่จำนวน */
  async function handleScan(raw: string) {
    const o = orderRef.current;
    const code = raw.trim();
    if (!o || !code) return;
    if (!(o.prep.status === 'PREPARING' && o.prep.byId === user?.id)) return { ok: false, text: 'กด "รับจัดออเดอร์นี้" ก่อนสแกน' };
    const sorted = sortBySkuCode(o.lines);
    const notDone = (ls: OrderLine[]) => ls.find((l) => pickedOf(o, l) < l.qty) ?? ls[0];
    let hit = notDone(sorted.filter((l) => l.packCode === code || (!l.packCode && lineCode(l) === code)));
    if (!hit) {
      let p: Product | null = null;
      try { p = await api<Product>('/products/lookup/' + encodeURIComponent(code)); }
      catch (e) { if (!(e instanceof ApiError && e.status === 404)) return { ok: false, text: errorText(e) }; }
      if (!p) return { ok: false, text: `ไม่พบสินค้ารหัส ${code} ลองสแกนอีกครั้ง หรือแตะรายการเพื่อใส่จำนวนเอง` };
      const product = p;
      const scanned = product.packs?.find((x) => x.code === code);
      const size = (c: string) => { const k = product.packs?.find((x) => x.code === c); return k ? `${k.unitName}|${k.unitQty}` : ''; };
      const sameSku = sorted.filter((l) => l.sku === product.sku);
      // บาร์โค้ดคนละตัวแต่ขนาดเดียวกัน (เช่น บาร์ปกติกับบาร์ L) นับเป็นรายการเดียวกัน
      hit = notDone(sameSku.filter((l) => scanned ? size(l.packCode) === size(scanned.code) : l.packCode === product.sku));
      if (!hit && sameSku.length) return { ok: false, text: `ผิดขนาด! ${scanned?.unitName ?? product.unit} · ออเดอร์สั่งเป็น ${sameSku.map((l) => l.unit).join(', ')}` };
      if (!hit) return { ok: false, text: `ไม่อยู่ในออเดอร์! ${product.name}` };
    }
    startEntry(hit);
    return { ok: true, text: `${hit.name} · สั่ง ${formatQty(hit.qty)} ${hit.unit} ใส่จำนวนที่หยิบได้` };
  }

  async function savePick() {
    const o = orderRef.current;
    if (!o || !entry) return;
    // ยิงสแกนชิ้นถัดไปทั้งที่ยังไม่กดบันทึก: เลขบาร์โค้ดจะลงช่องจำนวน (ยาว 8 ตัวขึ้นไป/มีตัวอักษร) ถือเป็นการสแกนใหม่ ไม่บันทึกเป็นจำนวน
    const typed = entry.value.trim();
    if (/^\d{8,}$/.test(typed) || /[A-Za-z]/.test(typed)) {
      setEntry(null);
      const r = await handleScan(typed);
      if (r && !r.ok) setMessage({ kind: 'error', text: `${r.text ?? 'สแกนไม่สำเร็จ'} (รายการก่อนหน้ายังไม่ได้บันทึกจำนวน)` });
      return;
    }
    const qty = Number(entry.value);
    if (entry.value.trim() === '' || !Number.isFinite(qty) || qty < 0) { setMessage({ kind: 'error', text: 'ใส่จำนวนที่หยิบได้เป็นตัวเลข 0 ขึ้นไป' }); return; }
    setBusy(true); setMessage(null);
    try {
      setOrder(await api<SalesOrder>(`/orders/${encodeURIComponent(o.id)}/prep`, { method: 'POST', body: { action: 'pick', lineNo: entry.lineNo, qty } }));
      setEntry(null);
      setTimeout(() => scanRef.current?.focus(), 50);
    } catch (e) {
      setMessage({ kind: 'error', text: `บันทึกจำนวนไม่สำเร็จ: ${errorText(e)}` });
      api<SalesOrder>(`/orders/${encodeURIComponent(o.id)}`).then(setOrder).catch(() => undefined);
    } finally { setBusy(false); }
  }

  const lines = useMemo(() => (order ? sortBySkuCode(order.lines) : []), [order]);

  // ---------- คิวจัดสินค้า ----------
  if (!order) {
    return (
      <div className="grid gap-4">
        <MagicStage className="grid gap-1">
          <h2 className="font-heading text-2xl font-semibold">คิวจัดสินค้า</h2>
          <p className="pr-20 text-sm text-brand-foreground/80 sm:pr-32">มาก่อนจัดก่อน แตะออเดอร์แล้วกด <span className="whitespace-nowrap">"รับจัด"</span> คนอื่นจะเห็นว่าคุณจัดอยู่</p>
        </MagicStage>
        <Notice message={message} />
        <section ref={listTop} className="grid scroll-mt-20 gap-3" aria-labelledby="prep-list-title">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="prep-list-title" className="font-heading text-xl font-semibold">{TABS.find((t) => t.key === tab)?.label}</h2>
            {updatedAt && <p className="text-xs text-muted-foreground tabular-nums">อัปเดตเองทุก 20 วินาที · ล่าสุด {updatedAt.toLocaleTimeString('th-TH')}</p>}
          </div>
          {arrived > 0 && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 border-star bg-star-soft px-4 py-2">
              <p className="flex items-center gap-2 font-medium"><SparklesIcon className="size-5 text-star-ink dark:text-star" aria-hidden />มีออเดอร์ใหม่เข้าคิว {arrived} รายการ</p>
              <div className="flex gap-1">
                {tab !== 'WAITING' && <Button size="touch" variant="ghost" onClick={() => { setTab('WAITING'); setPage(1); }}>ดูคิวรอจัด</Button>}
                <Button size="touch" variant="ghost" onClick={() => setArrived(0)}>รับทราบ</Button>
              </div>
            </div>
          )}
          <div role="radiogroup" aria-label="สถานะการจัด" className="flex flex-wrap gap-2">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button key={t.key} type="button" role="radio" aria-checked={active} onClick={() => { setTab(t.key); setPage(1); }}
                  className={cn('flex min-h-12 items-center gap-2 rounded-full border-2 px-4 text-sm transition-[border-color,background-color] outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                    active ? 'border-star bg-star-soft font-semibold' : 'border-border bg-card hover:border-star/50')}>
                  {t.label}
                  <span className={cn('grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold tabular-nums', TONES[t.tone])}>{counts ? counts[t.key] : '·'}</span>
                </button>
              );
            })}
          </div>
          {loading && !list ? (
            <div className="grid gap-2 sm:grid-cols-2" aria-hidden>{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/60" />)}</div>
          ) : list && (
            <>
              {!list.rows.length && (
                <div className={`${SPELL_SLOT} grid justify-items-center gap-2 px-4 py-10 text-center`}>
                  <SlotSparkles />
                  <PackageCheckIcon className="size-8 text-star-ink dark:text-star" aria-hidden />
                  <p className="text-muted-foreground">{tab === 'WAITING' ? 'ยังไม่มีออเดอร์รอจัด ออเดอร์ใหม่จะขึ้นที่นี่เอง' : 'ไม่มีออเดอร์ในสถานะนี้'}</p>
                </div>
              )}
              <ul className={cn('grid gap-2 sm:grid-cols-2', loading && 'opacity-60')} aria-busy={loading}>
                {list.rows.map((o, i) => {
                  const tone: Tone = !o.prep.status ? 'star' : o.prep.status === 'PREPARING' ? 'kibble' : 'sky';
                  const ticked = o.lines.filter((l) => (o.prep.picked[String(l.lineNo)] ?? 0) >= l.qty).length;
                  return (
                    <li key={o.id}>
                      <SpotlightCard className="h-full transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-star/60 motion-reduce:hover:translate-y-0">
                        <button type="button" onClick={() => void open(o)} className="relative flex h-full min-h-24 w-full items-center gap-3 p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset">
                          <Medallion tone={tone} icon={PackageCheckIcon} />
                          <span className="grid min-w-0 flex-1 gap-1">
                            <strong className="line-clamp-2 font-medium break-words">
                              {tab === 'WAITING' && page === 1 && i === 0 && <span className={cn('mr-1.5 inline-grid h-5 place-items-center rounded-full px-2 align-[0.1em] text-xs font-bold', TONES.star)}>ถัดไป</span>}
                              <BoothName order={o} />
                            </strong>
                            <span className="text-sm text-muted-foreground tabular-nums">{o.id} · สั่งเมื่อ {clockTime(o.createdAt)} · {o.lines.length} รายการ{o.prep.status === 'PREPARING' && ` · หยิบครบ ${ticked}/${o.lines.length}`}</span>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <PrepBadge prep={o.prep} />
                              {o.prep.status === 'PREPARING' && o.prep.byId !== user?.id && <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><LockIcon className="size-3.5" aria-hidden />จัดซ้อนไม่ได้</span>}
                              {o.prep.status === 'PREPARING' && o.prep.byId === user?.id && <span className="text-xs font-semibold text-star-ink">คุณกำลังจัด</span>}
                            </span>
                          </span>
                          <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                        </button>
                      </SpotlightCard>
                    </li>
                  );
                })}
              </ul>
              {list.pages > 1 && (
                <div className="flex justify-between gap-3">
                  <Button variant="outline" size="touch" disabled={page <= 1} onClick={() => { setPage(page - 1); scrollToStart(listTop.current); }}>หน้าก่อน</Button>
                  <Button variant="outline" size="touch" disabled={page >= list.pages} onClick={() => { setPage(page + 1); scrollToStart(listTop.current); }}>หน้าถัดไป</Button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    );
  }

  // ---------- ใบจัดของออเดอร์ที่เปิด ----------
  const status = order.prep.status;
  const mine = status === 'PREPARING' && order.prep.byId === user?.id;
  const picked = (l: OrderLine) => pickedOf(order, l);
  const left = lines.filter((l) => picked(l) < l.qty).length;
  const canPick = mine && !busy;
  const entryLine = entry ? lines.find((l) => l.lineNo === entry.lineNo) : undefined;

  return (
    <div className={cn('grid gap-4', mine && 'pb-36 lg:pb-0')}>
      {/* จอ: สแกนแล้วใส่จำนวน · กระดาษ: ใบจัดสินค้าแบบเดียวกับหน้าออเดอร์ */}
      <div className="grid gap-4 print:hidden">
        <Button variant="ghost" size="touch" className="-ml-3 justify-self-start" onClick={() => { setOrder(null); setMessage(null); }} disabled={busy}>
          <ArrowLeftIcon />กลับคิวจัดสินค้า
        </Button>
        <MagicStage className="grid gap-3">
          <div className="grid min-w-0 gap-1">
            <p className="pr-16 font-mono text-sm text-brand-foreground/80 sm:pr-32">{order.id} · <span className="whitespace-nowrap">สั่ง {orderedAt(order.createdAt)}</span></p>
            <h2 className="font-heading text-2xl font-semibold break-words"><BoothName order={order} /></h2>
          </div>
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <PrepBadge prep={order.prep} />
            <p className="font-heading text-3xl leading-none font-semibold tabular-nums" aria-label={`หยิบครบแล้ว ${lines.length - left} จาก ${lines.length} รายการ`}>
              <span className={cn(lines.length > 0 && !left && 'text-star')}>{lines.length - left}</span><span className="text-lg text-brand-foreground/70">/{lines.length}</span>
              <span className="ml-1.5 align-middle font-sans text-sm font-normal text-brand-foreground/80">รายการครบ</span>
            </p>
          </div>
          {status === '' && (
            <Button size="touch" className="w-full bg-star text-on-star hover:bg-star/90 sm:w-auto sm:justify-self-start" disabled={busy} onClick={() => void act({ action: 'claim' })}>
              {busy ? <LoaderCircleIcon className="animate-spin" /> : <HandIcon />}รับจัดออเดอร์นี้
            </Button>
          )}
          {status === 'PREPARING' && !mine && (
            <div role="status" className="grid gap-2 rounded-xl bg-on-sky/10 p-3 ring-1 ring-on-sky-kibble/40">
              <p className="flex items-center gap-2 font-semibold"><LockIcon className="size-5 shrink-0 text-on-sky-kibble" aria-hidden /><span>ออเดอร์นี้มีคนรับจัดแล้ว <span className="whitespace-nowrap">จัดซ้อนกันไม่ได้</span></span></p>
              <p className="text-sm text-brand-foreground/85"><b className="whitespace-nowrap">{order.prep.byName}</b> กำลังจัดอยู่ ตั้งแต่ {order.prep.startedAt ? clockTime(order.prep.startedAt) : '-'} · หยิบครบ {lines.length - left}/{lines.length} รายการ ระบบล็อกไว้กันหยิบของซ้ำ</p>
              {confirm === 'takeover' ? (
                <div className="grid gap-2">
                  <p className="text-sm">รับช่วงต่อจาก <b className="whitespace-nowrap">{order.prep.byName}</b>? เครื่องของ <span className="whitespace-nowrap">{order.prep.byName}</span> จะใส่จำนวนหรือกดจัดเสร็จไม่ได้อีก จำนวนที่หยิบไปแล้วยังอยู่</p>
                  <div className="flex flex-wrap gap-2">
                  <Button size="touch" className="bg-star text-on-star hover:bg-star/90" disabled={busy} onClick={() => void act({ action: 'claim', force: true })}>ยืนยัน รับช่วงต่อ</Button>
                  <Button size="touch" variant="ghost" className="text-brand-foreground hover:bg-on-sky/10" onClick={() => setConfirm(null)}>ยกเลิก</Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Button size="touch" variant="outline" className="border-on-sky/30 bg-transparent text-brand-foreground hover:bg-on-sky/10" onClick={() => setConfirm('takeover')}>
                    <HandIcon />รับช่วงต่อ
                  </Button>
                  <span className="text-xs text-brand-foreground/75">ใช้เฉพาะกรณีคนเดิมไม่อยู่แล้ว</span>
                </div>
              )}
            </div>
          )}
        </MagicStage>
        {order.note && (
          <p className="rounded-xl border-2 border-kibble/55 bg-kibble-soft px-3 py-2 text-sm whitespace-pre-wrap break-words">
            <b>หมายเหตุจากผู้สั่ง:</b> {order.note}
          </p>
        )}
        {/* รับจัดแล้ว: สแกนของที่หยิบ (หัวสแกน Handheld หรือกล้อง) แล้วใส่จำนวน */}
        {mine && <ScanInput ref={scanRef} label="สแกนสินค้าที่หยิบ" placeholder="สแกนหรือพิมพ์บาร์โค้ด" hint="สแกนแล้วใส่จำนวนที่หยิบได้ สินค้าไม่มีบาร์โค้ด แตะรายการเพื่อใส่จำนวนเอง" onScan={handleScan} autoFocus />}
        {mine && entry && entryLine && (
          <form noValidate className="grid scroll-mb-4 gap-3 rounded-xl border-2 border-star bg-star-soft/40 p-3" onSubmit={(e) => { e.preventDefault(); void savePick(); }} aria-label={`ใส่จำนวนที่หยิบได้ ${entryLine.name}`}>
            <div className="grid gap-0.5">
              <p className="font-semibold break-words">{entryLine.name}</p>
              <p className="text-sm text-muted-foreground"><span className="font-mono">{entryLine.packCode || lineCode(entryLine)}</span> · สั่ง <b className="text-foreground tabular-nums">{formatQty(entryLine.qty)}</b> {entryLine.unit}{picked(entryLine) > 0 && <> · หยิบไว้แล้ว <b className="text-foreground tabular-nums">{formatQty(picked(entryLine))}</b></>}</p>
            </div>
            <label htmlFor="prep-qty" className="text-sm font-medium">จำนวนที่หยิบได้ ({entryLine.unit})</label>
            <QtyStepper id="prep-qty" label="จำนวนที่หยิบได้" min={0} value={entry.value} onChange={(value) => setEntry({ ...entry, value })} disabled={busy} />
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="touch" className="bg-star text-on-star hover:bg-star/90" disabled={busy}>{busy ? <LoaderCircleIcon className="animate-spin" /> : <CheckIcon />}บันทึกจำนวน</Button>
              <Button type="button" size="touch" variant="ghost" onClick={() => { setEntry(null); scanRef.current?.focus(); }}>ยกเลิก</Button>
            </div>
          </form>
        )}
        <Notice message={message} />

        {/* รายการเรียงตาม SKU_CODE เหมือนใบจัดที่พิมพ์ ครบ = ฟ้า, หยิบได้บางส่วน = คาราเมล แตะแถวเพื่อใส่จำนวนเอง (ต้องรับจัดก่อน) */}
        <ul className="grid gap-2" aria-label="รายการที่ต้องหยิบ">
          {lines.map((l) => {
            const got = picked(l);
            const done = got >= l.qty;
            const partial = got > 0 && !done;
            const editing = entry?.lineNo === l.lineNo;
            return (
              <li key={l.lineNo}>
                <button type="button" disabled={!canPick} onClick={() => startEntry(l)}
                  aria-label={`${l.name} สั่ง ${formatQty(l.qty)} ${l.unit} หยิบแล้ว ${formatQty(got)}${canPick ? ' แตะเพื่อใส่จำนวน' : ''}`}
                  className={cn('flex min-h-16 w-full items-center gap-3 rounded-xl border-2 px-3 py-2 text-left transition-[border-color,background-color] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default',
                    editing ? 'border-star bg-star-soft/40' : done ? 'border-sky/50 bg-sky-soft' : partial ? 'border-kibble/55 bg-kibble-soft/60' : 'border-card-edge bg-card enabled:hover:border-star/60 enabled:active:border-star')}>
                  <span aria-hidden className={cn('grid size-8 shrink-0 place-items-center rounded-full border-2', done ? 'border-sky bg-sky text-background' : partial ? 'border-kibble text-kibble-ink' : 'border-dashed border-muted-foreground/50')}>
                    {done ? <CheckIcon className="size-5 stroke-[3]" /> : partial ? <span className="size-3 rounded-full bg-current" /> : null}
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className={cn('font-medium break-words', done && 'text-muted-foreground')}>{l.name}</span>
                    <span className="font-mono text-xs break-all text-muted-foreground">{l.packCode || lineCode(l) || 'ไม่มีรหัส'}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-heading text-xl font-semibold tabular-nums">
                      <span className={cn(done ? 'text-sky' : partial ? 'text-kibble-ink' : 'text-muted-foreground')}>{formatQty(got)}</span>
                      <span className="text-base text-muted-foreground">/{formatQty(l.qty)}</span>
                    </span>
                    <ToneChip tone={unitTone(unitPieces(l.unit))} className="mt-0.5">{l.unit}</ToneChip>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap gap-2 border-t border-border pt-4">
          {mine && <div className="hidden w-full lg:block">{doneArea(false)}</div>}
          <Button size="touch" variant="outline" onClick={() => window.print()}><PrinterIcon />พิมพ์ใบจัด</Button>
          {mine && <Button size="touch" variant="ghost" disabled={busy} onClick={() => void act({ action: 'release' })}><Undo2Icon />คืนเข้าคิว</Button>}
          {status === 'READY' && !order.lastCheck && <Button size="touch" variant="ghost" disabled={busy} onClick={() => void act({ action: 'reopen' })}><RotateCcwIcon />เปิดจัดใหม่</Button>}
        </div>
      </div>
      {/* แถบล่างบนมือถือ: ความคืบหน้า + จัดเสร็จ (ซ่อนตอนใส่จำนวน กันแป้นพิมพ์ดันมาทับฟอร์ม) */}
      {mine && !entry && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-on-sky/10 bg-brand px-4 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] text-brand-foreground shadow-dock lg:hidden print:hidden">
          <div className="mx-auto grid max-w-3xl gap-2">
            <p className="text-sm" aria-live="polite">
              หยิบครบ <span className={cn('font-heading font-semibold tabular-nums', !left && 'text-on-sky-mint')}>{lines.length - left}/{lines.length}</span> รายการ
              {left > 0 && <> · ยังขาด <span className="font-semibold text-on-sky-kibble tabular-nums">{left}</span></>}
            </p>
            {doneArea(true)}
          </div>
        </div>
      )}
      <div className="hidden print:block"><OrderReceipt order={order} actions={null} /></div>
    </div>
  );

  /** ปุ่มจัดเสร็จ + ยืนยันเมื่อยังหยิบไม่ครบ ใช้ทั้งท้ายรายการ (จอคอม) และแถบล่าง (มือถือ บนพื้นท้องฟ้า) */
  function doneArea(onSky: boolean) {
    if (confirm === 'done') {
      return (
        <div role="alert" className={cn('grid w-full gap-2 rounded-xl p-3', onSky ? 'bg-on-sky/10 ring-1 ring-on-sky-kibble/40' : 'border-2 border-kibble/55 bg-kibble-soft')}>
          <p className="text-sm font-medium">ยังหยิบไม่ครบ {left} รายการ ยืนยันส่งตรวจเลยไหม (ผู้ตรวจจะเห็นว่าขาดตอนตรวจ)</p>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <Button size="touch" className="bg-star text-on-star hover:bg-star/90" disabled={busy} onClick={() => void act({ action: 'done' })}>ยืนยัน จัดเสร็จ</Button>
            <Button size="touch" variant="outline" className={cn(onSky && 'border-on-sky/30 bg-transparent text-brand-foreground hover:bg-on-sky/10 hover:text-brand-foreground')} onClick={() => setConfirm(null)}>กลับไปจัดต่อ</Button>
          </div>
        </div>
      );
    }
    return (
      <Button size="touch" className={cn('bg-star text-on-star hover:bg-star/90', onSky && 'w-full')} disabled={busy} onClick={() => (left ? setConfirm('done') : void act({ action: 'done' }))}>
        {busy ? <LoaderCircleIcon className="animate-spin" /> : <Sparkle className="size-5" />}จัดเสร็จ ส่งตรวจ
      </Button>
    );
  }
}
