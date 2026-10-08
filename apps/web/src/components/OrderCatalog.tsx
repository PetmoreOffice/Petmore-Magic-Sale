import { ReactNode, useEffect, useRef, useState } from 'react';
import { ArrowLeftIcon, ChevronRightIcon, LoaderCircleIcon, PencilLineIcon, SearchIcon, ShoppingBasketIcon } from 'lucide-react';
import { cn } from 'cn';
import { CatalogItem, OrderLineInput, Paged, Product, ProductPack, ProductType } from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, Message, Notice, QtyStepper } from '@/components/wms';
import { TONES, ToneChip, toneFor, unitTone } from '@/components/magic';
import SpotlightCard from '@/components/SpotlightCard';
import { CategoryPicker, NO_FILTER, typeIcon, type CategoryFilter } from '@/components/TypeRail';
import { formatQty } from '@/lib/packs';
import { scrollToStart, touchInput } from '@/lib/touch';
import { api, ApiError } from '../api';

/** หน่วยที่ใช้บ่อยกับสินค้ากรอกเอง แตะแทนการพิมพ์บน Handheld */
const UNIT_SUGGESTIONS = ['ชิ้น', 'ซอง', 'ถุง', 'แพ็ค', 'กล่อง', 'กระป๋อง', 'ลัง'];

const errorMessage = (e: unknown): Message => ({ kind: 'error', text: e instanceof Error ? e.message : String(e) });

/** ตรวจจำนวน คืนข้อความผิดพลาด หรือ null ถ้าถูกต้อง */
function checkQty(qty: string): string | null {
  const quantity = Number(qty);
  if (!qty.trim() || !Number.isFinite(quantity) || quantity <= 0 || quantity > 100_000_000 || Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.00001) {
    return 'ใส่จำนวนมากกว่า 0 และไม่เกิน 100,000,000 (ทศนิยมไม่เกิน 3 ตำแหน่ง)';
  }
  return null;
}

/**
 * เลือกสินค้าจาก GOODSMASTER สำหรับจดออเดอร์
 * รายการสินค้า → แตะเข้าดู → เห็นบาร์โค้ดทุกตัวที่ผูกกับ SKU นั้น ใช้ชื่อหน่วยตามฐานข้อมูล (PC, PACK x 12 ...)
 * หยิบลงตะกร้าแล้วกลับมาที่รายการสินค้า เลือก/สแกนบาร์โค้ดตัวถัดไปได้ทันที
 * ตัวกรอง: ผู้สั่ง (SKU_ICCAT ไม่บังคับ ส่งมาจากหน้าออเดอร์) + ชนิดสินค้า/ชนิดย่อย (ICDEPT) ในแถบด้านบน
 * @param filters ตัวกรองผู้สั่งที่หน้าออเดอร์วาดเอง แสดงข้างแถบชนิดสินค้า
 * @param onAdd คืนข้อความผิดพลาดถ้าเพิ่มไม่ได้ (เช่น ตะกร้าเต็ม)
 */
