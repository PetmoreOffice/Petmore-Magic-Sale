import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  AlertTriangleIcon, ArrowLeftIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ClipboardCheckIcon, ClipboardListIcon, LoaderCircleIcon,
  HandIcon, MinusIcon, PackageIcon, PackageXIcon, PencilIcon, PlusIcon, RotateCcwIcon, SparklesIcon, StarIcon, Trash2Icon, XIcon,
} from 'lucide-react';
import { cn } from 'cn';
import type { CheckCounts, CheckFilter, OrderLine, Paged, PickCheck, Product, ProductPack, SalesOrder } from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { ScanFeedback, ScanInput, ScanInputHandle } from '@/components/ScanInput';
import { SparkBurst, SparkBurstHandle } from '@/components/SparkBurst';
import { CheckBadge, Field, Message, Notice } from '@/components/wms';
import { MagicStage, Medallion, TONES, type Tone, SlotSparkles, SPELL_SLOT } from '@/components/magic';
import BlurText from '@/components/BlurText';
import SpotlightCard from '@/components/SpotlightCard';
import StarBorder from '@/components/StarBorder';
import { defaultPack, formatQty, packSizes } from '@/lib/packs';
import { scrollToStart, touchInput } from '@/lib/touch';
import { api, ApiError, formatTime, newRequestId } from '../api';

/** ของที่เอามาแต่ไม่ตรงกับรายการไหนในออเดอร์ */
interface Extra {
  key: string;
  sku: string;
  packCode: string;
  itemCode: string;
  name: string;
  unit: string;
  qty: string;
  /** WRONG_SIZE = สินค้าตรงแต่หยิบผิดขนาด, NOT_IN_ORDER = ไม่มีในออเดอร์เลย */
  reason: 'WRONG_SIZE' | 'NOT_IN_ORDER';
  hint: string;
}

/** ขนาดอื่นของ SKU เดียวกันที่ให้แทนขนาดในออเดอร์ เช่น สั่ง 1 ลัง ของเหลือแค่โหล ให้เป็นโหล 3 */
interface Sub {
  packCode: string;
  unit: string;
  /** ชิ้นต่อ 1 หน่วยของขนาดนี้ และของขนาดที่สั่ง (แสดงผลอย่างเดียว เซิร์ฟเวอร์คำนวณใหม่จากทะเบียน) */
  pieces: number;
  base: number;
  qty: string;
}

interface Draft {
  counts: Record<number, string>;
  /** ขนาดที่ให้แทน แยกตามเลขรายการในออเดอร์ */
  subs: Record<number, Sub[]>;
  /** รายการที่นับเอง (ไม่ได้สแกน) และเหตุผล ปกติต้องสแกนเท่านั้น */
  manual: Record<number, string>;
  extras: Extra[];
  pickerName: string;
  note: string;
  requestId: string;
}
// เก็บความคืบหน้าการตรวจแต่ละออเดอร์ไว้ ออกไปหน้าอื่นแล้วกลับมานับต่อได้ (ไม่เขียนลงเครื่อง)
const drafts = new Map<string, Draft>();
const emptyDraft = (): Draft => ({ counts: {}, subs: {}, manual: {}, extras: [], pickerName: '', note: '', requestId: newRequestId() });

const num = (v: string | undefined) => {
  const n = Number(v ?? '');
  return v && v.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : 0;
};
const round3 = (n: number) => Math.round(n * 1000) / 1000;
/**
 * ยอดของรายการ: ไม่มีขนาดอื่น = นับในหน่วยที่สั่ง
 * ให้ขนาดอื่นแทนเมื่อไร นับเป็นชิ้นทั้งหมด เช่น สั่ง 1 ลัง = 48 ชิ้น ให้ 3 โหล = 36 ชิ้น ขาด 12 ชิ้น (ไม่ใช้ 0.75 ลัง)
 */
interface Tally { actual: number; expected: number; unit: string; pieces: boolean }
function tally(d: Draft, line: OrderLine): Tally {
  const own = num(d.counts[line.lineNo]);
  const subs = (d.subs[line.lineNo] ?? []).filter((x) => num(x.qty) > 0);
  if (!subs.length) return { actual: own, expected: line.qty, unit: line.unit, pieces: false };
  const base = subs[0].base;
  return {
    actual: round3(own * base + subs.reduce((t, x) => t + num(x.qty) * x.pieces, 0)),
    expected: round3(line.qty * base),
    unit: 'ชิ้น',
    pieces: true,
  };
}
/** จำนวนชิ้น (UTQ_QTY) ต่อ 1 หน่วยของรหัส: บาร์โค้ดขนาดบรรจุ หรือรหัส SKU = หน่วยนับสต็อก */
function piecesOf(p: Product, code: string): number | null {
  const pack = p.packs?.find((x) => x.code === code);
  if (pack) return pack.unitQty;
  if (code !== p.sku) return null;
  const any = p.packs?.find((x) => x.factor > 0);
  return any ? any.unitQty / any.factor : 1;
}
/** เหตุผลที่นับเองได้ (ไม่สแกน) บันทึกไว้ในผลตรวจให้หัวหน้าตรวจย้อน */
const MANUAL_REASONS = ['บาร์โค้ดเสีย/อ่านไม่ออก', 'ไม่มีบาร์โค้ดบนสินค้า', 'ของจำนวนมาก นับรวมทีเดียว', 'สแกนเนอร์/กล้องใช้ไม่ได้'];
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type LineState = 'PENDING' | 'MATCH' | 'SHORT' | 'OVER';
function lineState(actual: number, expected: number): LineState {
  if (actual === expected) return 'MATCH';
  if (actual === 0) return 'PENDING';
  return actual < expected ? 'SHORT' : 'OVER';
}

/** สีและคำของแต่ละสถานะ ใช้ชุดเดียวกันทั้งดาว แถว และสรุป: ครบ = มิ้นต์/ทอง, ขาด = คาราเมล, เกิน/ผิด = ชมพูแดง */
const STATE: Record<LineState, { label: (diff: number) => string; tone: Tone | 'muted'; border: string }> = {
  PENDING: { label: () => 'ยังไม่ได้ตรวจ', tone: 'muted', border: 'border-border' },
  MATCH: { label: () => 'ครบ', tone: 'mint', border: 'border-mint/45' },
  SHORT: { label: (d) => `ขาด ${formatQty(d)}`, tone: 'kibble', border: 'border-kibble/55' },
  OVER: { label: (d) => `เกิน ${formatQty(d)}`, tone: 'rose', border: 'border-rose/60' },
};
const toneClass = (tone: Tone | 'muted') => (tone === 'muted' ? 'bg-muted text-muted-foreground' : TONES[tone]);

const TABS: { key: CheckFilter; label: string; tone: Tone; empty: string }[] = [
  { key: 'PENDING', label: 'รอตรวจ', tone: 'star', empty: 'ไม่มีออเดอร์รอตรวจ ทุกออเดอร์ตรวจแล้ว' },
  { key: 'MISMATCH', label: 'ไม่ตรงออเดอร์', tone: 'rose', empty: 'ไม่มีออเดอร์ที่ตรวจแล้วไม่ตรง' },
  { key: 'MATCH', label: 'ผ่านแล้ว', tone: 'mint', empty: 'ยังไม่มีออเดอร์ที่ตรวจผ่าน' },
  { key: 'ALL', label: 'ทั้งหมด', tone: 'plum', empty: 'ยังไม่มีออเดอร์ จดออเดอร์ที่หน้าออเดอร์สินค้าก่อน' },
];

