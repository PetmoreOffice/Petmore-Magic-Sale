import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, HandIcon, LoaderCircleIcon, LockIcon, MinusIcon, PackageCheckIcon, PencilIcon, PlusIcon, PrinterIcon, RefreshCcwIcon, RotateCcwIcon, SparklesIcon, StarIcon, Trash2Icon, Undo2Icon } from 'lucide-react';
import { cn } from 'cn';
import { type OrderLine, type Paged, type PrepAction, type PrepCounts, type PrepFilter, type Product, type SalesOrder } from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { MagicStage, Medallion, SlotSparkles, Sparkle, SPELL_SLOT, ToneChip, TONES, unitTone, type Tone } from '@/components/magic';
import SpotlightCard from '@/components/SpotlightCard';
import StarBorder from '@/components/StarBorder';
import { BoothName as Booth, Message, Notice, PrepBadge } from '@/components/wms';
import { ScanInput, type ScanFeedback, type ScanInputHandle } from '@/components/ScanInput';
import { OrderReceipt } from '@/components/OrderReceipt';
import { lineCode, sortBySkuCode } from '@/lib/doc-lines';
import { formatQty } from '@/lib/packs';
import { prepProgress, type PrepProgress } from '@/lib/prep';
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

const progressOf = prepProgress;
/** จำนวนที่ให้ขนาดนั้นแทนไว้แล้ว */
const partQty = (pr: PrepProgress, code: string) => pr.parts.find((x) => x.packCode === code)?.qty ?? 0;

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
  // รายการที่เพิ่งบันทึก (กรอบทองให้เห็นว่าสแกนเข้าแถวไหน)
  const [lastLine, setLastLine] = useState<number | null>(null);
  // คิวบันทึกจำนวน ส่งทีละคำขอ (ดู setPicked)
  const writes = useRef<Promise<void>>(Promise.resolve());
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
    setMessage(null); setConfirm(null); setLastLine(null);
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

  /**
   * บันทึกยอดที่หยิบของรายการ (ยอดรวมของขนาดนั้น ไม่ใช่บวกเพิ่ม) ส่งทีละคำขอตามลำดับ
   * สแกนรัวหรือกด −/+ รัวจึงคิดจากยอดล่าสุดที่เซิร์ฟเวอร์ตอบเสมอ ไม่ทับกัน
   */
  function setPicked(line: OrderLine, next: (pr: PrepProgress) => number, packCode?: string): Promise<SalesOrder | null> {
    const run = async () => {
      const o = orderRef.current;
      if (!o) return null;
      const qty = Math.max(0, Math.round(next(progressOf(o, line)) * 1000) / 1000);
      try {
        const saved = await api<SalesOrder>(`/orders/${encodeURIComponent(o.id)}/prep`, { method: 'POST', body: { action: 'pick', lineNo: line.lineNo, qty, packCode } });
        orderRef.current = saved;
        setOrder(saved); setLastLine(line.lineNo); setConfirm(null); setMessage(null);
        return saved;
      } catch (e) {
        setMessage({ kind: 'error', text: `บันทึกจำนวนไม่สำเร็จ: ${errorText(e)}` });
        // สถานะเปลี่ยนไปแล้ว (เช่น มีคนรับช่วงต่อ) โหลดใหม่ให้เห็นความจริง
        api<SalesOrder>(`/orders/${encodeURIComponent(o.id)}`).then((x) => { orderRef.current = x; setOrder(x); }).catch(() => undefined);
        return null;
      }
    };
    const job = writes.current.then(run);
    writes.current = job.then(() => undefined);
    return job;
  }

  /** ผลสแกนบนเวที: ยอดหลังบันทึก หยิบเกินยอดสั่ง = สั่น + แดง (เหมือนหน้าตรวจ) */
  function feedback(saved: SalesOrder | null, l: OrderLine, prefix = ''): ScanFeedback {
    if (!saved) return { ok: false, text: 'บันทึกไม่สำเร็จ ลองสแกนอีกครั้ง' };
    const pr = progressOf(saved, l);
    const text = `${prefix}${l.name} ${formatQty(pr.got)}/${formatQty(pr.need)} ${pr.pieces ? 'ชิ้น' : l.unit}`;
    if (pr.diff > 0) {
      navigator.vibrate?.([60, 60, 60]);
      return { ok: false, text: `เกินยอดสั่ง! ${text}` };
    }
    return { ok: true, text: `${text}${pr.diff === 0 ? ' ครบแล้ว' : ''}` };
  }

  /**
   * สแกนของที่หยิบ = +1 ทันที (เหมือนหน้าตรวจ): บาร์ในออเดอร์ หรือบาร์อื่นของขนาดเดียวกัน
   * ขนาดอื่นของ SKU เดียวกัน = ให้แทน นับเป็นชิ้น (รายการขนาดเดียวกันที่ยังขาดได้ก่อน)
   */
  async function handleScan(raw: string): Promise<ScanFeedback | void> {
    const o = orderRef.current;
    const code = raw.trim();
    if (!o || !code) return;
    if (!(o.prep.status === 'PREPARING' && o.prep.byId === user?.id)) return { ok: false, text: 'กด "รับจัดออเดอร์นี้" ก่อนสแกน' };
    const sorted = sortBySkuCode(o.lines);
    const short = (ls: OrderLine[]) => ls.find((l) => progressOf(o, l).diff < 0);
    const own = async (l: OrderLine) => feedback(await setPicked(l, (pr) => pr.own + 1), l);
    const exact = sorted.filter((l) => l.packCode === code || (!l.packCode && lineCode(l) === code));
    const exactShort = short(exact);
    if (exactShort) return own(exactShort);
    let p: Product | null = null;
    try { p = await api<Product>('/products/lookup/' + encodeURIComponent(code)); }
    catch (e) { if (!(e instanceof ApiError && e.status === 404)) return { ok: false, text: errorText(e) }; }
    if (!p) return exact.length ? own(exact[0]) : { ok: false, text: `ไม่พบสินค้ารหัส ${code} ลองสแกนอีกครั้ง หรือกด + ในรายการ` };
    const product = p;
    const packOf = (c: string) => product.packs?.find((x) => x.code === c);
    const scanned = packOf(code);
    const sameSku = sorted.filter((l) => l.sku === product.sku);
    // บาร์โค้ดคนละตัวแต่ขนาดเดียวกัน (เช่น บาร์ปกติกับบาร์ L) นับเป็นรายการเดียวกัน
    const sameSize = (l: OrderLine) => { const k = packOf(l.packCode); return scanned ? !!k && k.unitName === scanned.unitName && k.unitQty === scanned.unitQty : l.packCode === product.sku; };
    const mine = [...exact, ...sameSku.filter((l) => !exact.includes(l) && sameSize(l))];
    // ขนาดอื่นของ SKU เดียวกันที่แปลงเป็นชิ้นได้ (สั่งลัง ของเหลือโหล) ให้แทนได้ นับเป็นชิ้น
    const others = scanned && scanned.unitQty > 0 ? sameSku.filter((l) => !mine.includes(l) && (packOf(l.packCode)?.unitQty ?? 0) > 0) : [];
    const substitute = async (l: OrderLine) =>
      feedback(await setPicked(l, (pr) => partQty(pr, scanned!.code) + 1, scanned!.code), l, `ให้ ${scanned!.unitName} แทน · `);
    const mineShort = short(mine);
    if (mineShort) return own(mineShort);
    const otherShort = short(others);
    if (otherShort) return substitute(otherShort);
    // ครบทุกรายการแล้ว: ยังนับเพิ่ม แถวจะแดง "เกินยอดสั่ง" ให้เห็น
    if (mine.length) return own(mine[0]);
    if (others.length) return substitute(others[0]);
    if (sameSku.length) return { ok: false, text: `ผิดขนาด! ${scanned?.unitName ?? product.unit} · ออเดอร์สั่งเป็น ${sameSku.map((l) => l.unit).join(', ')} แปลงเป็นชิ้นไม่ได้` };
    return { ok: false, text: `ไม่อยู่ในออเดอร์! ${product.name}` };
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
                  // ครบ = ตรงยอดพอดี นับรวมขนาดอื่นที่ให้แทน (เหมือนในใบจัด)
                  const ticked = o.lines.filter((l) => progressOf(o, l).diff === 0).length;
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

  // ---------- ใบจัดของออเดอร์ที่เปิด (วางแบบเดียวกับหน้าตรวจของเบิก) ----------
  const status = order.prep.status;
  const mine = status === 'PREPARING' && order.prep.byId === user?.id;
  const progress = new Map(lines.map((l) => [l.lineNo, progressOf(order, l)]));
  const prog = (l: OrderLine) => progress.get(l.lineNo)!;
  const left = lines.filter((l) => prog(l).diff < 0).length;
  const over = lines.filter((l) => prog(l).diff > 0).length;
  // ครบ = ตรงยอดสั่งพอดี (เกินไม่นับว่าครบ)
  const exact = lines.length - left - over;
  const pending = lines.filter((l) => prog(l).diff !== 0);
  const done = lines.filter((l) => prog(l).diff === 0);
  const starClass = (pr: PrepProgress) => pr.diff === 0
    ? 'fill-star text-star drop-shadow-[0_0_6px_color-mix(in_oklab,var(--pm-star)_70%,transparent)]'
    : pr.diff > 0 ? 'fill-on-sky-rose text-on-sky-rose' : pr.got > 0 ? 'fill-on-sky-kibble/30 text-on-sky-kibble' : 'text-on-sky/35';
  const row = (l: OrderLine, compact = false) => (
    <PrepRow key={l.lineNo} line={l} pr={prog(l)} editable={mine} compact={compact} disabled={busy} highlight={lastLine === l.lineNo}
      onChange={(next, packCode) => void setPicked(l, (pr) => next(packCode ? partQty(pr, packCode) : pr.own), packCode)}
      onBarcode={(code) => scanRef.current?.scan(code)} />
  );
  const backButton = (
    <Button variant="ghost" size="touch" className="px-3 text-brand-foreground hover:bg-on-sky/10 hover:text-brand-foreground" disabled={busy} onClick={() => { setOrder(null); setMessage(null); }}>
      <ArrowLeftIcon />กลับคิว
    </Button>
  );

  return (
    <div className={cn('grid gap-4', mine && 'pb-32 lg:pb-0')}>
      {/* จอ: สแกนแล้วนับทันที · กระดาษ: ใบจัดสินค้าแบบเดียวกับหน้าออเดอร์ */}
      <div className="grid gap-4 print:hidden">
        {/* หมายเหตุผู้สั่งต้องเห็นก่อนหยิบ จึงอยู่เหนือช่องสแกน */}
        {order.note && (
          <p className="rounded-xl border-2 border-kibble/55 bg-kibble-soft px-3 py-2 text-sm whitespace-pre-wrap break-words">
            <b>หมายเหตุจากผู้สั่ง:</b> {order.note}
          </p>
        )}
        {mine && <ScanInput ref={scanRef} label={`สแกนสินค้าที่หยิบ · ${order.id}`} placeholder="สแกนสินค้าทีละชิ้น" hint="สแกน 1 ครั้ง = 1 ชิ้น หยิบทีละมากกด + หรือพิมพ์จำนวนในรายการ" onScan={handleScan} autoFocus />}
        <Notice message={message} />

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
          {/* มือถือ: ท้องฟ้า → รายการ → ปุ่มรอง / จอคอม: รายการซ้าย แผงสรุปติดขวา */}
          <aside className="contents lg:sticky lg:top-20 lg:order-2 lg:grid lg:gap-4">
            <MagicStage className="order-1 grid gap-3 lg:order-none">
              <div className="grid gap-0.5">
                {/* ปุ่มกลับอยู่บรรทัดเลขออเดอร์ (แบบหน้าตรวจ) ชื่อผู้สั่งยาวๆ จะได้กว้างเต็มแผง */}
                <div className="-mr-2 flex items-center justify-between gap-2">
                  <p className="font-mono text-sm text-brand-foreground/75">{order.id} · <span className="whitespace-nowrap">สั่ง {orderedAt(order.createdAt)}</span></p>
                  {backButton}
                </div>
                <p className="font-heading text-lg leading-snug font-semibold break-words"><BoothName order={order} /></p>
              </div>
              <PrepBadge prep={order.prep} className="justify-self-start" />
              <p className="font-heading text-3xl font-semibold tabular-nums" aria-live="polite">
                <span className={cn(lines.length > 0 && exact === lines.length && 'text-star')}>{exact}</span><span className="text-brand-foreground/60">/{lines.length}</span>
                <span className="ml-2 align-middle text-base font-normal text-brand-foreground/80">{lines.length > 0 && exact === lines.length ? 'หยิบครบทุกรายการ' : 'รายการครบ'}</span>
              </p>
              <ul className="flex flex-wrap gap-1.5" aria-label="สถานะแต่ละรายการ">
                {lines.map((l) => {
                  const pr = prog(l);
                  return (
                    <li key={l.lineNo}>
                      <StarIcon className={cn('size-6 transition-[color,fill,filter] duration-300', starClass(pr))} aria-label={`${l.name}: ${pr.diff === 0 ? 'ครบ' : pr.diff > 0 ? 'เกิน' : pr.got > 0 ? 'ขาด' : 'ยังไม่หยิบ'}`} />
                    </li>
                  );
                })}
              </ul>
              {status === '' && (
                <Button size="touch" className="w-full bg-star text-on-star hover:bg-star/90" disabled={busy} onClick={() => void act({ action: 'claim' })}>
                  {busy ? <LoaderCircleIcon className="animate-spin" /> : <HandIcon />}รับจัดออเดอร์นี้
                </Button>
              )}
              {status === 'PREPARING' && !mine && (
                <div role="status" className="grid gap-2 rounded-xl bg-on-sky/10 p-3 ring-1 ring-on-sky-kibble/40">
                  <p className="flex items-center gap-2 font-semibold"><LockIcon className="size-5 shrink-0 text-on-sky-kibble" aria-hidden /><span>ออเดอร์นี้มีคนรับจัดแล้ว <span className="whitespace-nowrap">จัดซ้อนกันไม่ได้</span></span></p>
                  <p className="text-sm text-brand-foreground/85"><b className="whitespace-nowrap">{order.prep.byName}</b> กำลังจัดอยู่ ตั้งแต่ {order.prep.startedAt ? clockTime(order.prep.startedAt) : '-'} ระบบล็อกไว้กันหยิบของซ้ำ</p>
                  {confirm === 'takeover' ? (
                    <div className="grid gap-2">
                      <p className="text-sm">รับช่วงต่อจาก <b className="whitespace-nowrap">{order.prep.byName}</b>? เครื่องของ <span className="whitespace-nowrap">{order.prep.byName}</span> จะใส่จำนวนหรือกดจัดเสร็จไม่ได้อีก จำนวนที่หยิบไปแล้วยังอยู่</p>
                      <div className="grid grid-cols-2 gap-2">
                        <Button size="touch" className="bg-star text-on-star hover:bg-star/90" disabled={busy} onClick={() => void act({ action: 'claim', force: true })}>ยืนยัน รับช่วงต่อ</Button>
                        <Button size="touch" variant="ghost" className="text-brand-foreground hover:bg-on-sky/10 hover:text-brand-foreground" onClick={() => setConfirm(null)}>ยกเลิก</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <Button size="touch" variant="outline" className="border-on-sky/30 bg-transparent text-brand-foreground hover:bg-on-sky/10 hover:text-brand-foreground" onClick={() => setConfirm('takeover')}>
                        <HandIcon />รับช่วงต่อ
                      </Button>
                      <span className="text-xs text-brand-foreground/75">ใช้เฉพาะกรณีคนเดิมไม่อยู่แล้ว</span>
                    </div>
                  )}
                </div>
              )}
            </MagicStage>
            {/* ปุ่มหลัก (จัดเสร็จ) บนจอคอมอยู่ที่นี่ มือถืออยู่แถบล่าง ปุ่มรองเล็กกว่าเสมอ */}
            <Card className="order-4 lg:order-none">
              <CardContent className="grid gap-3">
                {mine && <div className="hidden lg:block">{doneArea(false)}</div>}
                <div className="flex flex-wrap gap-2">
                  <Button size="touch" variant="outline" className="flex-1" onClick={() => window.print()}><PrinterIcon />พิมพ์ใบจัด</Button>
                  {mine && <Button size="touch" variant="ghost" className="flex-1" disabled={busy} onClick={() => void act({ action: 'release' })}><Undo2Icon />คืนเข้าคิว</Button>}
                  {status === 'READY' && !order.lastCheck && <Button size="touch" variant="ghost" className="flex-1" disabled={busy} onClick={() => void act({ action: 'reopen' })}><RotateCcwIcon />เปิดจัดใหม่</Button>}
                </div>
                {mine && <p className="text-xs text-muted-foreground">คืนเข้าคิว = เลิกจัดใบนี้ให้คนอื่นรับต่อ จำนวนที่หยิบแล้วยังอยู่</p>}
              </CardContent>
            </Card>
          </aside>

          {/* รายการเรียงตาม SKU_CODE เหมือนใบจัดที่พิมพ์: ยังไม่ครบ/เกินอยู่บน ครบแล้วพับไว้ */}
          <div className="order-3 grid gap-5 lg:order-1">
            {pending.length > 0 && (
              <section className="grid gap-2" aria-labelledby="prep-open">
                <h2 id="prep-open" className="font-heading text-lg font-semibold">ยังไม่ครบ <span className="text-muted-foreground tabular-nums">({pending.length})</span></h2>
                <ul className="grid gap-2">{pending.map((l) => row(l))}</ul>
              </section>
            )}
            {done.length > 0 && (
              <details className="group grid gap-2" open={!pending.length}>
                <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-lg font-heading text-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                  <span className="grid size-7 place-items-center rounded-full bg-sky-soft text-sky"><CheckIcon className="size-4" aria-hidden /></span>
                  ครบแล้ว <span className="text-muted-foreground tabular-nums">({done.length})</span>
                  <ChevronDownIcon className="size-5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
                </summary>
                <ul className="mt-2 grid gap-2">{done.map((l) => row(l, true))}</ul>
              </details>
            )}
          </div>
        </div>
      </div>
      {/* แถบล่างบนมือถือ: ความคืบหน้า + จัดเสร็จ (แบบหน้าตรวจ) */}
      {mine && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-on-sky/10 bg-brand px-4 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] text-brand-foreground shadow-dock lg:hidden print:hidden">
          <div className="mx-auto grid max-w-3xl gap-2">
            <p className="text-sm" aria-live="polite">
              หยิบครบ <span className={cn('font-heading font-semibold tabular-nums', exact === lines.length && 'text-on-sky-mint')}>{exact}/{lines.length}</span> รายการ
              {left > 0 && <> · ยังขาด <span className="font-semibold text-on-sky-kibble tabular-nums">{left}</span></>}
              {over > 0 && <> · เกิน <span className="font-semibold text-on-sky-rose tabular-nums">{over}</span></>}
            </p>
            {doneArea(true)}
          </div>
        </div>
      )}
      <div className="hidden print:block"><OrderReceipt order={order} actions={null} /></div>
    </div>
  );

  /** ปุ่มจัดเสร็จ + ยืนยันเมื่อยังหยิบไม่ครบ ใช้ทั้งแผงขวา (จอคอม) และแถบล่าง (มือถือ บนพื้นท้องฟ้า) */
  function doneArea(onSky: boolean) {
    if (confirm === 'done') {
      return (
        <div role="alert" className={cn('grid w-full gap-2 rounded-xl p-3', onSky ? 'bg-on-sky/10 ring-1 ring-on-sky-kibble/40' : 'border-2 border-kibble/55 bg-kibble-soft')}>
          <p className="text-sm font-medium">{[left > 0 && `ยังหยิบไม่ครบ ${left} รายการ`, over > 0 && `หยิบเกินยอดสั่ง ${over} รายการ`].filter(Boolean).join(' และ ')} ยืนยันส่งตรวจเลยไหม (ผู้ตรวจจะเห็นยอดที่คุณหยิบในแต่ละรายการ)</p>
          <div className="grid grid-cols-2 gap-2">
            <Button size="touch" variant="outline" className={cn(onSky && 'border-on-sky/30 bg-transparent text-brand-foreground hover:bg-on-sky/10 hover:text-brand-foreground')} onClick={() => { setConfirm(null); scanRef.current?.focus(); }}>กลับไปจัดต่อ</Button>
            <Button size="touch" className="bg-star text-on-star hover:bg-star/90" disabled={busy} onClick={() => void act({ action: 'done' })}>ยืนยัน จัดเสร็จ</Button>
          </div>
        </div>
      );
    }
    const button = (
      <Button size="touch" className={cn('w-full', !left && !over && 'bg-star text-on-star hover:bg-star/90')} disabled={busy} onClick={() => (left || over ? setConfirm('done') : void act({ action: 'done' }))}>
        {busy ? <LoaderCircleIcon className="animate-spin" /> : !left && !over ? <Sparkle className="size-5" /> : <CheckIcon />}จัดเสร็จ ส่งตรวจ
      </Button>
    );
    return !left && !over && !busy ? <StarBorder innerClassName="border-0">{button}</StarBorder> : button;
  }
}

