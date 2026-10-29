import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  ArrowLeftIcon, CheckIcon, ChevronRightIcon, ClipboardListIcon, LoaderCircleIcon, MinusIcon, PackageOpenIcon, PencilLineIcon, PlusIcon,
  PrinterIcon, SearchIcon, SparklesIcon, Trash2Icon, Undo2Icon, UserRoundIcon, XIcon,
} from 'lucide-react';
import { cn } from 'cn';
import {
  RETURN_REASONS, type OrderLine, type OrderReturnSummary, type Paged, type Product, type ProductReturn, type ReturnReason, type SalesOrder,
} from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ScanFeedback, ScanInput, ScanInputHandle } from '@/components/ScanInput';
import { SparkBurst, SparkBurstHandle } from '@/components/SparkBurst';
import { BoothName, CheckBadge, Field, KeepIds, Message, Notice } from '@/components/wms';
import { OrderBarcode } from '@/components/OrderBarcode';
import { lineCode, sortBySkuCode } from '@/lib/doc-lines';
import { MagicStage, Medallion, ToneChip, TONES, type Tone, SlotSparkles, SPELL_SLOT } from '@/components/magic';
import BlurText from '@/components/BlurText';
import SpotlightCard from '@/components/SpotlightCard';
import { defaultPack, formatQty } from '@/lib/packs';
import { scrollToStart, touchInput } from '@/lib/touch';
import { api, ApiError, formatTime, newRequestId } from '../api';
import { useAuth } from '../auth';
import { createDraftStore, draftKeyFor } from '@/lib/drafts';

type Condition = 'good' | 'damaged';

/** 1 บรรทัดที่กำลังคืน: ผูกรายการในออเดอร์ (orderLineNo) หรือสินค้าที่สแกนเข้ามาในใบคืนอิสระ */
interface Row {
  key: string;
  orderLineNo: number | null;
  sku: string;
  packCode: string;
  itemCode: string;
  name: string;
  unit: string;
  good: string;
  damaged: string;
}

interface Draft {
  rows: Row[];
  reason: ReturnReason;
  returnerName: string;
  note: string;
  requestId: string;
}
// เก็บใบคืนที่ทำค้างไว้ ออกไปหน้าอื่นแล้วกลับมาทำต่อได้ (ไม่เขียนลงเครื่อง) key = order:<เลขออเดอร์> หรือ free
const drafts = createDraftStore<Draft>();

