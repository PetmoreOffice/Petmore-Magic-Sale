import { ReactNode, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ClipboardListIcon, LoaderCircleIcon, MinusIcon, PlusIcon, PrinterIcon, SearchIcon, ShoppingBasketIcon, SparklesIcon, StoreIcon, Trash2Icon, Building2Icon, ChevronDownIcon, FilterIcon, XIcon } from 'lucide-react';
import { Customer, MAX_ORDER_LINES, OrderLineInput, Paged, SalesOrder } from '@petmore/shared';
import { cn } from 'cn';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { CheckBadge, Field, Message, Notice } from '@/components/wms';
import { CustomerPicker } from '@/components/CustomerPicker';
import { OrderBarcode } from '@/components/OrderBarcode';
import { OrderCatalog } from '@/components/OrderCatalog';
import { MagicStage } from '@/components/magic';
import StarBorder from '@/components/StarBorder';
import BlurText from '@/components/BlurText';
import CountUp from '@/components/CountUp';
import { SparkBurst, SparkBurstHandle } from '@/components/SparkBurst';
import { formatQty } from '@/lib/packs';
import { scrollToStart, touchInput } from '@/lib/touch';
import { api, formatTime, newRequestId, todayIso } from '../api';
import { useAuth } from '../auth';

const errorMessage = (e: unknown): Message => ({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
/** รหัสที่แสดงของรายการ: SKU จากทะเบียน หรือรหัสที่กรอกเอง */
const lineCode = (line: { sku: string; itemCode?: string }) => line.sku || line.itemCode || '';

/** ขั้นตอนจดออเดอร์แบบร้านค้าออนไลน์: เลือกผู้สั่ง + สินค้าของผู้สั่งนั้น → ตะกร้า → ยืนยัน */
type View = 'shop' | 'cart' | 'checkout' | 'history';

interface Draft {
  customer: Customer | null; phone: string; date: string;
  reference: string; note: string; lines: OrderLineInput[]; requestId: string;
}
// Keep each user's draft across in-app navigation without persisting personal data to disk.
const drafts = new Map<string, Draft>();

export function OrdersPage() {
  const { has, user } = useAuth();
  const [draft] = useState(() => drafts.get(user?.id ?? ''));
  const canCreate = has('orders.create');
  const [view, setView] = useState<View>(canCreate ? 'shop' : 'history');
  const [customer, setCustomer] = useState<Customer | null>(draft?.customer ?? null);
  const [phone, setPhone] = useState(draft?.phone ?? '');
  const [date, setDate] = useState(draft?.date ?? todayIso());
  const [reference, setReference] = useState(draft?.reference ?? '');
  const [note, setNote] = useState(draft?.note ?? '');
  const [lines, setLines] = useState<OrderLineInput[]>(draft?.lines ?? []);
  const [requestId, setRequestId] = useState(() => draft?.requestId ?? newRequestId());
  const [saving, setSaving] = useState(false);
  const saveLock = useRef(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [selected, setSelected] = useState<SalesOrder | null>(null);
  // เพิ่งบันทึกเสร็จ: แสดงฉากฉลองเหนือใบออเดอร์ (ดูย้อนหลังไม่แสดง)
  const [justSaved, setJustSaved] = useState(false);
  const cartSpark = useRef<SparkBurstHandle>(null);
  const viewHeading = useRef<HTMLDivElement>(null);

  const [history, setHistory] = useState<Paged<SalesOrder> | null>(null);
  const [historyTerm, setHistoryTerm] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyMessage, setHistoryMessage] = useState<Message | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  useEffect(() => {
    if (view !== 'history') return;
    let live = true;
    setLoadingHistory(true);
    setHistoryMessage(null);
    api<Paged<SalesOrder>>(`/orders?q=${encodeURIComponent(historyQuery)}&page=${page}`)
      .then((data) => { if (live) setHistory(data); })
      .catch((e) => { if (live) setHistoryMessage(errorMessage(e)); })
      .finally(() => { if (live) setLoadingHistory(false); });
    return () => { live = false; };
  }, [view, page, historyQuery, historyVersion]);

  const dirty = !!(customer || phone || reference || note || lines.length || date !== todayIso());
  useEffect(() => {
    if (!user) return;
    if (dirty) drafts.set(user.id, { customer, phone, date, reference, note, lines, requestId });
    else drafts.delete(user.id);
  }, [user, dirty, customer, phone, date, reference, note, lines, requestId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** เปลี่ยนขั้นตอน: ขึ้นต้นหน้าใหม่ แล้วย้ายโฟกัสไปที่หัวข้อให้โปรแกรมอ่านหน้าจอรู้ว่าเปลี่ยนหน้า */
  function go(next: View) {
    setView(next); setSelected(null); setMessage(null); setJustSaved(false);
    window.scrollTo({ top: 0 });
    requestAnimationFrame(() => viewHeading.current?.focus({ preventScroll: true }));
  }

  function startNew() {
    setSelected(null); setLines([]); setCustomer(null); setPhone('');
    setDate(todayIso()); setReference(''); setNote(''); setRequestId(newRequestId()); setMessage(null);
    go('shop');
  }

  function addLine(line: OrderLineInput): string | null {
    // สินค้า + บาร์โค้ดเดิมซ้ำ รวมจำนวนในบรรทัดเดิมแทนการเพิ่มบรรทัดใหม่
    const same = lines.findIndex((l) => l.sku && l.sku === line.sku && l.packCode === line.packCode);
    if (same < 0 && lines.length >= MAX_ORDER_LINES) return `ตะกร้าเต็มแล้ว (สูงสุด ${MAX_ORDER_LINES} รายการ) บันทึกออเดอร์นี้ก่อน แล้วจดออเดอร์ใหม่สำหรับสินค้าที่เหลือ`;
    if (same >= 0) setLines(lines.map((l, i) => (i === same ? { ...l, qty: Math.min(100_000_000, Math.round((l.qty + line.qty) * 1000) / 1000) } : l)));
    else setLines([...lines, line]);
    cartSpark.current?.burst();
    return null;
  }

  function stepLine(index: number, delta: number) {
    setLines(lines.map((l, i) => (i === index ? { ...l, qty: Math.min(100_000_000, Math.max(1, Math.round((l.qty + delta) * 1000) / 1000)) } : l)));
  }

  async function save() {
    if (saveLock.current) return;
    setMessage(null);
    if (!lines.length) return setMessage({ kind: 'error', text: 'ตะกร้ายังว่าง เลือกสินค้าอย่างน้อย 1 รายการ' });
    if (!customer) return setMessage({ kind: 'error', text: 'เลือกผู้สั่งจากทะเบียนก่อนบันทึก' });
    if (!date) return setMessage({ kind: 'error', text: 'ใส่วันที่รับออเดอร์ก่อนบันทึก' });
    saveLock.current = true; setSaving(true);
    try {
      const saved = await api<SalesOrder>('/orders', { method: 'POST', body: { requestId, customerCode: customer.code, phone, date, reference, note, lines } });
      startNew(); setSelected(saved); setJustSaved(true);
      setHistoryVersion((v) => v + 1);
    } catch (e) { setMessage(errorMessage(e)); }
    finally { saveLock.current = false; setSaving(false); }
  }

  const creating = view === 'shop' || view === 'cart' || view === 'checkout';

  return (
    <div className={cn('grid gap-5', view === 'shop' && lines.length > 0 && 'pb-24')}>
      <MagicStage>
        <div className="grid gap-4">
          <nav className="flex flex-wrap items-center gap-2" aria-label="หน้าจอออเดอร์">
            {canCreate && <>
              <StageTab active={view === 'shop' && !selected} onClick={() => go('shop')} disabled={saving}><StoreIcon />เลือกสินค้า</StageTab>
              <StageTab active={(view === 'cart' || view === 'checkout') && !selected} onClick={() => go('cart')} disabled={saving}>
                <ShoppingBasketIcon />ตะกร้า
                {lines.length > 0 && <CartCount count={lines.length} inverted={(view === 'cart' || view === 'checkout') && !selected} />}
              </StageTab>
            </>}
            <StageTab active={view === 'history' && !selected} className="sm:ml-auto" onClick={() => go('history')} disabled={saving}><ClipboardListIcon />ออเดอร์ย้อนหลัง</StageTab>
          </nav>
          {creating && !selected && canCreate && <Steps current={view} hasLines={lines.length > 0} onGo={go} />}
        </div>
      </MagicStage>

      {selected ? (
        <div className="grid gap-5">
          {justSaved ? <Celebration order={selected} /> : <div className="print:hidden"><Notice message={message} /></div>}
          <OrderReceipt order={selected} actions={
            <>
              <Button size="touch" variant="outline" onClick={() => window.print()}><PrinterIcon />พิมพ์ออเดอร์</Button>
              {creating && canCreate
                ? <Button size="touch" onClick={startNew}><PlusIcon />จดออเดอร์ใหม่</Button>
                : <Button size="touch" onClick={() => { setSelected(null); setMessage(null); }}><ArrowLeftIcon />กลับไปออเดอร์ย้อนหลัง</Button>}
            </>
          } />
        </div>
      ) : view === 'shop' && canCreate ? (
        <>
          {/* การ์ดสินค้าวางบนหน้าตรงๆ ไม่ห่อด้วย Card อีกชั้น (ห้ามการ์ดซ้อนการ์ด) */}
          <section className="grid gap-4" aria-labelledby="shop-heading">
            <div className="grid gap-1">
              <div ref={viewHeading} tabIndex={-1} className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <h2 id="shop-heading" className="font-heading text-xl font-semibold">เลือกสินค้า</h2>
              </div>
              <p className="text-sm text-muted-foreground">แตะสินค้าเพื่อเลือกบาร์โค้ดและจำนวน หรือสแกนบาร์โค้ดในช่องค้นหา</p>
            </div>
            <OrderCatalog
              customerCode={customer?.code ?? ''}
              onAdd={addLine}
              disabled={saving}
              filters={<CustomerFilter customer={customer} onChange={setCustomer} disabled={saving} />}
            />
          </section>

          {lines.length > 0 && (
            <div className="fixed inset-x-0 bottom-0 z-10 border-t border-on-sky/10 bg-brand px-4 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] text-brand-foreground shadow-dock print:hidden">
              <div className="relative mx-auto flex max-w-6xl items-center gap-3">
                <SparkBurst ref={cartSpark} count={14} reach={24} />
                <span className="relative grid size-11 shrink-0 place-items-center rounded-full bg-star/15 text-star">
                  <ShoppingBasketIcon className="size-6" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 leading-tight" aria-live="polite">
                  <p className="text-sm text-brand-foreground/75">ในตะกร้า</p>
                  <p className="font-heading text-lg font-semibold tabular-nums"><span key={lines.length} className="inline-block animate-[cart-bump_420ms_ease-out] text-star">{lines.length}</span> รายการ</p>
                </div>
                <Button size="touch" className="bg-star text-on-star hover:bg-star/90" onClick={() => go('cart')}>ดูตะกร้า<ArrowRightIcon /></Button>
              </div>
            </div>
          )}
        </>
      ) : view === 'cart' && canCreate ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <Card>
            <CardHeader>
              <div ref={viewHeading} tabIndex={-1} className="flex items-baseline justify-between gap-3 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <CardTitle role="heading" aria-level={2}>ตะกร้า</CardTitle>
                <span className="text-sm text-muted-foreground tabular-nums">{lines.length}/{MAX_ORDER_LINES} รายการ</span>
              </div>
            </CardHeader>
            <CardContent>
              {!lines.length ? (
                <div className="grid justify-items-center gap-3 rounded-lg border border-dashed border-border px-4 py-10 text-center">
                  <ShoppingBasketIcon className="size-10 text-muted-foreground" aria-hidden />
                  <p className="text-muted-foreground">ตะกร้ายังว่าง เลือกสินค้าที่ผู้สั่งต้องการก่อน</p>
                  <Button size="touch" onClick={() => go('shop')}><StoreIcon />ไปเลือกสินค้า</Button>
                </div>
              ) : (
                <ul className="divide-y divide-border border-y border-border">
                  {lines.map((line, index) => (
                    <li key={index} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                      <div className="flex min-w-0 items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium break-words">{line.name}</p>
                          <p className="text-sm text-muted-foreground tabular-nums">
                            {(line.packCode || lineCode(line)) && <span className="font-mono">{line.packCode || lineCode(line)}</span>}
                            {!line.sku && <> · สินค้านอกทะเบียน</>}
                          </p>
                        </div>
                        <Button variant="ghost" size="icon-touch" className="-mt-1 -mr-2 text-muted-foreground hover:text-destructive sm:hidden" aria-label={`ลบ ${line.name} ออกจากตะกร้า`} onClick={() => setLines(lines.filter((_, i) => i !== index))}><Trash2Icon /></Button>
                      </div>
                      <div className="flex items-center justify-between gap-3 sm:contents">
                        <div className="flex items-center rounded-lg border border-border" role="group" aria-label={`จำนวน ${line.name}`}>
                          <Button variant="ghost" size="icon-touch" aria-label={`ลดจำนวน ${line.name}`} disabled={line.qty <= 1} onClick={() => stepLine(index, -1)}><MinusIcon /></Button>
                          <span className="min-w-12 px-1 text-center font-semibold tabular-nums">{formatQty(line.qty)}</span>
                          <Button variant="ghost" size="icon-touch" aria-label={`เพิ่มจำนวน ${line.name}`} disabled={line.qty >= 100_000_000} onClick={() => stepLine(index, 1)}><PlusIcon /></Button>
                        </div>
                        <div className="flex items-center justify-end gap-1">
                          <span className="text-sm text-muted-foreground">{line.unit}</span>
                          <Button variant="ghost" size="icon-touch" className="-mr-2 hidden text-muted-foreground hover:text-destructive sm:inline-flex" aria-label={`ลบ ${line.name} ออกจากตะกร้า`} onClick={() => setLines(lines.filter((_, i) => i !== index))}><Trash2Icon /></Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Summary count={lines.length}>
            <Button size="touch" disabled={!lines.length} onClick={() => go('checkout')}>ถัดไป: ยืนยันออเดอร์<ArrowRightIcon /></Button>
            <Button size="touch" variant="outline" onClick={() => go('shop')}><StoreIcon />เลือกสินค้าต่อ</Button>
          </Summary>
        </div>
      ) : view === 'checkout' && canCreate ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <Card>
            <CardHeader>
              <div ref={viewHeading} tabIndex={-1} className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
                <CardTitle role="heading" aria-level={2}>ยืนยันออเดอร์</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <fieldset disabled={saving} className="grid min-w-0 gap-4 sm:grid-cols-2">
                {/* ผู้สั่งที่กรองไว้ตอนเลือกสินค้ามาเป็นค่าตั้งต้น เปลี่ยนได้ ไม่กระทบสินค้าในตะกร้า */}
                <div className="sm:col-span-2"><CustomerPicker value={customer} onChange={setCustomer} disabled={saving} /></div>
                <Field id="order-phone" label="เบอร์ติดต่อ (ถ้ามี)"><Input id="order-phone" className={touchInput} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={50} autoComplete="tel" placeholder="เช่น 081-234-5678" /></Field>
                <Field id="order-date" label="วันที่รับออเดอร์ *"><Input id="order-date" className={touchInput} type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></Field>
                <Field id="order-reference" label="เลขอ้างอิง (ถ้ามี)" className="sm:col-span-2"><Input id="order-reference" className={touchInput} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={100} placeholder="เลขอ้างอิง" /></Field>
                <Field id="order-note" label="หมายเหตุ (ถ้ามี)" className="sm:col-span-2"><textarea id="order-note" className={`${touchInput} min-h-24 w-full rounded-md border border-input bg-transparent p-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="เช่น วิธีรับสินค้า หรือคำขอเพิ่มเติม" /></Field>
              </fieldset>
            </CardContent>
          </Card>

          <Summary count={lines.length} lines={lines}>
            <Notice message={message} />
            <StarBorder innerClassName="border-0">
              <Button size="touch" className="w-full bg-star text-on-star hover:bg-star/90" disabled={saving || !lines.length} onClick={() => void save()}>{saving ? <><LoaderCircleIcon className="animate-spin" />กำลังบันทึก…</> : <><SparklesIcon />บันทึกออเดอร์</>}</Button>
            </StarBorder>
            <Button size="touch" variant="outline" disabled={saving} onClick={() => go('cart')}><ArrowLeftIcon />แก้ไขตะกร้า</Button>
          </Summary>
        </div>
      ) : (
        <Card className="mx-auto w-full max-w-3xl">
          <CardHeader>
            <div ref={viewHeading} tabIndex={-1} className="scroll-mt-24 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <CardTitle role="heading" aria-level={2}>ออเดอร์ย้อนหลัง</CardTitle>
            </div>
            <CardDescription>ค้นชื่อผู้สั่ง เบอร์โทร เลขออเดอร์ หรือเลขอ้างอิง</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setPage(1); setHistoryQuery(historyTerm); setHistoryVersion((v) => v + 1); }}><Input aria-label="ค้นออเดอร์" className={touchInput} value={historyTerm} onChange={(e) => setHistoryTerm(e.target.value)} placeholder="ชื่อผู้สั่ง / เบอร์ / เลขออเดอร์" maxLength={100} /><Button type="submit" size="icon-touch" aria-label="ค้นออเดอร์ย้อนหลัง" disabled={loadingHistory}><SearchIcon /></Button></form>
            <Notice message={historyMessage} />
            {loadingHistory ? <p role="status" className="text-sm text-muted-foreground">กำลังโหลดออเดอร์…</p> : history && <>
              <p className="text-sm text-muted-foreground" role="status">{history.total} ออเดอร์ · หน้า {history.page}/{history.pages}</p>
              {!history.rows.length && <p className="py-4 text-sm text-muted-foreground">{historyQuery ? `ไม่พบออเดอร์ที่ตรงกับ “${historyQuery}” ลองค้นด้วยชื่อผู้สั่ง เบอร์ หรือเลขออเดอร์` : 'ยังไม่มีออเดอร์ ออเดอร์ที่บันทึกแล้วจะแสดงที่นี่'}</p>}
              <div className="divide-y divide-border">{history.rows.map((order) => <button key={order.id} type="button" className="grid min-h-24 w-full gap-2 py-4 text-left outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring sm:grid-cols-[1fr_auto]" onClick={() => { setSelected(order); setMessage(null); }}><span className="grid min-w-0 gap-1"><strong className="font-heading break-words">{order.customerName}</strong><span className="text-sm text-muted-foreground">{order.id} · {order.date} · {order.lines.length} รายการ</span></span><span className="self-center"><CheckBadge check={order.lastCheck} /></span></button>)}</div>
              {history.pages > 1 && <div className="flex justify-between gap-3"><Button variant="outline" size="touch" disabled={page <= 1} onClick={() => { setPage(page - 1); scrollToStart(viewHeading.current); }}>หน้าก่อน</Button><Button variant="outline" size="touch" disabled={page >= history.pages} onClick={() => { setPage(page + 1); scrollToStart(viewHeading.current); }}>หน้าถัดไป</Button></div>}
            </>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

const STEPS: { view: View; label: string }[] = [
  { view: 'shop', label: 'เลือกสินค้า' },
  { view: 'cart', label: 'ตะกร้า' },
  { view: 'checkout', label: 'ยืนยัน' },
];

/** แถบขั้นตอนแบบหน้าชำระเงินของร้านออนไลน์ ย้อนกลับขั้นก่อนหน้าได้ ข้ามไปกรอกผู้สั่งได้เมื่อมีของในตะกร้า */
function Steps({ current, hasLines, onGo }: { current: View; hasLines: boolean; onGo: (view: View) => void }) {
  const at = STEPS.findIndex((s) => s.view === current);
  return (
    <ol className="flex items-center gap-1 text-sm print:hidden" aria-label="ขั้นตอนจดออเดอร์">
      {STEPS.map((step, i) => {
        const done = i < at, active = i === at;
        const reachable = !active && (i <= at || hasLines);
        return (
          <li key={step.view} className="flex min-w-0 items-center gap-1">
            {i > 0 && <span className={cn('h-0.5 w-4 shrink-0 rounded-full sm:w-10', i <= at ? 'bg-star' : 'bg-on-sky/20')} aria-hidden />}
            <button
              type="button"
              disabled={!reachable}
              aria-current={active ? 'step' : undefined}
              onClick={() => onGo(step.view)}
              className={cn(
                'flex min-h-12 items-center gap-2 rounded-full px-2 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default',
                active ? 'font-semibold text-brand-foreground' : 'text-brand-foreground/70 enabled:hover:text-brand-foreground',
              )}
            >
              <span className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums',
                active ? 'bg-star text-on-star shadow-[0_0_0_4px_color-mix(in_oklab,var(--pm-star)_25%,transparent)]' : done ? 'bg-star/20 text-star' : 'border border-on-sky/30',
              )}>{done ? <CheckIcon className="size-3.5" aria-hidden /> : i + 1}</span>
              {/* จอแคบ: ชื่อขั้นแสดงเฉพาะขั้นปัจจุบัน ขั้นอื่นเหลือเลข (โปรแกรมอ่านหน้าจอยังอ่านชื่อได้) */}
              <span className={cn('truncate', !active && 'sr-only sm:not-sr-only')}>{step.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** กล่องสรุปยอดข้างขวาบนจอคอม (ล่างสุดบนมือถือ) ใส่ปุ่มไปขั้นต่อไปผ่าน children */
function Summary({ count, lines, children }: { count: number; lines?: OrderLineInput[]; children: ReactNode }) {
  return (
    <Card className="lg:sticky lg:top-20">
      <CardHeader><CardTitle role="heading" aria-level={2}>สรุปออเดอร์</CardTitle></CardHeader>
      <CardContent className="grid gap-4">
        {lines && lines.length > 0 && (
          <ul className="grid max-h-64 gap-2 overflow-y-auto overscroll-contain text-sm">
            {lines.map((line, i) => (
              <li key={i} className="flex justify-between gap-3">
                <span className="min-w-0 break-words">{line.name}</span>
                <span className="shrink-0 font-semibold tabular-nums">{formatQty(line.qty)} {line.unit}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-1 border-t border-border pt-4">
          <div className="flex items-baseline justify-between gap-3"><span>สินค้าในออเดอร์</span><strong className="font-heading text-2xl tabular-nums">{count} รายการ</strong></div>
          <p className="text-sm text-muted-foreground">ออเดอร์บันทึกเฉพาะสินค้าและจำนวน ยังไม่ตัดสต็อก</p>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

/** ใบออเดอร์ที่บันทึกแล้ว ใช้ทั้งหลังบันทึกและดูย้อนหลัง พิมพ์เป็นขาวดำได้ */
function OrderReceipt({ order, actions }: { order: SalesOrder; actions: ReactNode }) {
  return (
    <Card data-print-doc className="mx-auto w-full max-w-3xl print:max-w-none">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <CardTitle role="heading" aria-level={2}>{order.id}</CardTitle>
            <CardDescription>บันทึกเมื่อ {formatTime(order.createdAt)}</CardDescription>
            <span className="print:hidden"><CheckBadge check={order.lastCheck} /></span>
          </div>
          {/* คนตรวจของเบิกสแกนบาร์โค้ดนี้เปิดออเดอร์ได้ทันที */}
          <OrderBarcode id={order.id} />
        </div>
      </CardHeader>
      <CardContent className="grid gap-5">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2"><dt className="text-muted-foreground">ผู้สั่ง{order.customerCode && <> · <span className="font-mono">{order.customerCode}</span></>}</dt><dd className="font-heading text-lg font-semibold break-words">{order.customerName}</dd></div>
          <div><dt className="text-muted-foreground">เบอร์ติดต่อ</dt><dd className="break-words">{order.phone || 'ไม่ได้ระบุ'}</dd></div>
          <div><dt className="text-muted-foreground">วันที่รับออเดอร์</dt><dd>{order.date}</dd></div>
          {/* ออเดอร์เก่าก่อนเลิกใช้ช่องนัดรับ ยังแสดงให้เห็น */}
          {order.dueDate && <div><dt className="text-muted-foreground">วันที่นัดรับ / ส่ง</dt><dd>{order.dueDate}</dd></div>}
        </dl>
        <div className="divide-y divide-border border-y border-border">
          {order.lines.map((line) => <div key={line.lineNo} className="flex items-start justify-between gap-3 py-3 break-inside-avoid"><div className="min-w-0"><p className="font-medium break-words">{line.name}</p>{(line.packCode || lineCode(line)) && <p className="font-mono text-sm text-muted-foreground">{line.packCode || lineCode(line)}</p>}</div><strong className="shrink-0 tabular-nums">{formatQty(line.qty)} {line.unit}</strong></div>)}
        </div>
        <p className="text-sm text-muted-foreground">รวม {order.lines.length} รายการ</p>
        {order.reference && <p className="text-sm break-words">อ้างอิง: {order.reference}</p>}
        {order.note && <p className="text-sm whitespace-pre-wrap break-words">หมายเหตุ: {order.note}</p>}
        <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>
      </CardContent>
    </Card>
  );
}

/** แท็บบนเวทีท้องฟ้า: แท็บที่เปิดอยู่เป็นทอง ที่เหลือเป็นแก้วจางบนพื้นม่วง */
function StageTab({ active, className, children, ...props }: { active: boolean; className?: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-12 items-center gap-2 rounded-xl px-4 text-base font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-star/60 disabled:opacity-60 [&_svg]:size-5',
        active ? 'bg-star text-on-star shadow-[0_6px_18px_-6px_color-mix(in_oklab,var(--pm-star)_70%,transparent)]' : 'bg-on-sky/10 text-brand-foreground ring-1 ring-on-sky/15 hover:bg-on-sky/15',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

/** ป้ายจำนวนบนแท็บตะกร้า เด้งทุกครั้งที่จำนวนเปลี่ยน */
function CartCount({ count, inverted }: { count: number; inverted: boolean }) {
  return (
    <span
      key={count}
      aria-label={`${count} รายการ`}
      className={cn('grid h-6 min-w-6 animate-[cart-bump_420ms_ease-out] place-items-center rounded-full px-1.5 text-xs font-bold tabular-nums', inverted ? 'bg-brand text-star' : 'bg-star text-on-star')}
    >
      {count}
    </span>
  );
}

/** ฉากฉลองหลังบันทึกออเดอร์: ประกายทองรอบเวที ข้อความค่อยๆ ชัด และนับจำนวนรายการขึ้น */
function Celebration({ order }: { order: SalesOrder }) {
  const spark = useRef<SparkBurstHandle>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    const t = setTimeout(() => spark.current?.burst(), 120);
    return () => clearTimeout(t);
  }, []);
  const title = `บันทึกออเดอร์ ${order.id} สำเร็จ`;
  return (
    <div className="relative print:hidden" role="status">
      <SparkBurst ref={spark} count={24} reach={44} length={16} duration={760} />
      <MagicStage>
        <div className="grid justify-items-center gap-3 py-4 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-mint-soft text-mint ring-4 ring-mint/25"><CheckIcon className="size-8" aria-hidden /></span>
          {reduce
            ? <p className="font-heading text-2xl font-semibold sm:text-3xl">{title}</p>
            : <BlurText text={title} delay={120} animateBy="words" direction="top" className="justify-center font-heading text-2xl font-semibold sm:text-3xl" />}
          <p className="text-brand-foreground/80">
            {order.customerName} · <span className="font-heading text-xl font-semibold text-star tabular-nums">{reduce ? order.lines.length : <CountUp from={0} to={order.lines.length} duration={0.8} />}</span> รายการ
          </p>
        </div>
      </MagicStage>
    </div>
  );
}

/**
 * ตัวกรองผู้สั่งในหน้าเลือกสินค้า (ไม่บังคับ): ยังไม่เลือกก็เห็นสินค้าทั้งหมด
 * เลือกแล้วเหลือเฉพาะสินค้าของบริษัทนั้น (SKU_ICCAT) และใช้เป็นผู้สั่งตั้งต้นตอนยืนยันออเดอร์
 */
function CustomerFilter({ customer, onChange, disabled }: { customer: Customer | null; onChange: (customer: Customer | null) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  if (customer) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">แสดงเฉพาะสินค้าของ</span>
        <span className="inline-flex min-h-12 max-w-full items-center gap-2 rounded-full border-2 border-star bg-star-soft pr-0.5 pl-3 text-sm">
          <Building2Icon className="size-4 shrink-0 text-star-ink" aria-hidden />
          <span className="min-w-0 truncate font-semibold">{customer.name}</span>
          <span className="shrink-0 font-mono text-xs text-muted-foreground">{customer.code}</span>
          <Button type="button" variant="ghost" size="icon-touch" className="rounded-full" aria-label={`ล้างตัวกรองผู้สั่ง ${customer.name} แสดงสินค้าทั้งหมด`} disabled={disabled} onClick={() => onChange(null)}><XIcon /></Button>
        </span>
        {customer.products === 0 && <span role="status" className="text-sm text-destructive">ผู้สั่งรายนี้ยังไม่มีสินค้าในทะเบียน ล้างตัวกรองเพื่อดูสินค้าทั้งหมด หรือกด “กรอกสินค้าเอง”</span>}
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <div>
        <Button type="button" variant="outline" size="touch" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
          <FilterIcon />กรองตามผู้สั่ง<ChevronDownIcon className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
      </div>
      {open && <div className="rounded-xl border border-border p-3"><CustomerPicker value={null} onChange={(c) => { onChange(c); setOpen(false); }} disabled={disabled} /></div>}
    </div>
  );
}