/**
 * แถวจัด 1 รายการ (แบบแถวหน้าตรวจ): สถานะซ้าย ยอดหยิบ/ยอดสั่งตัวใหญ่ขวา
 * ปุ่ม − จำนวน + ของขนาดที่สั่ง และของขนาดอื่นที่ให้แทน แถวที่ครบแล้วย่อเหลือบรรทัดเดียว แตะดินสอเพื่อแก้
 */
function PrepRow({ line, pr, editable, compact, disabled, highlight, onChange, onBarcode }: {
  line: OrderLine; pr: PrepProgress; editable: boolean; compact?: boolean; disabled?: boolean; highlight?: boolean;
  /** ยอดใหม่ของขนาดนั้นจากยอดล่าสุด (packCode = ขนาดที่ให้แทน) */
  onChange: (next: (current: number) => number, packCode?: string) => void;
  onBarcode: (code: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const isOver = pr.diff > 0;
  const done = pr.diff === 0;
  const partial = pr.got > 0 && pr.diff < 0;
  const small = compact && !editing;
  const unitWord = pr.pieces ? 'ชิ้น' : line.unit;
  return (
    <li id={`prep-L${line.lineNo}`} className={cn('grid scroll-mt-28 gap-3 rounded-xl border-2 p-3 transition-shadow duration-300',
      isOver ? 'border-rose/60 bg-rose-soft' : done ? 'border-sky/50 bg-sky-soft' : partial ? 'border-kibble/55 bg-kibble-soft/60' : 'border-card-edge bg-card',
      highlight && 'shadow-[0_0_0_4px_color-mix(in_oklab,var(--pm-star)_35%,transparent)]', small && 'py-2')}>
      <div className="flex items-center gap-3">
        <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-full border-2', small ? 'size-8' : 'size-10',
          isOver ? 'border-rose bg-rose text-background' : done ? 'border-sky bg-sky text-background' : partial ? 'border-kibble text-kibble-ink' : 'border-dashed border-muted-foreground/50')}>
          {isOver ? <PlusIcon className="size-5 stroke-[3]" /> : done ? <CheckIcon className="size-5 stroke-[3]" /> : partial ? <span className="size-3 rounded-full bg-current" /> : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('font-medium break-words', small && 'line-clamp-1 text-sm')}>{line.name}</p>
          {!small && <p className="font-mono text-xs break-all text-muted-foreground">{line.packCode || lineCode(line) || 'ไม่มีรหัส'}</p>}
          {!small && pr.pieces && <p className="text-sm text-muted-foreground">สั่ง {formatQty(line.qty)} {line.unit} = {formatQty(pr.need)} ชิ้น</p>}
          {isOver && <p className="text-sm font-semibold text-rose">เกินยอดสั่ง {formatQty(pr.diff)} {unitWord}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('font-heading font-semibold tabular-nums', small ? 'text-base' : 'text-2xl')}>
            <span className={cn(isOver ? 'text-rose' : done ? 'text-sky' : partial ? 'text-kibble-ink' : 'text-muted-foreground')}>{formatQty(pr.got)}</span>
            <span className="text-muted-foreground">/{formatQty(pr.need)}</span>
          </p>
          {!small && <ToneChip tone={pr.pieces ? 'mint' : unitTone(unitPieces(line.unit))} className="mt-0.5">{unitWord}</ToneChip>}
        </div>
        {compact && editable && (
          <Button type="button" variant="ghost" size="icon-touch" className="-mr-1 text-muted-foreground" aria-label={editing ? `ปิดการแก้จำนวน ${line.name}` : `แก้จำนวน ${line.name}`} aria-expanded={editing} onClick={() => setEditing(!editing)}>
            {editing ? <ChevronDownIcon className="rotate-180" /> : <PencilIcon />}
          </Button>
        )}
      </div>
      {!small && editable && (
        <div className="grid gap-2">
          <PickStepper name={line.name} label={pr.parts.length ? `${line.unit} (ขนาดที่สั่ง)` : line.unit} value={pr.own} disabled={disabled}
            onChange={(next) => onChange(next)} onBarcode={onBarcode} />
          {pr.parts.map((x) => (
            <PickStepper key={x.packCode} sub name={line.name} label={`ให้ ${x.unit} แทน · 1 ${x.unit} = ${formatQty(x.pieces)} ชิ้น`} value={x.qty} disabled={disabled}
              onChange={(next) => onChange(next, x.packCode)} onRemove={() => onChange(() => 0, x.packCode)} onBarcode={onBarcode} />
          ))}
        </div>
      )}
      {!small && !editable && pr.parts.length > 0 && (
        <p className="flex flex-wrap items-center gap-1 text-xs text-kibble-ink">
          <RefreshCcwIcon className="size-3.5" aria-hidden />ให้แทน {pr.parts.map((x) => `${x.unit} ${formatQty(x.qty)}`).join(' · ')}{pr.own > 0 && ` · ${line.unit} ${formatQty(pr.own)}`}
        </p>
      )}
    </li>
  );
}