const num = (v: string | undefined) => {
  const n = Number(v ?? '');
  return v && v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : 0;
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const size = (x: { unitName: string; unitQty: number }) => `${x.unitName}|${x.unitQty}`;

const REASON_TONE: Record<ReturnReason, Tone> = { OVER_PICK: 'kibble', UNSOLD: 'sky', EVENT_END: 'plum', OTHER: 'mint' };
const ORDER_REASONS: ReturnReason[] = ['OVER_PICK', 'UNSOLD', 'OTHER'];
const FREE_REASONS: ReturnReason[] = ['EVENT_END', 'UNSOLD', 'OVER_PICK', 'OTHER'];
const UNIT_SUGGESTIONS = ['ชิ้น', 'ซอง', 'ถุง', 'แพ็ค', 'กล่อง', 'ลัง'];

/** หน่วยของรายการในออเดอร์ตามยอดเบิก: ตรวจแล้วให้ขนาดอื่นแทน = ชิ้น */
const unitOf = (summary: OrderReturnSummary, l: { lineNo: number; unit: string }) => summary.lines.find((x) => x.orderLineNo === l.lineNo)?.unit ?? l.unit;

function orderDraft(order: SalesOrder, summary: OrderReturnSummary): Draft {
  return {
    rows: order.lines.map((l) => ({
      key: `L${l.lineNo}`, orderLineNo: l.lineNo, sku: l.sku, packCode: l.packCode, itemCode: l.itemCode ?? '', name: l.name, unit: unitOf(summary, l), good: '', damaged: '',
    })),
    reason: 'UNSOLD', returnerName: '', note: '', requestId: newRequestId(),
  };
}
const freeDraft = (): Draft => ({ rows: [], reason: 'EVENT_END', returnerName: '', note: '', requestId: newRequestId() });

/**
 * คืนสินค้า: คืนจากออเดอร์ (เบิกเกิน / ขายไม่หมด) หรือใบคืนอิสระ (เช่น ปิดงานอีเวนต์)
 * สแกนของที่คืนทีละชิ้น สลับโหมด "ของดี / เสียหาย" ได้ ผูกออเดอร์จะเห็นยอดเบิก คืนแล้ว และขายได้จริง
 * ตอนนี้บันทึกประวัติอย่างเดียว ไม่เปลี่ยนยอดสต็อก
 */
export function ReturnsPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<'home' | 'order' | 'free'>('home');
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [summary, setSummary] = useState<OrderReturnSummary | null>(null);
  const [draft, setDraft] = useState<Draft>(freeDraft);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [condition, setCondition] = useState<Condition>('good');
  const [message, setMessage] = useState<Message | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<ProductReturn | null>(null);
  const [lastRow, setLastRow] = useState<string | null>(null);
  const [hits, setHits] = useState<{ term: string; rows: Product[] } | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const scanRef = useRef<ScanInputHandle>(null);

  const [orders, setOrders] = useState<Paged<SalesOrder> | null>(null);
  const [returns, setReturns] = useState<Paged<ProductReturn> | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const listTop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mode !== 'home' || saved) return;
    let live = true;
    setLoading(true);
    Promise.all([
      api<Paged<SalesOrder>>(`/orders?${new URLSearchParams({ q: query, page: String(page) })}`),
      api<Paged<ProductReturn>>('/returns?page=1'),
    ])
      .then(([o, r]) => { if (live) { setOrders(o); setReturns(r); } })
      .catch((e) => { if (live) setMessage({ kind: 'error', text: errorText(e) }); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [mode, saved, query, page]);

  const documentKey = mode === 'order' && order ? `order:${order.id}` : mode === 'free' ? 'free' : '';
  const draftKey = documentKey ? draftKeyFor(user?.id ?? '', documentKey) : '';
  useEffect(() => { if (draftKey && !saved) drafts.set(draftKey, draft); }, [draftKey, draft, saved]);

  function reset() {
    setMessage(null); setSaved(null); setLastRow(null); setHits(null); setManualOpen(false); setCondition('good');
    window.scrollTo({ top: 0 });
  }

  // แตะออเดอร์ซ้อนกัน (A แล้ว B) ให้ใช้ผลของครั้งล่าสุดเท่านั้น
  const openSeq = useRef(0);
  async function openOrder(o: SalesOrder) {
    reset();
    const seq = ++openSeq.current;
    try {
      const s = await api<OrderReturnSummary>(`/returns/order/${encodeURIComponent(o.id)}`);
      if (seq !== openSeq.current) return;
      setSummary(s);
      setOrder(o);
      // ตั้ง ref ทันที สแกนของต่อได้เลยโดยไม่ต้องรอ render
      // หน่วยอาจเปลี่ยนถ้าตรวจของเบิกใหม่ (หน่วยที่สั่ง ↔ ชิ้น) ใช้หน่วยจากยอดเบิกล่าสุดเสมอ
      const kept = drafts.get(draftKeyFor(user?.id ?? '', `order:${o.id}`));
      draftRef.current = kept
        ? { ...kept, rows: kept.rows.map((r) => (r.orderLineNo === null ? r : { ...r, unit: unitOf(s, { lineNo: r.orderLineNo, unit: r.unit }) })) }
        : orderDraft(o, s);
      setDraft(draftRef.current);
      setMode('order');
    } catch (e) {
      if (seq === openSeq.current) setMessage({ kind: 'error', text: errorText(e) });
    }
  }

  function startFree() {
    reset();
    setOrder(null);
    setSummary(null);
    draftRef.current = drafts.get(draftKeyFor(user?.id ?? '', 'free')) ?? freeDraft();
    setDraft(draftRef.current);
    setMode('free');
  }

  function goHome() {
    reset();
    setMode('home');
    setOrder(null);
  }

  /** ยอดที่ยังคืนได้ของรายการในออเดอร์ (เบิก − คืนไปแล้ว) */
  const remainingOf = (row: Row) => {
    if (row.orderLineNo === null || !summary) return Infinity;
    const s = summary.lines.find((x) => x.orderLineNo === row.orderLineNo);
    return s ? round3(s.taken - s.returned) : 0;
  };

  function bump(key: string, by = 1): ScanFeedback {
    const d = draftRef.current;
    const row = d.rows.find((r) => r.key === key)!;
    const now = num(row.good) + num(row.damaged);
    if (now + by > remainingOf(row) + 0.0005) {
      navigator.vibrate?.([60, 60, 60]);
      return { ok: false, text: `คืนเกินที่เบิกไป! ${row.name} คืนได้อีก ${formatQty(Math.max(0, remainingOf(row) - now))} ${row.unit}` };
    }
    const field = condition;
    draftRef.current = { ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, [field]: String(round3(num(r[field]) + by)) } : r)) };
    setDraft(draftRef.current);
    setLastRow(key);
    const updated = draftRef.current.rows.find((r) => r.key === key)!;
    return { ok: true, text: `${condition === 'good' ? 'ของดี' : 'เสียหาย'} · ${row.name} ${formatQty(num(updated[field]))} ${row.unit}` };
  }

  function addFreeRow(row: Omit<Row, 'good' | 'damaged'>): ScanFeedback {
    const d = draftRef.current;
    if (!d.rows.some((r) => r.key === row.key)) {
      draftRef.current = { ...d, rows: [{ ...row, good: '', damaged: '' }, ...d.rows] };
      setDraft(draftRef.current);
    }
    return bump(row.key);
  }

  async function lookup(code: string): Promise<Product | null> {
    try { return await api<Product>('/products/lookup/' + encodeURIComponent(code)); }
    catch (e) { if (e instanceof ApiError && e.status === 404) return null; throw e; }
  }

  async function handleScan(code: string): Promise<ScanFeedback> {
    const value = code.trim();
    setMessage(null);
    setHits(null);
    try {
      if (mode === 'home') {
        if (/^SO-\d{4}-\d+$/i.test(value)) {
          await openOrder(await api<SalesOrder>('/orders/' + encodeURIComponent(value.toUpperCase())));
          return { ok: true, text: `เปิดออเดอร์ ${value.toUpperCase()}` };
        }
        // สแกนบาร์โค้ดบนใบคืนที่พิมพ์ออกมา เปิดใบคืนนั้นดู/พิมพ์ซ้ำ
        if (/^RT-\d{4}-\d+$/i.test(value)) {
          setSaved(await api<ProductReturn>('/returns/' + encodeURIComponent(value.toUpperCase())));
          return { ok: true, text: `เปิดใบคืน ${value.toUpperCase()}` };
        }
        const product = await lookup(value);
        if (product) {
          startFree();
          return addProduct(product, value);
        }
        setPage(1); setQuery(value);
        return { ok: true, text: `ค้นหาออเดอร์ “${value}”` };
      }
      if (mode === 'order' && order) {
        const manual = draftRef.current.rows.find((r) => !r.sku && r.itemCode && r.itemCode === value);
        if (manual) return bump(manual.key);
        if (/^SO-\d{4}-\d+$/i.test(value)) return { ok: false, text: `กำลังทำใบคืนของ ${order.id} อยู่ กด “เปลี่ยนออเดอร์” ก่อน` };
        const product = await lookup(value);
        if (!product) { setMessage({ kind: 'error', text: `ไม่พบสินค้ารหัส ${value} ลองสแกนอีกครั้ง หรือใช้บาร์โค้ดอื่นบนสินค้า` }); return { ok: false }; }
        const scanned = product.packs?.find((x) => x.code === value) ?? null;
        // รายการที่นับเป็นชิ้น: สแกนขนาดไหนของ SKU นี้ก็ได้ บวกตามจำนวนชิ้นของขนาดนั้น (โหล = +12)
        const inPieces = draftRef.current.rows.find((r) => r.sku === product.sku && r.orderLineNo !== null && summary?.lines.find((x) => x.orderLineNo === r.orderLineNo)?.pieces);
        if (inPieces) {
          const any = product.packs?.find((x) => x.factor > 0);
          const pieces = scanned ? scanned.unitQty : any ? any.unitQty / any.factor : 1;
          return bump(inPieces.key, round3(pieces));
        }
        const match = draftRef.current.rows.find((r) => {
          if (r.sku !== product.sku) return false;
          const linePack = product.packs?.find((x) => x.code === r.packCode);
          if (scanned) return linePack ? size(linePack) === size(scanned) : r.packCode === scanned.code;
          return r.packCode === product.sku || linePack?.factor === 1;
        });
        if (match) return bump(match.key);
        navigator.vibrate?.([60, 60, 60]);
        return { ok: false, text: `ไม่อยู่ในออเดอร์! ${product.name} ใช้ใบคืนอิสระแทน` };
      }
      // ใบคืนอิสระ: สินค้าในทะเบียน / รหัสสินค้ากรอกเองที่มีอยู่แล้ว / ไม่เจอ = ค้นชื่อ
      const manual = draftRef.current.rows.find((r) => !r.sku && r.itemCode && r.itemCode === value);
      if (manual) return bump(manual.key);
      const product = await lookup(value);
      if (product) return addProduct(product, value);
      if (value.length >= 2) {
        const rows = (await api<Product[]>('/products?q=' + encodeURIComponent(value))).filter((x) => x.active).slice(0, 20);
        if (rows.length) { setHits({ term: value, rows }); return { ok: true, text: `ค้น “${value}” พบ ${rows.length} รายการ แตะเลือกด้านล่าง` }; }
      }
      setMessage({ kind: 'error', text: `ไม่พบสินค้า “${value}” ลองพิมพ์ชื่อให้สั้นลง หรือกด “กรอกสินค้าเอง”` });
      return { ok: false };
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
      return { ok: false };
    }
  }

  function addProduct(product: Product, code: string | null): ScanFeedback {
    // สแกนบาร์ไหนใช้ขนาดนั้น เลือกจากผลค้นใช้บาร์โค้ดหลักของสินค้า (ไม่ใช่บาร์โปรตัวแรกที่เจอ)
    const pack = (code && product.packs?.find((x) => x.code === code)) || product.packs?.find((x) => x.code === product.barcode) || defaultPack(product, null);
    return addFreeRow({ key: `P${product.sku}|${size(pack)}`, orderLineNo: null, sku: product.sku, packCode: pack.code, itemCode: '', name: pack.name, unit: pack.unitName });
  }

  async function pickHit(sku: string) {
    try {
      const product = await api<Product>('/products/lookup/' + encodeURIComponent(sku));
      setHits(null);
      addProduct(product, null);
      scanRef.current?.focus();
    } catch (e) { setMessage({ kind: 'error', text: errorText(e) }); }
  }

  const totals = useMemo(() => {
    const active = draft.rows.filter((r) => num(r.good) + num(r.damaged) > 0);
    return {
      lines: active.length,
      goodLines: active.filter((r) => num(r.good) > 0).length,
      damagedLines: active.filter((r) => num(r.damaged) > 0).length,
    };
  }, [draft]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const result = await api<ProductReturn>('/returns', {
        method: 'POST',
        body: {
          requestId: draft.requestId,
          orderId: mode === 'order' ? order?.id ?? null : null,
          reason: draft.reason,
          returnerName: '',
          note: draft.note,
          lines: draft.rows.filter((r) => num(r.good) + num(r.damaged) > 0).map((r) => ({
            orderLineNo: r.orderLineNo, sku: r.sku, packCode: r.packCode, itemCode: r.itemCode, name: r.name, unit: r.unit, goodQty: num(r.good), damagedQty: num(r.damaged),
          })),
        },
      });
      drafts.delete(draftKey);
      setSaved(result);
      window.scrollTo({ top: 0 });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    } finally {
      setSaving(false);
    }
  }

  // ---------- ใบคืนที่บันทึกแล้ว / เปิดดูย้อนหลัง ----------
  if (saved) {
    return (
      <div className="mx-auto grid max-w-3xl gap-4">
        <ReturnReceipt ret={saved} celebrate={mode !== 'home'} actions={
          <>
            <Button size="touch" variant="outline" onClick={() => window.print()}><PrinterIcon />พิมพ์ใบคืน</Button>
            <Button size="touch" onClick={goHome}><Undo2Icon />ทำใบคืนใหม่</Button>
          </>
        } />
      </div>
    );
  }

  // ---------- หน้าแรก ----------
  if (mode === 'home') {
    return (
      <div className="grid gap-5">
        <ScanInput ref={scanRef} label="สแกนใบออเดอร์ หรือสินค้าที่จะคืน" placeholder="เช่น SO-2026-000012 หรือชื่อผู้สั่ง" onScan={handleScan} autoFocus />
        <Notice message={message} />
        <div className="grid gap-3 sm:grid-cols-2">
          <StartCard icon={ClipboardListIcon} tone="kibble" title="คืนจากออเดอร์" text="เบิกเกิน หรือขายไม่หมด เห็นยอดเบิก คืนแล้ว และขายได้จริง" hint="สแกนใบออเดอร์ หรือเลือกจากรายการด้านล่าง" />
          <StartCard icon={PackageOpenIcon} tone="plum" title="ใบคืนอิสระ" text="ปิดงานอีเวนต์ หรือคืนของที่ไม่ได้ผูกกับออเดอร์" onClick={startFree} action="เริ่มใบคืนอิสระ" />
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
          <section ref={listTop} className="grid scroll-mt-20 gap-3" aria-labelledby="ret-orders">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 id="ret-orders" className="font-heading text-xl font-semibold">{query ? `ผลค้นหา “${query}”` : 'เลือกออเดอร์ที่จะคืน'}</h2>
              {query && <Button variant="ghost" size="touch" className="-mr-2" onClick={() => { setQuery(''); setPage(1); }}><XIcon />ล้างคำค้น</Button>}
            </div>
            {loading && !orders ? <div className="grid gap-2" aria-hidden>{[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-muted/60" />)}</div> : orders && (
              <>
                {!orders.rows.length && <p className={`${SPELL_SLOT} px-4 py-8 text-center text-muted-foreground`}><SlotSparkles />{query ? 'ไม่พบออเดอร์ที่ตรงกับคำค้น ลองเลขออเดอร์หรือชื่อผู้สั่งอื่น' : 'ยังไม่มีออเดอร์ คืนของด้วยใบคืนอิสระได้'}</p>}
                <ul className={cn('grid gap-2', loading && 'opacity-60')}>
                  {orders.rows.map((o) => (
                    <li key={o.id}>
                      <SpotlightCard className="transition-[border-color] hover:border-star/60">
                        <button type="button" onClick={() => void openOrder(o)} className="relative flex min-h-20 w-full items-center gap-3 p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset">
                          <Medallion tone="kibble" icon={ClipboardListIcon} />
                          <span className="grid min-w-0 flex-1 gap-1">
                            <strong className="line-clamp-2 font-medium break-words"><BoothName code={o.customerCode} name={o.customerName} /></strong>
                            <span className="text-sm text-muted-foreground">{o.id} · {o.date} · {o.lines.length} รายการ</span>
                            <span><CheckBadge check={o.lastCheck} /></span>
                          </span>
                          <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                        </button>
                      </SpotlightCard>
                    </li>
                  ))}
                </ul>
                {orders.pages > 1 && (
                  <div className="flex justify-between gap-3">
                    <Button variant="outline" size="touch" disabled={page <= 1} onClick={() => { setPage(page - 1); scrollToStart(listTop.current); }}>หน้าก่อน</Button>
                    <Button variant="outline" size="touch" disabled={page >= orders.pages} onClick={() => { setPage(page + 1); scrollToStart(listTop.current); }}>หน้าถัดไป</Button>
                  </div>
                )}
              </>
            )}
          </section>
          <section className="grid gap-3" aria-labelledby="ret-history">
            <h2 id="ret-history" className="font-heading text-xl font-semibold">ใบคืนล่าสุด</h2>
            {returns && !returns.rows.length && <p className={`${SPELL_SLOT} px-4 py-8 text-center text-sm text-muted-foreground`}><SlotSparkles />ยังไม่มีใบคืนสินค้า</p>}
            <ul className="grid gap-2">
              {returns?.rows.map((r) => {
                const good = r.lines.filter((l) => l.goodQty > 0).length, bad = r.lines.filter((l) => l.damagedQty > 0).length;
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => setSaved(r)} className="grid w-full gap-1 rounded-xl border border-border bg-card p-3 text-left outline-none hover:border-star/50 focus-visible:ring-3 focus-visible:ring-ring/50">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm">{r.id}</span>
                        <ToneChip tone={REASON_TONE[r.reason]}>{RETURN_REASONS[r.reason]}</ToneChip>
                      </span>
                      <span className="line-clamp-1 text-sm">{r.orderId ? `${r.orderId} · ${r.customerName}` : 'ใบคืนอิสระ'}{r.returnerName && ` · ${r.returnerName}`}</span>
                      <span className="text-xs text-muted-foreground">{formatTime(r.createdAt)} · {r.lines.length} รายการ{bad > 0 ? ` · เสียหาย ${bad}` : ''}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    );
  }

  // ---------- กำลังทำใบคืน ----------
  const setField = (key: string, field: Condition, value: string) => setDraft((d) => ({ ...d, rows: d.rows.map((r) => (r.key === key ? { ...r, [field]: value } : r)) }));
  const removeRow = (key: string) => setDraft((d) => ({ ...d, rows: d.rows.filter((r) => r.key !== key) }));
  const reasons = mode === 'order' ? ORDER_REASONS : FREE_REASONS;
  const overLimit = draft.rows.some((r) => num(r.good) + num(r.damaged) > remainingOf(r) + 0.0005);
  const canSave = totals.lines > 0 && !overLimit && !saving;
  const saveButton = (
    <div className="grid gap-2">
    <p className="text-sm opacity-90">บันทึกประวัติการคืนเท่านั้น ยังไม่เพิ่มสต็อกในคลัง</p>
    <Button size="touch" className="w-full bg-star text-on-star hover:bg-star/90" disabled={!canSave} onClick={() => void save()}>
      {saving ? <><LoaderCircleIcon className="animate-spin" />กำลังบันทึกใบคืน…</> : <><CheckIcon />บันทึกใบคืน ({totals.lines} รายการ)</>}
    </Button>
    </div>
  );

  return (
    <div className="grid gap-4 pb-28 lg:pb-0">
      <ScanInput ref={scanRef} label={mode === 'order' ? `สแกนของที่คืน · ${order?.id}` : 'สแกนของที่คืน · ใบคืนอิสระ'} placeholder={mode === 'free' ? 'สแกน หรือพิมพ์ชื่อสินค้า' : 'สแกนสินค้าทีละชิ้น'} onScan={handleScan} autoFocus disabled={saving} />
      {/* โหมดการสแกน: ของดีหรือของเสียหาย แตะสลับก่อนสแกนของที่ชำรุด */}
      <div role="radiogroup" aria-label="สแกนครั้งต่อไปนับเป็น" className="grid grid-cols-2 gap-2">
        {(['good', 'damaged'] as Condition[]).map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={condition === c}
            onClick={() => { setCondition(c); scanRef.current?.focus(); }}
            className={cn(
              'flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 text-base font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              condition === c ? (c === 'good' ? 'border-mint bg-mint-soft text-mint' : 'border-rose bg-rose-soft text-rose') : 'border-border bg-card text-muted-foreground hover:border-star/50',
            )}
          >
            {condition === c && <CheckIcon className="size-5" aria-hidden />}
            {c === 'good' ? 'สแกนเป็น ของดี (FG)' : 'สแกนเป็น เสียหาย (DM)'}
          </button>
        ))}
      </div>
      <Notice message={message} />
      {hits && (
        <section aria-label="ผลค้นหาสินค้า" className="grid gap-2 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">ผลค้นหา “{hits.term}” · แตะเพื่อเพิ่มในใบคืน</p>
            <Button variant="ghost" size="icon-touch" aria-label="ปิดผลค้นหา" onClick={() => { setHits(null); scanRef.current?.focus(); }}><XIcon /></Button>
          </div>
          <ul className="grid max-h-72 gap-1 overflow-y-auto overscroll-contain">
            {hits.rows.map((p) => (
              <li key={p.sku}>
                <button type="button" onClick={() => void pickHit(p.sku)} className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50">
                  <span className="min-w-0 flex-1"><span className="block break-words">{p.name}</span><span className="text-sm text-muted-foreground">{[p.sku, p.brand].filter(Boolean).join(' · ')}</span></span>
                  <PlusIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
        <aside className="contents lg:sticky lg:top-20 lg:order-2 lg:grid lg:gap-4">
          <div className="order-1">
            <MagicStage className="grid gap-3">
              <div className="grid gap-0.5">
                <div className="-mr-2 flex items-center justify-between gap-2">
                  <p className="font-mono text-sm text-brand-foreground/75">{mode === 'order' ? order?.id : 'ใบคืนอิสระ'}</p>
                  <Button variant="ghost" size="touch" className="px-3 text-brand-foreground hover:bg-on-sky/10 hover:text-brand-foreground" disabled={saving} onClick={goHome}><ArrowLeftIcon />{mode === 'order' ? 'เปลี่ยนออเดอร์' : 'กลับหน้าคืนสินค้า'}</Button>
                </div>
                <p className="font-heading text-lg leading-snug font-semibold break-words">{mode === 'order' ? order && <BoothName code={order.customerCode} name={order.customerName} /> : 'คืนของที่ไม่ได้ผูกกับออเดอร์'}</p>
                {mode === 'order' && summary && !summary.checked && <p className="text-sm text-brand-foreground/75">ออเดอร์นี้ยังไม่ได้ตรวจของเบิก ยอดเบิกจึงใช้ตามที่สั่งในออเดอร์</p>}
              </div>
              <p className="font-heading text-3xl font-semibold tabular-nums" aria-live="polite">
                {totals.lines}<span className="ml-2 align-middle text-base font-normal text-brand-foreground/80">รายการที่คืน</span>
              </p>
              <div className="flex flex-wrap gap-2 text-sm">
                <span className="rounded-full bg-mint-soft px-3 py-1 font-semibold text-mint">ของดี {totals.goodLines}</span>
                <span className="rounded-full bg-rose-soft px-3 py-1 font-semibold text-rose">เสียหาย {totals.damagedLines}</span>
              </div>
            </MagicStage>
          </div>
          <Card className="order-2">
            <CardContent className="grid gap-4">
              <div className="grid gap-1.5">
                <span id="ret-reason" className="text-sm font-medium">สาเหตุที่คืน *</span>
                <div role="radiogroup" aria-labelledby="ret-reason" className="flex flex-wrap gap-2">
                  {reasons.map((r) => (
                    <button key={r} type="button" role="radio" aria-checked={draft.reason === r} onClick={() => setDraft((d) => ({ ...d, reason: r }))}
                      className={cn('min-h-12 rounded-full border-2 px-4 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                        draft.reason === r ? 'border-star bg-star-soft font-semibold' : 'border-border bg-card hover:border-star/50')}>
                      {RETURN_REASONS[r]}
                    </button>
                  ))}
                </div>
              </div>
              {/* ผู้รับคืน = บัญชีที่เข้าสู่ระบบ เซิร์ฟเวอร์ใส่ชื่อให้เอง (เหมือนผู้ตรวจในหน้าตรวจของเบิก) */}
              <div className="grid gap-1.5">
                <span className="text-sm font-medium">ผู้รับคืนสินค้า</span>
                <p className="flex min-h-12 items-center gap-2 rounded-md border border-input bg-muted/40 px-3 text-base break-words"><UserRoundIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />{user?.displayName}</p>
              </div>
              <Field id="ret-note" label="หมายเหตุ (ถ้ามี)">
                <Input id="ret-note" className={touchInput} value={draft.note} maxLength={1000} placeholder="เช่น ถุงขาดจากหน้างาน" onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
              </Field>
              <div className="hidden lg:block">{saveButton}</div>
              {overLimit && <p className="text-sm text-rose" role="alert">มีรายการที่คืนเกินยอดเบิก ลดจำนวนในแถวสีแดงก่อนบันทึก</p>}
            </CardContent>
          </Card>
        </aside>

        <div className="order-3 grid gap-3 lg:order-1">
          {mode === 'free' && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-heading text-lg font-semibold">ของที่คืน <span className="text-muted-foreground tabular-nums">({draft.rows.length})</span></h2>
              <Button variant="outline" size="touch" aria-expanded={manualOpen} onClick={() => setManualOpen(!manualOpen)}><PencilLineIcon />กรอกสินค้าเอง</Button>
            </div>
          )}
          {mode === 'free' && manualOpen && (
            <ManualItem onAdd={(item) => {
              const fb = addFreeRow({ key: `M${item.itemCode || item.name}|${item.unit}`, orderLineNo: null, sku: '', packCode: '', itemCode: item.itemCode, name: item.name, unit: item.unit });
              setManualOpen(false);
              return fb;
            }} />
          )}
          {mode === 'free' && !draft.rows.length && !manualOpen && (
            <div className={`${SPELL_SLOT} grid justify-items-center gap-2 px-4 py-10 text-center`}>
              <SlotSparkles />
              <SparklesIcon className="size-8 text-star-ink dark:text-star" aria-hidden />
              <p className="text-muted-foreground">สแกนของที่คืนได้เลย สแกนซ้ำเพื่อเพิ่มจำนวน หรือพิมพ์ชื่อสินค้าเพื่อค้นหา</p>
            </div>
          )}
          {mode === 'order' && <h2 className="font-heading text-lg font-semibold">รายการในออเดอร์ <span className="text-muted-foreground tabular-nums">({draft.rows.length})</span></h2>}
          <ul className="grid gap-2">
            {draft.rows.map((r) => {
              const s = r.orderLineNo !== null ? summary?.lines.find((x) => x.orderLineNo === r.orderLineNo) : undefined;
              return (
                <ReturnRow
                  key={r.key}
                  row={r}
                  taken={s?.taken}
                  returnedBefore={s?.returned}
                  highlight={lastRow === r.key}
                  disabled={saving}
                  onChange={(field, value) => setField(r.key, field, value)}
                  onRemove={mode === 'free' ? () => removeRow(r.key) : undefined}
                />
              );
            })}
          </ul>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-on-sky/10 bg-brand px-4 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] text-brand-foreground shadow-dock lg:hidden print:hidden">
        <div className="mx-auto grid max-w-3xl gap-2">
          <p className="text-sm" aria-live="polite">
            คืน <span className="font-heading font-semibold text-star tabular-nums">{totals.lines}</span> รายการ · ของดี <span className="font-semibold text-on-sky-mint">{totals.goodLines}</span> · เสียหาย <span className="font-semibold text-on-sky-rose">{totals.damagedLines}</span>
            {overLimit && <span className="text-on-sky-rose"> · มีรายการคืนเกิน</span>}
          </p>
          {saveButton}
        </div>
      </div>
    </div>
  );
}

function StartCard({ icon: Icon, tone, title, text, hint, action, onClick }: {
  icon: typeof ClipboardListIcon; tone: Tone; title: string; text: string; hint?: string; action?: string; onClick?: () => void;
}) {
  return (
    <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-4">
      <Medallion tone={tone} icon={Icon} />
      <div className="grid min-w-0 flex-1 gap-2">
        <div>
          <p className="font-heading text-lg font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{text}</p>
        </div>
        {onClick ? <Button size="touch" variant="outline" className="justify-self-start" onClick={onClick}>{action}<ChevronRightIcon /></Button> : <p className="text-sm font-medium text-star-ink dark:text-star">{hint}</p>}
      </div>
    </div>
  );
}

/** ช่องจำนวน − [n] + ขนาดกะทัดรัด (ปุ่มยังสูง 48px) */
function Stepper({ label, value, onChange, max, tone, disabled }: { label: string; value: string; onChange: (v: string) => void; max: number; tone: 'mint' | 'rose'; disabled?: boolean }) {
  const n = num(value);
  return (
    <div className="grid gap-1">
      <span className={cn('text-xs font-semibold', tone === 'mint' ? 'text-mint' : 'text-rose')}>{label}</span>
      <div className="flex items-stretch" role="group" aria-label={label}>
        <Button type="button" variant="outline" size="icon-touch" className="rounded-r-none" aria-label={`ลดจำนวน${label}`} disabled={disabled || n <= 0} onClick={() => onChange(String(Math.max(0, round3(n - 1))))}><MinusIcon /></Button>
        <Input className="h-12 w-16 rounded-none border-x-0 text-center text-lg font-semibold tabular-nums md:text-lg" type="number" inputMode="decimal" min={0} step="any"
          aria-label={label} value={value} placeholder="0" disabled={disabled} onFocus={(e) => e.target.select()} onChange={(e) => onChange(e.target.value)} />
        <Button type="button" variant="outline" size="icon-touch" className="rounded-l-none" aria-label={`เพิ่มจำนวน${label}`} disabled={disabled || n + 1 > max + 0.0005} onClick={() => onChange(String(round3(n + 1)))}><PlusIcon /></Button>
      </div>
    </div>
  );
}

/** แถวคืนสินค้า: ผูกออเดอร์จะเห็น เบิก · คืนแล้ว · ขายได้จริง และกันคืนเกินยอดเบิก */
function ReturnRow({ row, taken, returnedBefore, highlight, disabled, onChange, onRemove }: {
  row: Row; taken?: number; returnedBefore?: number; highlight?: boolean; disabled?: boolean; onChange: (field: Condition, value: string) => void; onRemove?: () => void;
}) {
  const good = num(row.good), damaged = num(row.damaged), now = good + damaged;
  const bound = taken !== undefined;
  const remaining = bound ? round3(taken! - (returnedBefore ?? 0)) : Infinity;
  const over = bound && now > remaining + 0.0005;
  const sold = bound ? round3(taken! - (returnedBefore ?? 0) - now) : null;
  return (
    <li className={cn('grid gap-3 rounded-xl border-2 bg-card p-3 transition-shadow duration-300', over ? 'border-rose/60' : now > 0 ? 'border-star/50' : 'border-border',
      highlight && 'shadow-[0_0_0_4px_color-mix(in_oklab,var(--pm-star)_35%,transparent)]')}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{row.name}</p>
          <p className="text-sm text-muted-foreground"><span className="font-mono">{row.packCode || row.sku || row.itemCode || 'กรอกเอง'}</span> · {row.unit}</p>
        </div>
        {onRemove && <Button type="button" variant="ghost" size="icon-touch" className="-mt-1 -mr-1 text-muted-foreground hover:text-destructive" aria-label={`ลบ ${row.name} ออกจากใบคืน`} disabled={disabled} onClick={onRemove}><Trash2Icon /></Button>}
      </div>
      {bound && (
        <dl className="grid grid-cols-3 gap-2 rounded-lg bg-muted/50 p-2 text-center text-sm">
          <div><dt className="text-xs text-muted-foreground">เบิกไป</dt><dd className="font-heading font-semibold tabular-nums">{formatQty(taken!)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">คืนแล้วก่อนหน้า</dt><dd className="font-heading font-semibold tabular-nums">{formatQty(returnedBefore ?? 0)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">ขายได้จริง</dt><dd className={cn('font-heading font-semibold tabular-nums', over ? 'text-rose' : 'text-star-ink dark:text-star')}>{formatQty(Math.max(0, sold!))}</dd></div>
        </dl>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Stepper label="ของดี" tone="mint" value={row.good} onChange={(v) => onChange('good', v)} max={remaining - damaged} disabled={disabled} />
        <Stepper label="เสียหาย" tone="rose" value={row.damaged} onChange={(v) => onChange('damaged', v)} max={remaining - good} disabled={disabled} />
      </div>
      {over && <p className="text-sm text-rose" role="alert">คืนเกินยอดเบิก คืนได้อีกไม่เกิน {formatQty(Math.max(0, remaining))} {row.unit}</p>}
    </li>
  );
}

/** เพิ่มสินค้ากรอกเองในใบคืนอิสระ (ของที่ไม่มีในทะเบียน) */
function ManualItem({ onAdd }: { onAdd: (item: { itemCode: string; name: string; unit: string }) => ScanFeedback }) {
  const [itemCode, setItemCode] = useState('');
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('ชิ้น');
  return (
    <form className="grid gap-3 rounded-xl border border-border bg-card p-3" onSubmit={(e) => { e.preventDefault(); if (name.trim() && unit.trim()) onAdd({ itemCode: itemCode.trim(), name: name.trim(), unit: unit.trim() }); }}>
      <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
        <Field id="ret-m-code" label="รหัสสินค้า (ถ้ามี)"><Input id="ret-m-code" className={`${touchInput} font-mono`} value={itemCode} onChange={(e) => setItemCode(e.target.value)} maxLength={50} autoComplete="off" /></Field>
        <Field id="ret-m-name" label="ชื่อสินค้า *"><Input id="ret-m-name" className={touchInput} value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required /></Field>
      </div>
      <div className="grid gap-1.5">
        <Field id="ret-m-unit" label="หน่วย *" className="sm:max-w-48"><Input id="ret-m-unit" className={touchInput} value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={30} required /></Field>
        <div className="flex flex-wrap gap-1.5">{UNIT_SUGGESTIONS.map((u) => <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)} className={cn('min-h-12 rounded-full px-3.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50', unit === u ? 'bg-plum font-semibold text-primary-foreground' : 'bg-plum-soft text-plum')}>{u}</button>)}</div>
      </div>
      <Button type="submit" size="touch" className="justify-self-start" disabled={!name.trim() || !unit.trim()}><PlusIcon />เพิ่มในใบคืน</Button>
    </form>
  );
}

/**
 * ใบคืนที่บันทึกแล้ว: ฉากสำเร็จบนท้องฟ้า (เฉพาะตอนเพิ่งบันทึก) + เอกสารแบบเดียวกับใบออเดอร์
 * บาร์โค้ดเลขใบคืน (สแกนในหน้านี้เปิดใบคืนได้), ผู้สั่ง/สาเหตุ/ผู้คืน, รายการแยกของดี/เสียหาย
 * พิมพ์เป็นขาวดำ ตารางแบบใบจัดสินค้า (เรียงตาม SKU_CODE + ช่องจำนวนที่รับคืน) ช่องเซ็น ผู้คืน/ผู้ตรวจสอบ/ผู้รับคืน
 */
function ReturnReceipt({ ret, celebrate, actions }: { ret: ProductReturn; celebrate: boolean; actions: ReactNode }) {
  const spark = useRef<SparkBurstHandle>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!celebrate) return;
    const t = setTimeout(() => spark.current?.burst(), 120);
    return () => clearTimeout(t);
  }, [celebrate]);
  const title = `บันทึกใบคืน ${ret.id} แล้ว`;
  return (
    <div className="grid gap-4">
      {celebrate && (
        <div className="relative print:hidden" role="status">
          <SparkBurst ref={spark} count={20} reach={40} length={14} duration={700} />
          <MagicStage>
            <div className="grid justify-items-center gap-3 py-4 text-center">
              <span className="grid size-16 place-items-center rounded-full bg-mint-soft text-mint ring-4 ring-mint/25"><Undo2Icon className="size-8" aria-hidden /></span>
              {reduce ? <p className="font-heading text-2xl font-semibold"><KeepIds text={title} /></p> : <BlurText text={title} delay={120} animateBy="words" direction="top" className="justify-center font-heading text-2xl font-semibold" />}
              <p className="text-brand-foreground/80">{RETURN_REASONS[ret.reason]} · {ret.lines.length} รายการ</p>
            </div>
          </MagicStage>
        </div>
      )}
      <Card data-print-doc className="mx-auto w-full max-w-3xl print:max-w-none">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="grid gap-1">
              <CardTitle role="heading" aria-level={2}>{ret.id}</CardTitle>
              <CardDescription>ใบคืนสินค้า · บันทึกเมื่อ {formatTime(ret.createdAt)}</CardDescription>
              <span className="print:hidden"><ToneChip tone={REASON_TONE[ret.reason]} className="h-7 px-3 text-sm">{RETURN_REASONS[ret.reason]}</ToneChip></span>
            </div>
            <OrderBarcode id={ret.id} label="ใบคืน" />
          </div>
        </CardHeader>
        {/* ตอนพิมพ์ใช้ block แทน grid: Chrome ตัดหน้ากระดาษกลาง grid แล้วบรรทัดซ้อนกัน */}
        <CardContent className="grid gap-5 print:block print:space-y-5">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            {ret.orderId && <div className="sm:col-span-2"><dt className="text-muted-foreground">ผู้สั่ง</dt><dd className="font-heading text-lg font-semibold break-words">{ret.customerName || 'ไม่ได้ระบุ'}</dd></div>}
            <div><dt className="text-muted-foreground">คืนจาก</dt><dd className="break-words">{ret.orderId ? <>ออเดอร์ <span className="font-mono">{ret.orderId}</span></> : 'ใบคืนอิสระ (ไม่ผูกออเดอร์)'}</dd></div>
            <div><dt className="text-muted-foreground">สาเหตุที่คืน</dt><dd>{RETURN_REASONS[ret.reason]}</dd></div>
            <div><dt className="text-muted-foreground">ผู้รับคืนสินค้า</dt><dd className="break-words">{ret.returnerName || 'ไม่ได้ระบุ'}</dd></div>
          </dl>
          {/* แบบเดียวกับใบจัดสินค้า: เรียงตาม SKU_CODE ช่องท้ายไว้เขียนจำนวนที่ตรวจรับคืนจริง */}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-muted-foreground print:text-black">
                <th className="hidden py-2 pr-2 font-medium sm:table-cell print:table-cell">รหัสสินค้า</th>
                <th className="py-2 pr-2 font-medium">ชื่อสินค้า</th>
                <th className="py-2 px-2 font-medium">หน่วย</th>
                <th className="py-2 px-2 text-right font-medium whitespace-nowrap"><span className="sm:hidden print:hidden">FG</span><span className="hidden sm:inline print:inline">ของดี (FG)</span></th>
                <th className="py-2 px-2 text-right font-medium whitespace-nowrap"><span className="sm:hidden print:hidden">DM</span><span className="hidden sm:inline print:inline">เสียหาย (DM)</span></th>
                <th className="hidden py-2 pl-2 text-center font-medium sm:table-cell print:table-cell">จำนวนที่รับคืน</th>
              </tr>
            </thead>
            <tbody>
              {sortBySkuCode(ret.lines).map((l) => (
                <tr key={l.lineNo} className="break-inside-avoid border-b border-border align-top">
                  <td className="hidden py-3 pr-2 font-mono text-xs whitespace-nowrap sm:table-cell print:table-cell print:py-1.5">{l.packCode || lineCode(l) || '–'}</td>
                  <td className="py-3 pr-2 print:py-1.5">
                    <p className="font-medium break-words">{l.name}</p>
                    {/* คอลัมน์รหัส = บาร์โค้ดที่คืน (แยกขนาดของสินค้าเดียวกันได้) ลำดับยังเรียงตาม SKU_CODE มือถือไม่มีคอลัมน์นี้ จึงแสดงใต้ชื่อแทน */}
                  <p className="font-mono text-xs break-all text-muted-foreground sm:hidden print:hidden">{l.packCode || lineCode(l)}</p>
                  </td>
                  <td className="py-3 px-2 [overflow-wrap:anywhere] print:py-1.5">{l.unit}</td>
                  <td className="py-3 px-2 text-right font-semibold tabular-nums text-mint print:py-1.5 print:text-black">{l.goodQty ? formatQty(l.goodQty) : '–'}</td>
                  <td className="py-3 px-2 text-right font-semibold tabular-nums text-rose print:py-1.5 print:text-black">{l.damagedQty ? formatQty(l.damagedQty) : '–'}</td>
                  <td className="hidden py-2 pl-2 text-center sm:table-cell print:table-cell print:py-1"><span aria-hidden className="inline-block h-9 w-16 rounded-md border-2 border-card-edge bg-background/40 print:h-7 print:border-black print:bg-transparent sm:w-20" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-sm text-muted-foreground">รวม {ret.lines.length} รายการ</p>
          {ret.note && <p className="text-sm whitespace-pre-wrap break-words">หมายเหตุ: {ret.note}</p>}
          <p className="text-sm text-muted-foreground">ใบคืนนี้บันทึกเป็นประวัติเท่านั้น ยอดสต็อกในคลังยังไม่เปลี่ยน</p>
          {/* ช่องเซ็นชื่อ 3 ฝ่าย ถ้าถูกดันไปหน้าใหม่ยังรู้ว่าเป็นของใบคืนไหน */}
          <div className="grid break-inside-avoid grid-cols-3 gap-x-4 gap-y-6 pt-4 text-center text-sm sm:gap-x-8">
            <p className="col-span-3 text-left text-xs text-muted-foreground print:text-black">ลงชื่อรับรองใบคืน {ret.id}{ret.orderId && ` (ออเดอร์ ${ret.orderId})`}</p>
            {['ผู้คืนสินค้า', 'ผู้ตรวจสอบสินค้า', 'ผู้รับคืนสินค้า'].map((who) => (
              <div key={who} className="grid min-w-0 gap-1">
                <span className="border-b border-card-edge pb-8 print:border-black" />
                <span className="text-xs font-medium break-words sm:text-sm">{who}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>
        </CardContent>
      </Card>
    </div>
  );
}