/**
 * ตรวจของเบิกตอนส่งมอบ ("กลุ่มดาวรายการ")
 * เลือกออเดอร์: แท็บรอตรวจ/ไม่ครบ/ครบแล้ว + สแกนบาร์โค้ดบนใบออเดอร์
 * ตรวจ: ทุกรายการเป็นดาวบนท้องฟ้าด้านบน ครบแล้วดาวสว่างทอง เกินเป็นแดง รายการที่ยังไม่ครบอยู่บนสุด ที่ครบแล้วยุบลงล่าง
 * สแกนทีละชิ้นหรือกด −/+ พิมพ์จำนวนเอง บาร์โค้ดหลายตัวของขนาดเดียวกันนับรวมกัน หยิบผิดขนาด/ของนอกออเดอร์แยกเป็นรายการแดง
 */
export function CheckPage() {
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [result, setResult] = useState<PickCheck | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [lastLine, setLastLine] = useState<string | null>(null);
  const scanRef = useRef<ScanInputHandle>(null);
  // สแกนรัวๆ เร็วกว่า React render: อ่านยอดล่าสุดจาก ref ไม่ใช่จาก state ของรอบก่อน
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const [tab, setTab] = useState<CheckFilter>('PENDING');
  const [counts, setCounts] = useState<CheckCounts | null>(null);
  const [list, setList] = useState<Paged<SalesOrder> | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [loadingList, setLoadingList] = useState(false);
  const listTop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (order) return;
    let live = true;
    setLoadingList(true);
    const params = new URLSearchParams({ q: query, page: String(page), check: query ? 'ALL' : tab });
    Promise.all([api<Paged<SalesOrder>>(`/orders?${params}`), api<CheckCounts>('/orders/check-counts')])
      .then(([rows, c]) => { if (live) { setList(rows); setCounts(c); } })
      .catch((e) => { if (live) setMessage({ kind: 'error', text: errorText(e) }); })
      .finally(() => { if (live) setLoadingList(false); });
    return () => { live = false; };
  }, [order, query, page, tab]);

  // จำความคืบหน้าของออเดอร์ที่กำลังตรวจ
  useEffect(() => { if (order && !result) drafts.set(order.id, draft); }, [order, draft, result]);

  function openOrder(o: SalesOrder) {
    setOrder(o);
    const kept = drafts.get(o.id);
    setDraft(kept ? { ...emptyDraft(), ...kept } : emptyDraft());
    setResult(null);
    setMessage(null);
    setConfirming(false);
    setLastLine(null);
    window.scrollTo({ top: 0 });
  }

  function closeOrder() {
    setOrder(null);
    setResult(null);
    setMessage(null);
    setConfirming(false);
  }

  async function findOrder(code: string): Promise<ScanFeedback> {
    const value = code.trim();
    setMessage(null);
    try {
      openOrder(await api<SalesOrder>('/orders/' + encodeURIComponent(value)));
      return { ok: true, text: `เปิดออเดอร์ ${value}` };
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setPage(1);
        setQuery(value);
        return { ok: true, text: `ค้นหาออเดอร์ “${value}”` };
      }
      setMessage({ kind: 'error', text: errorText(e) });
      return { ok: false };
    }
  }

  function bump(line: OrderLine, by = 1): ScanFeedback {
    const count = round3(num(draftRef.current.counts[line.lineNo]) + by);
    draftRef.current = { ...draftRef.current, counts: { ...draftRef.current.counts, [line.lineNo]: String(count) } };
    setDraft(draftRef.current);
    setConfirming(false);
    setLastLine(`L${line.lineNo}`);
    return feedback(line);
  }

  function feedback(line: OrderLine, prefix = ''): ScanFeedback {
    const t = tally(draftRef.current, line);
    const text = `${prefix}${line.name} ${formatQty(t.actual)}/${formatQty(t.expected)} ${t.unit}`;
    if (t.actual > t.expected) {
      navigator.vibrate?.([60, 60, 60]);
      return { ok: false, text: `เกิน! ${text}` };
    }
    return { ok: true, text: `${text}${t.actual === t.expected ? ' ครบแล้ว' : ''}` };
  }

  /** เพิ่มขนาดที่ให้แทนเข้ารายการ คืน false ถ้าแปลงหน่วยไม่ได้ (ไม่รู้จำนวนชิ้นของขนาดใดขนาดหนึ่ง) */
  function addSub(line: OrderLine, p: Product, pack: ProductPack, by: number): boolean {
    const base = piecesOf(p, line.packCode);
    if (!base || pack.unitQty <= 0) return false;
    const list = draftRef.current.subs[line.lineNo] ?? [];
    const has = list.find((x) => x.packCode === pack.code);
    const next = has
      ? list.map((x) => (x === has ? { ...x, qty: String(round3(num(x.qty) + by)) } : x))
      : [...list, { packCode: pack.code, unit: pack.unitName, pieces: pack.unitQty, base, qty: String(by) }];
    draftRef.current = { ...draftRef.current, subs: { ...draftRef.current.subs, [line.lineNo]: next } };
    setDraft(draftRef.current);
    setConfirming(false);
    setLastLine(`L${line.lineNo}`);
    return true;
  }

  async function handleScan(code: string): Promise<ScanFeedback> {
    if (!order) return findOrder(code);
    const value = code.trim();
    setMessage(null);
    // สินค้ากรอกเอง: จับจากรหัสที่กรอกไว้ในออเดอร์
    const manual = order.lines.find((l) => !l.sku && l.itemCode && l.itemCode === value);
    if (manual) return bump(manual);
    if (/^SO-\d{4}-\d+$/.test(value)) return { ok: false, text: `กำลังตรวจ ${order.id} อยู่ กด “เปลี่ยนออเดอร์” ก่อน` };
    let product: Product | null = null;
    try { product = await api<Product>('/products/lookup/' + encodeURIComponent(value)); }
    catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) { setMessage({ kind: 'error', text: errorText(e) }); return { ok: false }; }
    }
    if (!product) {
      setMessage({ kind: 'error', text: `ไม่พบสินค้ารหัส ${value} ลองสแกนอีกครั้ง หรือใช้บาร์โค้ดอื่นบนสินค้า` });
      return { ok: false };
    }
    const p = product;
    const scanned = p.packs?.find((x) => x.code === value) ?? null;
    const size = (x: { unitName: string; unitQty: number }) => `${x.unitName}|${x.unitQty}`;
    const sameSku = order.lines.filter((l) => l.sku === p.sku);
    // บาร์โค้ดคนละตัวแต่ขนาดเดียวกัน (เช่น PACK x 12 สองบาร์) นับเป็นรายการเดียวกัน สแกน SKU/บาร์หลัก = หน่วยนับสต็อก
    const match = sameSku.find((l) => {
      const linePack = p.packs?.find((x) => x.code === l.packCode);
      if (scanned) return linePack ? size(linePack) === size(scanned) : l.packCode === scanned.code;
      return l.packCode === p.sku || linePack?.factor === 1;
    });
    if (match) return bump(match);

    const pack = scanned ?? defaultPack(p, null);
    // ขนาดอื่นของ SKU ที่อยู่ในออเดอร์ = ให้แทน (ของขนาดที่สั่งไม่พอ) นับรวมเข้ารายการที่ยังไม่ครบก่อน
    const target = sameSku.find((l) => { const t = tally(draftRef.current, l); return t.actual < t.expected; }) ?? sameSku[0];
    if (target && addSub(target, p, pack, 1)) return feedback(target, `ให้ ${pack.unitName} แทน · `);

    const reason: Extra['reason'] = sameSku.length ? 'WRONG_SIZE' : 'NOT_IN_ORDER';
    const hint = reason === 'WRONG_SIZE' ? `ออเดอร์สั่งเป็น ${sameSku.map((l) => l.unit).join(', ')}` : '';
    const key = `${p.sku}|${size(pack)}`;
    const has = draftRef.current.extras.find((x) => x.key === key);
    draftRef.current = {
      ...draftRef.current,
      extras: has
        ? draftRef.current.extras.map((x) => (x.key === key ? { ...x, qty: String(round3(num(x.qty) + 1)) } : x))
        : [...draftRef.current.extras, { key, sku: p.sku, packCode: pack.code, itemCode: '', name: pack.name, unit: pack.unitName, qty: '1', reason, hint }],
    };
    setDraft(draftRef.current);
    setConfirming(false);
    setLastLine(`X${key}`);
    navigator.vibrate?.([60, 60, 60]);
    return { ok: false, text: reason === 'WRONG_SIZE' ? `ผิดขนาด! ${pack.name} เป็น ${pack.unitName} · ${hint}` : `ไม่อยู่ในออเดอร์! ${pack.name}` };
  }

  const view = useMemo(() => {
    if (!order) return null;
    const rows = order.lines.map((l) => {
      const t = tally(draft, l);
      return { line: l, tally: t, state: lineState(t.actual, t.expected) };
    });
    const extras = draft.extras.filter((x) => num(x.qty) > 0);
    return {
      rows,
      open: rows.filter((r) => r.state !== 'MATCH'),
      done: rows.filter((r) => r.state === 'MATCH'),
      match: rows.filter((r) => r.state === 'MATCH').length,
      short: rows.filter((r) => r.state === 'SHORT' || r.state === 'PENDING').length,
      over: rows.filter((r) => r.state === 'OVER').length,
      wrong: extras.length,
      total: rows.length,
      allMatch: rows.every((r) => r.state === 'MATCH') && !extras.length,
      started: rows.some((r) => r.state !== 'PENDING') || extras.length > 0,
    };
  }, [order, draft]);

  async function save(shortStock = false) {
    if (!order) return;
    setConfirming(false);
    setSaving(true);
    setMessage(null);
    try {
      const saved = await api<PickCheck>(`/orders/${encodeURIComponent(order.id)}/checks`, {
        method: 'POST',
        body: {
          requestId: draft.requestId,
          pickerName: draft.pickerName,
          note: draft.note,
          shortStock,
          lines: [
            ...order.lines.map((l) => ({
              orderLineNo: l.lineNo,
              actualQty: num(draft.counts[l.lineNo]),
              manualReason: draft.manual[l.lineNo] ?? '',
              parts: (draft.subs[l.lineNo] ?? []).filter((x) => num(x.qty) > 0).map((x) => ({ packCode: x.packCode, qty: num(x.qty) })),
            })),
            ...draft.extras.filter((x) => num(x.qty) > 0).map((x) => ({ orderLineNo: null, sku: x.sku, packCode: x.packCode, itemCode: x.itemCode, name: x.name, unit: x.unit, actualQty: num(x.qty) })),
          ],
        },
      });
      drafts.delete(order.id);
      setResult(saved);
      setOrder({ ...order, lastCheck: { id: saved.id, status: saved.status, createdAt: saved.createdAt, pickerName: saved.pickerName } });
      window.scrollTo({ top: 0 });
    } catch (e) {
      setMessage({ kind: 'error', text: errorText(e) });
    } finally {
      setSaving(false);
    }
  }

  function recheck() {
    if (!order) return;
    drafts.delete(order.id);
    setDraft({ ...emptyDraft(), pickerName: draft.pickerName });
    setResult(null);
    setLastLine(null);
  }

  // ---------- ผลตรวจ ----------
  if (order && result) {
    return (
      <div className="mx-auto grid max-w-3xl gap-4">
        <CheckResult check={result} order={order} />
        <div className="flex flex-wrap gap-2">
          <Button size="touch" onClick={closeOrder}><ClipboardCheckIcon />ตรวจออเดอร์อื่น</Button>
          {result.status !== 'MATCH' && <Button size="touch" variant="outline" onClick={recheck}><RotateCcwIcon />ตรวจออเดอร์นี้ใหม่</Button>}
        </div>
      </div>
    );
  }

  // ---------- เลือกออเดอร์ ----------
  if (!order) {
    const current = TABS.find((t) => t.key === tab)!;
    return (
      <div className="mx-auto grid max-w-4xl gap-4">
        <ScanInput ref={scanRef} label="สแกนบาร์โค้ดบนใบออเดอร์" placeholder="เลขออเดอร์หรือชื่อผู้สั่ง" hint="สแกนใบออเดอร์ หรือพิมพ์เลข/ชื่อผู้สั่งแล้วกด Enter" onScan={handleScan} autoFocus />
        <Notice message={message} />
        <section ref={listTop} className="grid scroll-mt-20 gap-3" aria-labelledby="check-list-title">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <h2 id="check-list-title" className="font-heading text-xl font-semibold">{query ? `ผลค้นหา “${query}”` : 'ออเดอร์ที่จะตรวจ'}</h2>
            {query && <Button variant="ghost" size="touch" className="-mr-2" onClick={() => { setQuery(''); setPage(1); }}><XIcon />ล้างคำค้น</Button>}
          </div>
          {!query && (
            <div role="radiogroup" aria-label="สถานะการตรวจ" className="flex flex-wrap gap-2">
              {TABS.map((t) => {
                const active = tab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => { setTab(t.key); setPage(1); }}
                    className={cn(
                      'flex min-h-12 items-center gap-2 rounded-full border-2 px-4 text-sm transition-[border-color,background-color] outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                      active ? 'border-star bg-star-soft font-semibold' : 'border-border bg-card hover:border-star/50',
                    )}
                  >
                    {t.label}
                    <span className={cn('grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-xs font-bold tabular-nums', TONES[t.tone])}>{counts ? counts[t.key] : '·'}</span>
                  </button>
                );
              })}
            </div>
          )}
          {loadingList && !list ? (
            <div className="grid gap-2 sm:grid-cols-2" aria-hidden>{[0, 1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted/60" />)}</div>
          ) : list && (
            <>
              {!list.rows.length && (
                <div className={`${SPELL_SLOT} grid justify-items-center gap-2 px-4 py-10 text-center`}>
                  <SlotSparkles />
                  <SparklesIcon className="size-8 text-star-ink dark:text-star" aria-hidden />
                  <p className="text-muted-foreground">{query ? 'ไม่พบออเดอร์ที่ตรงกับคำค้น ลองเลขออเดอร์หรือชื่อผู้สั่งอื่น' : counts?.ALL === 0 ? 'ยังไม่มีออเดอร์ให้ตรวจ' : current.empty}</p>
                </div>
              )}
              <ul className={cn('grid gap-2 sm:grid-cols-2', loadingList && 'opacity-60')} aria-busy={loadingList}>
                {list.rows.map((o) => {
                  const tone: Tone = !o.lastCheck ? 'star' : o.lastCheck.status === 'MATCH' ? 'mint' : o.lastCheck.status === 'PARTIAL' ? 'kibble' : 'rose';
                  return (
                    <li key={o.id}>
                      <SpotlightCard className="h-full transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-star/60 motion-reduce:hover:translate-y-0">
                        <button type="button" onClick={() => openOrder(o)} className="relative flex h-full min-h-24 w-full items-center gap-3 p-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset">
                          <Medallion tone={tone} icon={ClipboardListIcon} />
                          <span className="grid min-w-0 flex-1 gap-1">
                            <strong className="line-clamp-2 font-medium break-words">{o.customerName}</strong>
                            <span className="text-sm text-muted-foreground">{o.id} · {o.date} · {o.lines.length} รายการ</span>
                            <span><CheckBadge check={o.lastCheck} /></span>
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

  // ---------- กำลังตรวจ ----------
  const v = view!;
  const setCount = (lineNo: number, value: string) => { setConfirming(false); setDraft((d) => ({ ...d, counts: { ...d.counts, [lineNo]: value } })); };
  const setSub = (lineNo: number, packCode: string, value: string) => {
    setConfirming(false);
    setDraft((d) => ({ ...d, subs: { ...d.subs, [lineNo]: (d.subs[lineNo] ?? []).map((x) => (x.packCode === packCode ? { ...x, qty: value } : x)) } }));
  };
  const removeSub = (lineNo: number, packCode: string) => {
    setConfirming(false);
    setDraft((d) => ({ ...d, subs: { ...d.subs, [lineNo]: (d.subs[lineNo] ?? []).filter((x) => x.packCode !== packCode) } }));
  };
  // เลิกนับเอง = ล้างยอดของรายการนั้นแล้วสแกนใหม่ (ไม่ให้เอาเหตุผลออกแต่ยอดที่กดเองยังอยู่)
  const setManual = (lineNo: number, reason: string | null) => {
    setConfirming(false);
    setDraft((d) => {
      const manual = { ...d.manual };
      if (reason) return { ...d, manual: { ...manual, [lineNo]: reason } };
      delete manual[lineNo];
      return { ...d, manual, counts: { ...d.counts, [lineNo]: '' }, subs: { ...d.subs, [lineNo]: [] } };
    });
  };
  const setExtra = (key: string, value: string) => { setConfirming(false); setDraft((d) => ({ ...d, extras: d.extras.map((x) => (x.key === key ? { ...x, qty: value } : x)) })); };
  const lineRow = (r: (typeof v.rows)[number], compact = false) => (
    <CheckRow
      key={r.line.lineNo}
      id={`check-L${r.line.lineNo}`}
      compact={compact}
      highlight={lastLine === `L${r.line.lineNo}`}
      name={r.line.name}
      code={r.line.packCode || r.line.sku || r.line.itemCode || ''}
      unit={r.line.unit}
      expected={r.tally.expected}
      total={r.tally.actual}
      totalUnit={r.tally.pieces ? r.tally.unit : undefined}
      hint={r.tally.pieces ? `สั่ง ${formatQty(r.line.qty)} ${r.line.unit} = ${formatQty(r.tally.expected)} ชิ้น` : undefined}
      value={draft.counts[r.line.lineNo] ?? ''}
      onChange={(value) => setCount(r.line.lineNo, value)}
      manualReason={draft.manual[r.line.lineNo]}
      onManual={(reason) => setManual(r.line.lineNo, reason)}
      disabled={saving}
    >
      {r.line.sku && (
        <SubSizes
          line={r.line}
          subs={draft.subs[r.line.lineNo] ?? []}
          onChange={(code, value) => setSub(r.line.lineNo, code, value)}
          onRemove={(code) => removeSub(r.line.lineNo, code)}
          onAdd={(p, pack) => { addSub(r.line, p, pack, 1); }}
          manual={!!draft.manual[r.line.lineNo]}
          disabled={saving}
        />
      )}
    </CheckRow>
  );
  const saveArea = (
    <SaveArea
      allMatch={v.allMatch}
      shortOnly={!v.over && !v.wrong && v.short > 0}
      started={v.started}
      saving={saving}
      confirming={confirming}
      problems={[v.short && `ยังไม่ครบ ${v.short} รายการ`, v.over && `เกิน ${v.over} รายการ`, v.wrong && `ไม่ตรงออเดอร์ ${v.wrong} รายการ`].filter(Boolean) as string[]}
      onSave={() => (v.allMatch ? void save() : setConfirming(true))}
      onConfirm={() => void save()}
      onShortStock={() => void save(true)}
      onCancel={() => { setConfirming(false); scanRef.current?.focus(); }}
    />
  );

  return (
    <div className="grid gap-4 pb-32 lg:pb-0">
      <ScanInput ref={scanRef} label={`สแกนของที่เบิกมา · ${order.id}`} placeholder="สแกนสินค้าทีละชิ้น" onScan={handleScan} autoFocus disabled={saving} />
      <Notice message={message} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_23rem] lg:items-start">
        {/* มือถือ: ท้องฟ้า → คนเบิก → รายการ / จอคอม: รายการซ้าย แผงสรุปติดขวา */}
        <aside className="contents lg:sticky lg:top-20 lg:order-2 lg:grid lg:gap-4">
          <div className="order-1">
            <Constellation order={order} rows={v.rows} extras={draft.extras.filter((x) => num(x.qty) > 0).length} match={v.match} total={v.total} onClose={closeOrder} disabled={saving} />
          </div>
          <Card className="order-2">
            <CardContent className="grid gap-3">
              <Field id="check-picker" label="ชื่อผู้เบิกสินค้า">
                <Input id="check-picker" className={touchInput} value={draft.pickerName} maxLength={100} placeholder="เช่น สมชาย" onChange={(e) => setDraft((d) => ({ ...d, pickerName: e.target.value }))} />
              </Field>
              <Field id="check-note" label="หมายเหตุ (ถ้ามี)">
                <Input id="check-note" className={touchInput} value={draft.note} maxLength={1000} placeholder="เช่น ของขาดเพราะสต็อกหมด" onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
              </Field>
              <div className="hidden lg:block">{saveArea}</div>
            </CardContent>
          </Card>
        </aside>

        <div className="order-3 grid gap-5 lg:order-1">
          {v.open.length > 0 && (
            <section className="grid gap-2" aria-labelledby="check-open">
              <h2 id="check-open" className="font-heading text-lg font-semibold">ยังไม่ครบ <span className="text-muted-foreground tabular-nums">({v.open.length})</span></h2>
              <ul className="grid gap-2">{v.open.map((r) => lineRow(r))}</ul>
            </section>
          )}
          {draft.extras.length > 0 && (
            <section className="grid gap-2" aria-labelledby="check-extra">
              <h2 id="check-extra" className="flex items-center gap-2 font-heading text-lg font-semibold text-rose"><PackageXIcon className="size-5" aria-hidden />ของที่ไม่ตรงกับออเดอร์</h2>
              <p className="-mt-1 text-sm text-muted-foreground">แยกของนี้ให้คนเบิกเอาไปคืน แล้วกดถังขยะเพื่อลบออกจากผลตรวจ</p>
              <ul className="grid gap-2">
                {draft.extras.map((x) => (
                  <CheckRow
                    key={x.key}
                    id={`check-X${x.key}`}
                    extra={x.reason === 'WRONG_SIZE' ? 'ผิดขนาด' : 'ไม่อยู่ในออเดอร์'}
                    hint={x.hint}
                    highlight={lastLine === `X${x.key}`}
                    name={x.name}
                    code={x.packCode}
                    unit={x.unit}
                    expected={0}
                    value={x.qty}
                    onChange={(value) => setExtra(x.key, value)}
                    onRemove={() => setDraft((d) => ({ ...d, extras: d.extras.filter((e) => e.key !== x.key) }))}
                    disabled={saving}
                  />
                ))}
              </ul>
            </section>
          )}
          {v.done.length > 0 && (
            <details className="group grid gap-2" open={!v.open.length}>
              <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-lg font-heading text-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <span className="grid size-7 place-items-center rounded-full bg-mint-soft text-mint"><CheckIcon className="size-4" aria-hidden /></span>
                ครบแล้ว <span className="text-muted-foreground tabular-nums">({v.done.length})</span>
                <ChevronDownIcon className="size-5 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <ul className="mt-2 grid gap-2">{v.done.map((r) => lineRow(r, true))}</ul>
            </details>
          )}
        </div>
      </div>

      {/* แถบล่างบนมือถือ: สรุป + บันทึก (จอคอมอยู่ในแผงขวา) */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-on-sky/10 bg-brand px-4 pt-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] text-brand-foreground shadow-dock lg:hidden print:hidden">
        <div className="mx-auto grid max-w-3xl gap-2">
          <p className="text-sm" aria-live="polite">
            ครบ <span className="font-heading font-semibold text-on-sky-mint tabular-nums">{v.match}/{v.total}</span>
            {v.short > 0 && <> · ยังไม่ครบ <span className="font-semibold text-on-sky-kibble tabular-nums">{v.short}</span></>}
            {v.over > 0 && <> · เกิน <span className="font-semibold text-on-sky-rose tabular-nums">{v.over}</span></>}
            {v.wrong > 0 && <> · ไม่ตรงออเดอร์ <span className="font-semibold text-on-sky-rose tabular-nums">{v.wrong}</span></>}
          </p>
          {saveArea}
        </div>
      </div>
    </div>
  );
}

/**
 * ท้องฟ้าของออเดอร์: ดาว 1 ดวงต่อรายการ ครบ = ดาวทองสว่าง, ขาด = ดาวคาราเมลโปร่ง, เกิน = ดาวแดง, ยังไม่ตรวจ = ดาวจาง
 * ของที่ผิดเป็นกากบาทแดงต่อท้าย เห็นความคืบหน้าทั้งออเดอร์ในพริบตา
 */
function Constellation({ order, rows, extras, match, total, onClose, disabled }: {
  order: SalesOrder; rows: { line: OrderLine; state: LineState }[]; extras: number; match: number; total: number; onClose: () => void; disabled?: boolean;
}) {
  const starClass: Record<LineState, string> = {
    MATCH: 'fill-star text-star drop-shadow-[0_0_6px_color-mix(in_oklab,var(--pm-star)_70%,transparent)]',
    SHORT: 'fill-on-sky-kibble/30 text-on-sky-kibble',
    OVER: 'fill-on-sky-rose text-on-sky-rose',
    PENDING: 'text-on-sky/35',
  };
  return (
    <MagicStage className="grid gap-3">
      <div className="grid gap-0.5">
        {/* ปุ่มเปลี่ยนออเดอร์อยู่บรรทัดเลขออเดอร์ ชื่อผู้สั่งยาวๆ จะได้กว้างเต็มแผง */}
        <div className="-mr-2 flex items-center justify-between gap-2">
          <p className="font-mono text-sm text-brand-foreground/75">{order.id}</p>
          <Button variant="ghost" size="touch" className="px-3 text-brand-foreground hover:bg-on-sky/10 hover:text-brand-foreground" disabled={disabled} onClick={onClose}><ArrowLeftIcon />เปลี่ยนออเดอร์</Button>
        </div>
        <p className="font-heading text-lg leading-snug font-semibold break-words">{order.customerName}</p>
      </div>
      <p className="font-heading text-3xl font-semibold tabular-nums" aria-live="polite">
        <span className={match === total && !extras ? 'text-star' : ''}>{match}</span><span className="text-brand-foreground/60">/{total}</span>
        <span className="ml-2 align-middle text-base font-normal text-brand-foreground/80">{match === total && !extras ? 'ครบทุกรายการ' : 'รายการครบ'}</span>
      </p>
      <ul className="flex flex-wrap gap-1.5" aria-label="สถานะแต่ละรายการ">
        {rows.map((r) => (
          <li key={r.line.lineNo} title={`${r.line.name} · ${STATE[r.state].label(0)}`}>
            <StarIcon className={cn('size-6 transition-[color,fill,filter] duration-300', starClass[r.state])} aria-label={`${r.line.name}: ${r.state === 'MATCH' ? 'ครบ' : r.state === 'OVER' ? 'เกิน' : r.state === 'SHORT' ? 'ขาด' : 'ยังไม่ได้ตรวจ'}`} />
          </li>
        ))}
        {Array.from({ length: extras }, (_, i) => <li key={`x${i}`}><XIcon className="size-6 text-on-sky-rose" aria-label="ของที่ไม่ตรงกับออเดอร์" /></li>)}
      </ul>
    </MagicStage>
  );
}

/** ปุ่มบันทึกผลตรวจ: ครบ = ปุ่มทองมีดาววิ่งรอบ, ยังไม่ครบ = ยืนยันในที่เดิม (ไม่เปิดหน้าต่างซ้อน) */
function SaveArea({ allMatch, shortOnly, started, saving, confirming, problems, onSave, onConfirm, onShortStock, onCancel }: {
  allMatch: boolean; shortOnly: boolean; started: boolean; saving: boolean; confirming: boolean; problems: string[];
  onSave: () => void; onConfirm: () => void; onShortStock: () => void; onCancel: () => void;
}) {
  // ขาดอย่างเดียว: ของในคลังไม่พอ ยืนยันให้ตามที่มีได้เลย (นับเป็นตรวจผ่าน) หรือบันทึกผล: ไม่ตรงออเดอร์ให้คนเบิกไปหยิบเพิ่ม
  if (confirming && shortOnly) {
    return (
      <div role="alert" className="grid gap-2 rounded-xl border border-kibble/55 bg-kibble-soft p-3 text-kibble-ink">
        <p className="flex items-start gap-2 text-sm font-semibold"><AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />{problems.join(' · ')} ของในคลังไม่พอใช่ไหม</p>
        <Button size="touch" className="bg-on-sky-kibble text-on-kibble hover:bg-on-sky-kibble/90" onClick={onShortStock}><PackageIcon />ของไม่พอ ยืนยันให้ตามที่มี</Button>
        <div className="grid grid-cols-2 gap-2">
          <Button size="touch" variant="outline" onClick={onCancel}>ตรวจต่อ</Button>
          <Button size="touch" variant="outline" className="border-rose/50 text-rose hover:bg-rose-soft hover:text-rose" onClick={onConfirm}>บันทึกผล: ไม่ตรงออเดอร์</Button>
        </div>
      </div>
    );
  }
  if (confirming) {
    return (
      <div role="alert" className="grid gap-2 rounded-xl border border-rose/50 bg-rose-soft p-3 text-rose">
        <p className="flex items-start gap-2 text-sm font-semibold"><AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />ของยังไม่ตรงกับออเดอร์: {problems.join(' · ')}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button size="touch" variant="outline" onClick={onCancel}>ตรวจต่อ</Button>
          <Button size="touch" variant="destructive" onClick={onConfirm}>บันทึกผล: ไม่ตรงออเดอร์</Button>
        </div>
      </div>
    );
  }
  const button = (
    <Button size="touch" className={cn('w-full', allMatch && 'bg-star text-on-star hover:bg-star/90')} disabled={saving || !started} onClick={onSave}>
      {saving ? <><LoaderCircleIcon className="animate-spin" />กำลังบันทึกผลตรวจ…</> : allMatch ? <><SparklesIcon />บันทึกผลตรวจ: ครบ</> : <><CheckIcon />บันทึกผลตรวจ</>}
    </Button>
  );
  return allMatch && !saving ? <StarBorder innerClassName="border-0">{button}</StarBorder> : button;
}

/**
 * แถวตรวจ 1 รายการ: สถานะซ้าย ยอดนับได้/ควรได้ตัวใหญ่ขวา แถวที่ครบแล้วย่อเหลือบรรทัดเดียว
 * ต้องสแกนเป็นหลัก: ปกติกดได้แค่ − (แก้สแกนเกิน) จะกด + หรือพิมพ์จำนวนต้องกด "นับเอง" แล้วเลือกเหตุผลก่อน
 */
function CheckRow({ id, name, code, unit, expected, total, totalUnit, value, onChange, manualReason, onManual, onRemove, extra, hint, highlight, compact, disabled, children }: {
  id: string; name: string; code: string; unit: string; expected: number; value: string; onChange: (v: string) => void;
  /** ยอดรวมรวมขนาดที่ให้แทน (ไม่ส่ง = ใช้ค่าในช่อง) */
  total?: number;
  /** หน่วยของยอดรวม เมื่อไม่ใช่หน่วยในช่อง (ให้ขนาดอื่นแทน = ชิ้น) */
  totalUnit?: string;
  /** เหตุผลที่นับเอง (ว่าง = ต้องสแกน) */
  manualReason?: string;
  /** เปิด/เลิกนับเอง ไม่ส่ง = นับเองไม่ได้ (ของนอกออเดอร์) */
  onManual?: (reason: string | null) => void;
  onRemove?: () => void; extra?: string; hint?: string; highlight?: boolean; compact?: boolean; disabled?: boolean; children?: ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [asking, setAsking] = useState(false);
  const typed = !!manualReason;
  const own = num(value);
  const actual = total ?? own;
  const state: LineState = extra ? 'OVER' : lineState(actual, expected);
  const s = STATE[state];
  const step = (by: number) => onChange(String(Math.max(0, round3(own + by))));
  const showControls = !compact || editing;
  return (
    <li id={id} className={cn('grid scroll-mt-28 gap-3 rounded-xl border-2 bg-card p-3 transition-shadow duration-300', s.border, highlight && 'shadow-[0_0_0_4px_color-mix(in_oklab,var(--pm-star)_35%,transparent)]', compact && !editing && 'py-2')}>
      <div className="flex items-center gap-3">
        <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-full', compact && !editing ? 'size-8' : 'size-10', toneClass(s.tone))}>
          {state === 'MATCH' ? <CheckIcon className="size-5" /> : state === 'PENDING' ? <StarIcon className="size-5" /> : <AlertTriangleIcon className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn('font-medium break-words', compact && !editing && 'line-clamp-1 text-sm')}>{name}</p>
          {(!compact || editing) && <p className="text-sm text-muted-foreground"><span className="font-mono">{code}</span> · {unit}</p>}
          {hint && <p className={cn('text-sm', extra ? 'text-rose' : 'text-muted-foreground')}>{hint}</p>}
        </div>
        <div className="shrink-0 text-right">
          <p className={cn('font-heading font-semibold tabular-nums', compact && !editing ? 'text-base' : 'text-2xl')}>
            <span className={state === 'MATCH' ? 'text-mint' : state === 'OVER' ? 'text-rose' : ''}>{formatQty(actual)}</span>
            {!extra && <span className="text-muted-foreground">/{formatQty(expected)}</span>}
            {totalUnit && <span className="ml-1 text-sm font-normal text-muted-foreground">{totalUnit}</span>}
          </p>
          {(!compact || editing) && <span className={cn('inline-flex h-6 items-center rounded-full px-2 text-xs font-semibold', toneClass(s.tone))}>{extra ?? `${s.label(Math.abs(actual - expected))}${totalUnit && state !== 'MATCH' && state !== 'PENDING' ? ` ${totalUnit}` : ''}`}</span>}
        </div>
        {compact && <Button type="button" variant="ghost" size="icon-touch" className="-mr-1 text-muted-foreground" aria-label={editing ? `ปิดการแก้จำนวน ${name}` : `แก้จำนวน ${name}`} aria-expanded={editing} onClick={() => setEditing(!editing)}>{editing ? <ChevronDownIcon className="rotate-180" /> : <PencilIcon />}</Button>}
      </div>
      {showControls && (
        <div className="flex items-center gap-2">
          {typed ? (
            <div className="flex items-stretch" role="group" aria-label={`จำนวนที่นับได้ ${name}`}>
              <Button type="button" variant="outline" size="icon-touch" className="rounded-r-none" aria-label={`ลด ${name}`} disabled={disabled || own <= 0} onClick={() => step(-1)}><MinusIcon /></Button>
              <Input
                className="h-12 w-20 rounded-none border-x-0 text-center text-lg font-semibold tabular-nums md:text-lg"
                type="number" inputMode="decimal" min={0} step="any" aria-label={`จำนวนที่นับได้ ${name}`}
                value={value} placeholder="0" disabled={disabled}
                onFocus={(e) => e.target.select()} onChange={(e) => onChange(e.target.value)}
              />
              <Button type="button" variant="outline" size="icon-touch" className="rounded-l-none" aria-label={`เพิ่ม ${name}`} disabled={disabled} onClick={() => step(1)}><PlusIcon /></Button>
            </div>
          ) : (
            // ยังไม่นับเอง: แก้ได้แค่ลดลง (สแกนเกิน) จำนวนเพิ่มได้จากการสแกนเท่านั้น
            <Button type="button" variant="outline" size="icon-touch" aria-label={`ลด ${name} 1`} disabled={disabled || own <= 0} onClick={() => step(-1)}><MinusIcon /></Button>
          )}
          <span className="text-sm text-muted-foreground">{typed ? unit : `${formatQty(own)} ${unit} · สแกนเพื่อเพิ่ม`}</span>
          {onRemove && <Button type="button" variant="ghost" size="icon-touch" className="ml-auto text-muted-foreground hover:text-destructive" aria-label={`ลบ ${name} ออกจากผลตรวจ`} disabled={disabled} onClick={onRemove}><Trash2Icon /></Button>}
        </div>
      )}
      {showControls && onManual && (
        typed ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg bg-kibble-soft px-3 py-1 text-sm text-kibble-ink">
            <HandIcon className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">นับเอง: {manualReason}</span>
            <Button type="button" variant="ghost" size="touch" className="-mr-2 px-2 text-kibble-ink hover:bg-kibble/15" disabled={disabled} onClick={() => onManual(null)}>
              <RotateCcwIcon />ล้างจำนวนแล้วสแกนใหม่
            </Button>
          </div>
        ) : asking ? (
          <div className="grid gap-2 rounded-lg bg-muted/50 p-2">
            <label htmlFor={`${id}-why`} className="text-sm font-medium">ทำไมต้องนับเอง (ระบบบันทึกไว้ในผลตรวจ)</label>
            <div className="flex flex-wrap gap-2">
              <NativeSelect id={`${id}-why`} size="touch" defaultValue="" className="min-w-0 flex-1" disabled={disabled}
                onChange={(e) => { if (e.target.value) { onManual(e.target.value); setAsking(false); } }}>
                <NativeSelectOption value="" disabled>เลือกเหตุผล</NativeSelectOption>
                {MANUAL_REASONS.map((r) => <NativeSelectOption key={r} value={r}>{r}</NativeSelectOption>)}
              </NativeSelect>
              <Button type="button" variant="ghost" size="touch" onClick={() => setAsking(false)}>ยกเลิก</Button>
            </div>
          </div>
        ) : (
          <Button type="button" variant="ghost" size="touch" className="justify-self-start px-2 text-muted-foreground" disabled={disabled} onClick={() => setAsking(true)}>
            <HandIcon />สแกนไม่ได้ นับเอง
          </Button>
        )
      )}
      {showControls && children}
    </li>
  );
}

/** ผลตรวจที่บันทึกแล้ว: ครบ = ฉากฉลองบนท้องฟ้า, ไม่ครบ = รายการที่ต่างให้ตามแก้ */
function CheckResult({ check, order }: { check: PickCheck; order: SalesOrder }) {
  const spark = useRef<SparkBurstHandle>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    if (check.status !== 'MATCH') return;
    const t = setTimeout(() => spark.current?.burst(), 120);
    return () => clearTimeout(t);
  }, [check.status]);
  const diffs = check.lines.map((l) => ({ l, ...resultTally(l) })).filter((x) => x.actual !== x.expected);
  const title = check.status === 'MATCH' ? `ของครบตาม ${order.id}` : check.status === 'PARTIAL' ? `ให้ตามที่มี ${order.id}: ของในคลังไม่พอ` : `บันทึกผลตรวจ ${order.id}: ไม่ตรงออเดอร์`;
  const subbed = check.lines.filter((l) => l.parts.length > 0);
  const manual = check.lines.filter((l) => l.manualReason);
  return (
    <div className="grid gap-4">
      <div className="relative" role="status">
        <SparkBurst ref={spark} count={24} reach={44} length={16} duration={760} />
        <MagicStage>
          <div className="grid justify-items-center gap-3 py-4 text-center">
            <span className={cn('grid size-16 place-items-center rounded-full ring-4', check.status === 'MATCH' ? 'bg-mint-soft text-mint ring-mint/25' : check.status === 'PARTIAL' ? 'bg-kibble-soft text-kibble-ink ring-kibble/25' : 'bg-rose-soft text-rose ring-rose/25')}>
              {check.status === 'MATCH' ? <CheckIcon className="size-8" aria-hidden /> : check.status === 'PARTIAL' ? <PackageIcon className="size-8" aria-hidden /> : <AlertTriangleIcon className="size-8" aria-hidden />}
            </span>
            {reduce || check.status !== 'MATCH'
              ? <p className="font-heading text-2xl font-semibold sm:text-3xl">{title}</p>
              : <BlurText text={title} delay={120} animateBy="words" direction="top" className="justify-center font-heading text-2xl font-semibold sm:text-3xl" />}
            <p className="text-brand-foreground/80">{order.customerName}{check.pickerName && ` · เบิกโดย ${check.pickerName}`} · {formatTime(check.createdAt)}</p>
          </div>
        </MagicStage>
      </div>
      {diffs.length > 0 && (
        <Card>
          <CardHeader><CardTitle role="heading" aria-level={2}>{check.status === 'PARTIAL' ? 'รายการที่ให้ไม่ครบเพราะของไม่พอ' : 'รายการที่ไม่ตรง'} ({diffs.length})</CardTitle><CardDescription>เลขที่ผลตรวจ {check.id}</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {diffs.map(({ l, actual, expected, unit }) => {
                const d = round3(actual - expected);
                return (
                  <li key={l.lineNo} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="font-medium break-words">{l.name}</p>
                      <p className="text-sm text-muted-foreground"><span className="font-mono">{l.packCode || l.sku || l.itemCode}</span> · นับได้ {formatQty(actual)} / ควรได้ {formatQty(expected)} {unit}</p>
                      {l.pieces && <p className="text-sm text-muted-foreground">สั่ง {formatQty(l.expectedQty)} {l.unit} · ให้ {partsText(l)}</p>}
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold', l.orderLineNo === null || d > 0 ? 'bg-rose-soft text-rose' : 'bg-kibble-soft text-kibble-ink')}>
                      {l.orderLineNo === null ? 'ไม่อยู่ในออเดอร์' : d > 0 ? `เกิน ${formatQty(d)} ${unit}` : `ขาด ${formatQty(-d)} ${unit}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
      {subbed.length > 0 && (
        <Card>
          <CardHeader><CardTitle role="heading" aria-level={2}>ให้ขนาดอื่นแทน ({subbed.length})</CardTitle><CardDescription>ขนาดที่สั่งไม่พอ จึงให้ขนาดอื่นของสินค้าเดียวกัน</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {subbed.map((l) => (
                <li key={l.lineNo} className="grid gap-0.5 py-3">
                  <p className="font-medium break-words">{l.name}</p>
                  <p className="text-sm text-muted-foreground">
                    สั่ง {formatQty(l.expectedQty)} {l.unit}{l.pieces && ` (${formatQty(l.pieces.expected)} ชิ้น)`} · ให้ {partsText(l)}{l.pieces && ` รวม ${formatQty(l.pieces.actual)} ชิ้น`}
                  </p>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {manual.length > 0 && (
        <Card>
          <CardHeader><CardTitle role="heading" aria-level={2}>นับเอง ไม่ได้สแกน ({manual.length})</CardTitle><CardDescription>หัวหน้าตรวจย้อนรายการเหล่านี้ได้</CardDescription></CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {manual.map((l) => (
                <li key={l.lineNo} className="flex items-start justify-between gap-3 py-3">
                  <p className="min-w-0 font-medium break-words">{l.name}</p>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-kibble-soft px-2.5 py-1 text-xs font-semibold text-kibble-ink"><HandIcon className="size-3.5" aria-hidden />{l.manualReason}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
      {check.note && <Notice message={{ kind: 'info', text: `หมายเหตุ: ${check.note}` }} />}
    </div>
  );
}

type ResultLine = PickCheck['lines'][number];
/** ยอดในผลตรวจ: ให้ขนาดอื่นแทน = เป็นชิ้น ไม่งั้นเป็นหน่วยที่สั่ง */
const resultTally = (l: ResultLine) =>
  l.pieces ? { actual: l.pieces.actual, expected: l.pieces.expected, unit: 'ชิ้น' } : { actual: l.actualQty, expected: l.expectedQty, unit: l.unit };
/** "ลัง × 0 · PACK x 12 × 3" ส่วนที่นับตรงขนาด (ชิ้นที่เหลือจากขนาดอื่น) ขึ้นก่อน */
function partsText(l: ResultLine): string {
  const fromParts = l.parts.reduce((t, x) => t + x.qty * x.pieces, 0);
  const direct = l.pieces ? round3((l.pieces.actual - fromParts) / l.pieces.perUnit) : 0;
  return [...(direct > 0 ? [`${l.unit} × ${formatQty(direct)}`] : []), ...l.parts.map((x) => `${x.unit} × ${formatQty(x.qty)}`)].join(' · ');
}

/**
 * ขนาดอื่นที่ให้แทนขนาดในออเดอร์ (สั่งเป็นลัง ของเหลือแต่โหล/ชิ้น) สแกนบาร์โค้ดขนาดนั้นได้เลย หรือกดเลือกขนาดเองถ้าบาร์โค้ดอ่านไม่ได้
 * แต่ละขนาดมี −/+ ของตัวเอง ยอดของรายการเปลี่ยนเป็นนับเป็นชิ้นทันที (สั่ง 1 ลัง = 48 ชิ้น ให้ 3 โหล = 36 ชิ้น)
 */
function SubSizes({ line, subs, onChange, onRemove, onAdd, manual, disabled }: {
  line: OrderLine; subs: Sub[]; onChange: (packCode: string, value: string) => void; onRemove: (packCode: string) => void;
  onAdd: (p: Product, pack: ProductPack) => void;
  /** นับเองอยู่: กด + / พิมพ์ / แตะเลือกขนาดได้ ไม่งั้นเพิ่มได้จากการสแกนเท่านั้น */
  manual: boolean; disabled?: boolean;
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function openPicker() {
    setOpen(true);
    if (product) return;
    setLoading(true);
    setError('');
    try { setProduct(await api<Product>('/products/lookup/' + encodeURIComponent(line.sku))); }
    catch (e) { setError(errorText(e)); }
    finally { setLoading(false); }
  }

  const base = product ? piecesOf(product, line.packCode) : null;
  const choices = product && base ? packSizes(product).filter((x) => x.unitQty > 0 && x.unitQty !== base && !subs.some((s) => s.packCode === x.code)) : [];

  return (
    <div className="grid gap-2 border-t border-dashed border-border pt-2">
      {subs.map((x) => {
        const n = num(x.qty);
        return (
          <div key={x.packCode} className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 text-sm">
              ให้ <strong className="font-semibold">{x.unit}</strong> แทน
              <span className="block text-muted-foreground tabular-nums">= {formatQty(round3(n * x.pieces))} ชิ้น</span>
            </span>
            {!manual ? (
              <>
                <span className="text-lg font-semibold tabular-nums">{formatQty(n)}</span>
                <Button type="button" variant="outline" size="icon-touch" aria-label={`ลด ${x.unit} 1`} disabled={disabled || n <= 0} onClick={() => onChange(x.packCode, String(Math.max(0, round3(n - 1))))}><MinusIcon /></Button>
              </>
            ) : (
            <div className="flex items-stretch" role="group" aria-label={`จำนวน ${x.unit} ที่ให้แทน`}>
              <Button type="button" variant="outline" size="icon-touch" className="rounded-r-none" aria-label={`ลด ${x.unit}`} disabled={disabled || n <= 0} onClick={() => onChange(x.packCode, String(Math.max(0, round3(n - 1))))}><MinusIcon /></Button>
              <Input
                className="h-12 w-16 rounded-none border-x-0 text-center text-lg font-semibold tabular-nums md:text-lg"
                type="number" inputMode="decimal" min={0} step="any" aria-label={`จำนวน ${x.unit} ที่ให้แทน`}
                value={x.qty} placeholder="0" disabled={disabled}
                onFocus={(e) => e.target.select()} onChange={(e) => onChange(x.packCode, e.target.value)}
              />
              <Button type="button" variant="outline" size="icon-touch" className="rounded-l-none" aria-label={`เพิ่ม ${x.unit}`} disabled={disabled} onClick={() => onChange(x.packCode, String(round3(n + 1)))}><PlusIcon /></Button>
            </div>
            )}
            <Button type="button" variant="ghost" size="icon-touch" className="text-muted-foreground hover:text-destructive" aria-label={`เลิกให้ ${x.unit} แทน`} disabled={disabled} onClick={() => onRemove(x.packCode)}><Trash2Icon /></Button>
          </div>
        );
      })}
      {!manual ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><PackageIcon className="size-4 shrink-0" aria-hidden />ขนาดที่สั่งไม่พอ สแกนบาร์โค้ดขนาดอื่นของสินค้านี้ได้เลย ระบบนับเป็นชิ้นให้</p>
      ) : !open ? (
        <Button type="button" variant="ghost" size="touch" className="justify-self-start px-2 text-muted-foreground" disabled={disabled} onClick={() => void openPicker()}>
          <PackageIcon />ขนาดนี้ไม่พอ ให้ขนาดอื่นแทน
        </Button>
      ) : (
        <div className="grid gap-2 rounded-lg bg-muted/50 p-2">
          <p className="text-sm text-muted-foreground">สแกนบาร์โค้ดขนาดที่ให้แทนได้เลย หรือแตะเลือกขนาด</p>
          {loading && <p className="flex items-center gap-2 text-sm"><LoaderCircleIcon className="size-4 animate-spin" aria-hidden />กำลังโหลดขนาดบรรจุ…</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {product && !base && <p className="text-sm text-muted-foreground">ไม่พบจำนวนชิ้นต่อหน่วยของขนาดที่สั่ง จึงใช้ขนาดอื่นแทนไม่ได้</p>}
          {product && base && !choices.length && <p className="text-sm text-muted-foreground">สินค้านี้ไม่มีขนาดอื่นให้เลือกแล้ว</p>}
          <div className="flex flex-wrap gap-2">
            {base && choices.map((x) => (
              <Button key={x.code} type="button" variant="outline" size="touch" disabled={disabled} onClick={() => { if (product) onAdd(product, x); setOpen(false); }}>
                <PlusIcon />{x.unitName}
                <span className="text-muted-foreground tabular-nums">= {formatQty(x.unitQty)} ชิ้น</span>
              </Button>
            ))}
            <Button type="button" variant="ghost" size="touch" onClick={() => setOpen(false)}>ปิด</Button>
          </div>
        </div>
      )}
    </div>
  );
}