/**
 * − จำนวน + ของขนาดหนึ่ง: กด −/+ บันทึกทันที พิมพ์จำนวนแล้ว Enter (หรือแตะที่อื่น) จึงบันทึก
 * หัวสแกนยิงบาร์โค้ดใส่ช่องนี้ (ตัวเลข 8 หลักขึ้นไปหรือมีตัวอักษร) = ส่งไปสแกน ไม่บันทึกเป็นจำนวน
 */
function PickStepper({ name, label, value, sub, disabled, onChange, onRemove, onBarcode }: {
  name: string; label: string; value: number; sub?: boolean; disabled?: boolean;
  onChange: (next: (current: number) => number) => void; onRemove?: () => void; onBarcode: (code: string) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const typed = text.trim();
    if (/^\d{8,}$/.test(typed) || /[A-Za-z]/.test(typed)) { setText(String(value)); onBarcode(typed); return; }
    const n = Number(typed);
    if (typed === '' || !Number.isFinite(n) || n < 0) { setText(String(value)); return; }
    if (n !== value) onChange(() => n);
  };
  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', sub && 'rounded-lg bg-kibble-soft px-2 py-1')}>
      <div className="flex items-stretch" role="group" aria-label={`จำนวนที่หยิบ ${name} ${label}`}>
        <Button type="button" variant="outline" size="icon-touch" className="rounded-r-none" aria-label={`ลด ${label} 1`} disabled={disabled || value <= 0} onClick={() => onChange((c) => c - 1)}><MinusIcon /></Button>
        <Input
          className="h-12 w-20 rounded-none border-x-0 text-center text-lg font-semibold tabular-nums md:text-lg"
          type="text" inputMode="decimal" aria-label={`จำนวนที่หยิบ ${label}`} value={text} disabled={disabled}
          onFocus={(e) => e.target.select()} onChange={(e) => setText(e.target.value)} onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
        />
        <Button type="button" variant="outline" size="icon-touch" className="rounded-l-none" aria-label={`เพิ่ม ${label} 1`} disabled={disabled} onClick={() => onChange((c) => c + 1)}><PlusIcon /></Button>
      </div>
      <span className={cn('min-w-0 flex-1 text-sm', sub ? 'text-kibble-ink' : 'text-muted-foreground')}>
        {sub && <RefreshCcwIcon className="mr-1 inline size-3.5 align-[-0.1em]" aria-hidden />}{label}
      </span>
      {onRemove && <Button type="button" variant="ghost" size="icon-touch" className="text-muted-foreground hover:text-destructive" aria-label={`เลิกให้ ${label}`} disabled={disabled} onClick={onRemove}><Trash2Icon /></Button>}
    </div>
  );
}