export function OrderCatalog({ customerCode, filters, onAdd, disabled }: { customerCode: string; filters?: ReactNode; onAdd: (line: OrderLineInput) => string | null; disabled?: boolean }) {
  const [term, setTerm] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [types, setTypes] = useState<ProductType[] | null>(null);
  const [category, setCategory] = useState<CategoryFilter>(NO_FILTER);
  const [list, setList] = useState<Paged<CatalogItem> | null>(null);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const [product, setProduct] = useState<Product | null>(null);
  const [pack, setPack] = useState<ProductPack | null>(null);
  const [manual, setManual] = useState(false);
  const [itemCode, setItemCode] = useState('');
  const [itemName, setItemName] = useState('');
  const [unit, setUnit] = useState('ชิ้น');
  const [qty, setQty] = useState('1');
  const searchRef = useRef<HTMLInputElement>(null);
  const listTop = useRef<HTMLDivElement>(null);
  const [refocus, setRefocus] = useState(false);

  // เพิ่มลงออเดอร์แล้วกลับมาที่ช่องค้น พร้อมสแกนบาร์โค้ดตัวถัดไปทันที
  useEffect(() => {
    if (!refocus || product || manual) return;
    searchRef.current?.focus();
    setRefocus(false);
  }, [refocus, product, manual]);

  useEffect(() => {
    let live = true;
    setLoading(true);
    const params = new URLSearchParams({ q: query, page: String(page), customer: customerCode, ...category });
    api<Paged<CatalogItem>>(`/products/catalog?${params}`)
      .then((data) => { if (live) setList(data); })
      .catch((e) => { if (live) setMessage(errorMessage(e)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [query, page, customerCode, category]);

  // ชนิดสินค้าที่มีจริงตามผู้สั่งที่กรองอยู่ เปลี่ยนผู้สั่งแล้วล้างชนิดที่เลือกไว้ถ้าไม่มีในผู้สั่งใหม่
  useEffect(() => {
    let live = true;
    setTypes(null);
    api<ProductType[]>(`/products/types?customer=${encodeURIComponent(customerCode)}`)
      .then((rows) => {
        if (!live) return;
        setTypes(rows);
        // ชนิดที่เลือกไว้ไม่มีในผู้สั่งใหม่: ถอยกลับไปทั้งหมวด
        setCategory((c) => (c.type && !rows.some((r) => r.name === c.type) ? { ...c, type: '', sub: '' } : c));
        setPage(1);
      })
      .catch((e) => { if (live) { setTypes([]); setMessage(errorMessage(e)); } });
    return () => { live = false; };
  }, [customerCode]);

  const barcodes = product?.packs ?? [];

  function resetItem() {
    setProduct(null); setPack(null); setManual(false); setItemCode(''); setItemName(''); setUnit('ชิ้น'); setQty('1');
  }

  /** เปิดหน้าสินค้า ถ้ามาจากการสแกนบาร์โค้ด เลือกขนาดของบาร์นั้นไว้ให้ */
  async function open(code: string, scanned = false) {
    setOpening(true); setMessage(null);
    try {
      const found = await api<Product>('/products/lookup/' + encodeURIComponent(code));
      if (!found.active) throw new Error('สินค้านี้ปิดใช้งานแล้ว เลือกสินค้าอื่น');
      const packs = found.packs ?? [];
      resetItem();
      setProduct(found);
      // สแกนบาร์ไหนมาเลือกบาร์นั้น ไม่งั้นเริ่มที่บาร์โค้ดหลักของสินค้า
      setPack(packs.find((p) => p.code === code) ?? packs.find((p) => p.code === found.barcode) ?? packs[0] ?? null);
      return true;
    } catch (e) {
      if (scanned && e instanceof ApiError && e.status === 404) return false;
      setMessage(errorMessage(e));
      return true;
    } finally { setOpening(false); }
  }

  async function search() {
    const value = term.trim();
    setMessage(null);
    // สแกนบาร์โค้ดตรงตัวเปิดสินค้าเลย ไม่เจอค่อยค้นแบบคำ
    if (value && (await open(value, true))) return;
    setPage(1); setQuery(value);
  }

  function add() {
    setMessage(null);
    const error = checkQty(qty);
    if (error) return setMessage({ kind: 'error', text: error });
    let line: OrderLineInput;
    if (manual) {
      if (!itemName.trim() || !unit.trim()) return setMessage({ kind: 'error', text: 'กรอกชื่อสินค้าและหน่วยก่อนเพิ่มลงตะกร้า' });
      line = { sku: '', itemCode: itemCode.trim(), packCode: '', name: itemName.trim(), unit: unit.trim(), qty: Number(qty) };
    } else {
      if (!product || !pack) return setMessage({ kind: 'error', text: 'เลือกบาร์โค้ดก่อนเพิ่มลงตะกร้า' });
      line = { sku: product.sku, packCode: pack.code, name: pack.name, unit: pack.unitName, qty: Number(qty) };
    }
    const refused = onAdd(line);
    if (refused) return setMessage({ kind: 'error', text: refused });
    resetItem();
    // บาร์โค้ดที่สแกนล้างทิ้ง คำค้นที่ใช้กรองรายการอยู่เก็บไว้
    if (term.trim() !== query) setTerm('');
    setRefocus(true);
    setMessage({ kind: 'info', text: `เพิ่ม ${line.name} ${formatQty(line.qty)} ${line.unit} ลงตะกร้าแล้ว` });
  }

  const busy = disabled || opening;
  const qtyUnit = manual ? unit : pack?.unitName ?? '';

  if (manual) {
    return (
      <div className="grid gap-4">
        <Button variant="ghost" size="touch" className="-ml-3 justify-self-start" onClick={() => { resetItem(); setMessage(null); }} disabled={busy}>
          <ArrowLeftIcon />กลับรายการสินค้า
        </Button>
        {/* ฟอร์มเดียวต่อเนื่อง: รหัส+ชื่อ แล้วจำนวน+หน่วยคู่กัน ("5 ซอง") ปุ่มเพิ่มอยู่ท้ายฟอร์ม */}
        <form className="grid max-w-3xl gap-5" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <div className="flex items-start gap-4">
            <span aria-hidden className="grid size-14 shrink-0 place-items-center rounded-2xl bg-plum-soft text-plum"><PencilLineIcon className="size-7" /></span>
            <div className="min-w-0">
              <p className="font-heading text-xl font-semibold">กรอกสินค้าเอง</p>
              <p className="text-sm text-muted-foreground">สำหรับสินค้าใหม่ที่ยังไม่มีในทะเบียน เช่น ของที่เพิ่งเข้ามาหน้างาน</p>
            </div>
          </div>
          <fieldset disabled={busy} className="grid min-w-0 gap-4">
            <div className="grid gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <Field id="order-item-code" label="รหัสสินค้า (ถ้ามี)"><Input id="order-item-code" className={`${touchInput} font-mono`} value={itemCode} onChange={(e) => setItemCode(e.target.value)} maxLength={50} placeholder="สแกนหรือพิมพ์รหัส" autoComplete="off" /></Field>
              <Field id="order-item-name" label="ชื่อสินค้า *"><Input id="order-item-name" className={touchInput} value={itemName} onChange={(e) => setItemName(e.target.value)} maxLength={200} placeholder="เช่น ขนมแมวรสทูน่า 70 ก." /></Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-[14rem_minmax(0,1fr)]">
              <Field id="order-qty" label="จำนวน *"><QtyStepper id="order-qty" label="จำนวน" value={qty} onChange={setQty} /></Field>
              <div className="grid min-w-0 gap-1.5">
                <Field id="order-unit" label="หน่วย *"><Input id="order-unit" className={touchInput} value={unit} onChange={(e) => setUnit(e.target.value)} maxLength={30} placeholder="เช่น ชิ้น ซอง ถุง" /></Field>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="หน่วยที่ใช้บ่อย">
                  {UNIT_SUGGESTIONS.map((u) => (
                    <button key={u} type="button" aria-pressed={unit === u} onClick={() => setUnit(u)}
                      className={cn('min-h-12 rounded-full px-3.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                        unit === u ? 'bg-plum font-semibold text-primary-foreground' : 'bg-plum-soft text-plum hover:brightness-95')}>
                      {u}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button type="submit" size="touch" className="w-full bg-star text-on-star hover:bg-star/90 sm:w-auto" disabled={busy}><ShoppingBasketIcon />เพิ่มลงตะกร้า</Button>
            {itemName.trim() && <p className="min-w-0 text-sm text-muted-foreground" aria-live="polite">{itemName.trim()} × <span className="font-semibold text-foreground tabular-nums">{formatQty(Number(qty) || 0)} {unit || 'หน่วย'}</span></p>}
          </div>
        </form>
        <Notice message={message} />
      </div>
    );
  }

  if (product) {
    return (
      <div className="grid gap-4">
        <Button variant="ghost" size="touch" className="-ml-3 justify-self-start" onClick={() => { resetItem(); setMessage(null); }} disabled={busy}>
          <ArrowLeftIcon />กลับรายการสินค้า
        </Button>
        <fieldset disabled={busy} className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
          <div className="grid min-w-0 gap-4">
            {product && (
              <>
                <div className="flex min-w-0 items-start gap-4">
                  <TypeAvatar name={product.categoryGroup || product.category} className="size-16 sm:size-20 [&_svg]:size-8 sm:[&_svg]:size-10" />
                  <div className="min-w-0">
                    <p className="font-heading text-xl font-semibold break-words">{product.name}</p>
                    <p className="text-sm text-muted-foreground">{[product.sku, product.brand].filter(Boolean).join(' · ')}</p>
                    {(product.categoryGroup || product.category) && <p className="mt-1.5 flex flex-wrap gap-1"><ToneChip tone={toneFor(product.categoryGroup || product.category)}>{product.categoryGroup || product.category}</ToneChip>{product.category && product.categoryGroup && product.category !== product.categoryGroup && <ToneChip tone="plum">{product.category}</ToneChip>}</p>}
                  </div>
                </div>
                {barcodes.length ? (
                  <div className="grid gap-1.5">
                    <span id="order-barcodes" className="text-sm font-medium">เลือกบาร์โค้ดที่จะสั่ง <span className="text-muted-foreground">({barcodes.length})</span></span>
                    <div role="radiogroup" aria-labelledby="order-barcodes" className="grid gap-2 sm:grid-cols-2">
                      {barcodes.map((p) => <BarcodeOption key={p.code} pack={p} product={product} selected={pack?.code === p.code} onSelect={() => setPack(p)} />)}
                    </div>
                  </div>
                ) : <Notice message={{ kind: 'error', text: 'สินค้านี้ไม่มีบาร์โค้ดที่ใช้สั่งได้ กลับไปเลือกสินค้าอื่น หรือกด “กรอกสินค้าเอง”' }} />}
              </>
            )}
          </div>
          {pack && (
            <form className="grid gap-4 border-t border-border pt-4 lg:sticky lg:top-24 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6" onSubmit={(e) => { e.preventDefault(); add(); }}>
              <p className="text-sm text-muted-foreground" aria-live="polite">
                สั่งเป็น <span className="font-semibold text-foreground">{pack.unitName}</span> · <span className="font-mono">{pack.code}</span>
              </p>
              <Field id="order-qty" label={`จำนวน (${qtyUnit || 'หน่วย'}) *`}><QtyStepper id="order-qty" label="จำนวน" value={qty} onChange={setQty} /></Field>
              <Button type="submit" size="touch" className="bg-star text-on-star hover:bg-star/90"><ShoppingBasketIcon />เพิ่มลงตะกร้า</Button>
            </form>
          )}
        </fieldset>
        <Notice message={message} />
      </div>
    );
  }

  return (
    <div ref={listTop} className="grid scroll-mt-20 gap-4">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <Input ref={searchRef} aria-label="ค้นสินค้า" className={touchInput} value={term} onChange={(e) => setTerm(e.target.value)} maxLength={100} placeholder="ชื่อ / SKU / ยี่ห้อ หรือสแกนบาร์โค้ด" disabled={busy} />
        <Button type="submit" size="icon-touch" aria-label="ค้นสินค้า" disabled={busy || loading}>{opening || loading ? <LoaderCircleIcon className="animate-spin" /> : <SearchIcon />}</Button>
      </form>
      {filters}
      <CategoryPicker types={types} value={category} disabled={busy} onChange={(v) => { setCategory(v); setPage(1); }} />
      <Notice message={message} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" role="status">
          {list ? <>{query ? `ผลค้น “${query}” ` : ''}{list.total.toLocaleString('th-TH')} รายการ · หน้า {list.page}/{list.pages}</> : 'กำลังโหลดสินค้า…'}
        </p>
        <Button variant="outline" size="touch" disabled={busy} onClick={() => { resetItem(); setManual(true); setMessage(null); }}><PencilLineIcon />กรอกสินค้าเอง</Button>
      </div>
      {list && !list.rows.length && !loading && (
        <p className="py-3 text-sm text-muted-foreground">{query ? `ไม่พบสินค้าที่ตรงกับ “${query}” ลองคำอื่น หรือกด “กรอกสินค้าเอง” ถ้าเป็นสินค้าใหม่` : 'ไม่มีสินค้าในหมวดหรือผู้สั่งที่เลือก ลองเปลี่ยนหมวด หรือล้างตัวกรองผู้สั่ง'}</p>
      )}
      <div className={cn('grid gap-2 md:grid-cols-2 xl:grid-cols-3', loading && 'opacity-60')} aria-busy={loading}>
        {list?.rows.map((item) => {
          return (
            <SpotlightCard key={item.sku} className="transition-[border-color,transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:border-star/60 hover:shadow-lift motion-reduce:hover:translate-y-0">
              <button
                type="button"
                disabled={busy}
                onClick={() => void open(item.sku)}
                className="relative flex min-h-24 w-full items-center gap-3 px-3 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset disabled:opacity-60"
              >
                <TypeAvatar name={item.categoryGroup} className="size-14 [&_svg]:size-7" />
                <span className="grid min-w-0 flex-1 gap-1">
                  <strong className="line-clamp-2 font-medium break-words">{item.name}</strong>
                  <span className="truncate text-sm text-muted-foreground">{[item.brand, item.categoryGroup].filter(Boolean).join(' · ') || item.sku}</span>
                  <span className="flex flex-wrap gap-1">{item.units.map((u) => <ToneChip key={u.name} tone={unitTone(u.qty)}>{u.name}</ToneChip>)}</span>
                </span>
                <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            </SpotlightCard>
          );
        })}
      </div>
      {list && list.pages > 1 && (
        <div className="flex justify-between gap-3">
          <Button variant="outline" size="touch" disabled={loading || page <= 1} onClick={() => { setPage(page - 1); scrollToStart(listTop.current); }}>หน้าก่อน</Button>
          <Button variant="outline" size="touch" disabled={loading || page >= list.pages} onClick={() => { setPage(page + 1); scrollToStart(listTop.current); }}>หน้าถัดไป</Button>
        </div>
      )}
    </div>
  );
}

/** ปุ่มเลือกบาร์โค้ด 1 ตัว: หน่วยตามฐานข้อมูล จำนวนต่อหน่วย รหัส และชื่อเรียก (GOODS_ALIAS) ถ้าต่างจากชื่อสินค้า */
function BarcodeOption({ pack, product, selected, onSelect }: { pack: ProductPack; product: Product; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'grid min-h-12 content-center gap-1 rounded-xl border-2 px-3 py-2.5 text-left transition-[border-color,background-color,box-shadow] outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
        selected ? 'border-star bg-star-soft/60 shadow-[0_0_0_4px_color-mix(in_oklab,var(--pm-star)_18%,transparent)]' : 'border-border bg-card hover:border-star/50',
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <ToneChip tone={unitTone(pack.unitQty)} className="h-7 px-3 font-heading text-sm">{pack.unitName}</ToneChip>
        {pack.factor !== 1 && <span className="text-xs text-muted-foreground tabular-nums">= {formatQty(pack.factor)} {product.unit}</span>}
      </span>
      <span className="font-mono text-sm break-all">{pack.code}</span>
      {pack.name !== product.name && <span className="text-xs text-muted-foreground break-words">{pack.name}</span>}
    </button>
  );
}

/** ภาพแทนสินค้า: ไอคอนชนิดสินค้าบนพื้นสีประจำชนิด สีเดียวกับชิปในแถบชนิดสินค้า */
function TypeAvatar({ name, className }: { name: string; className?: string }) {
  const Icon = typeIcon(name);
  return <span aria-hidden className={cn('grid shrink-0 place-items-center rounded-2xl', TONES[name ? toneFor(name) : 'plum'], className)}><Icon /></span>;
}
