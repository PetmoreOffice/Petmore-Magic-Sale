import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  LoaderCircleIcon,
  MapPinIcon,
  PackageIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { cn } from 'cn';
import {
  Location,
  MAX_RECEIPT_LINES,
  Product,
  ProductPack,
  Receipt,
  RECEIPT_KINDS,
  ReceiptKind,
  ReceivingSetup,
  ScanResult,
  STOCK_STATUSES,
  StockStatus,
} from '@petmore/shared';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScanFeedback, ScanInput, ScanInputHandle } from '@/components/ScanInput';
import { SparkBurst, SparkBurstHandle } from '@/components/SparkBurst';
import { Field, Message, Notice, PickTile, StatusBadge } from '@/components/wms';
import { PackPicker } from '@/components/PackPicker';
import { defaultPack, formatQty } from '@/lib/packs';
import { touchInput } from '@/lib/touch';
import { api, ApiError, formatTime, newRequestId, todayIso } from '../api';

interface DraftLine {
  product: Product;
  location: Location;
  /** ขนาดบรรจุที่รับ และจำนวนตามขนาดนั้น (ยอดเข้าสต็อก = packQty × pack.factor) */
  pack: ProductPack;
  packQty: number;
  lot: string;
  expiry: string;
  status: StockStatus;
}

export function ReceivePage() {
  const [setup, setSetup] = useState<ReceivingSetup | null>(null);
  const [kind, setKind] = useState<ReceiptKind>('RECEIVE');
  const [warehouse, setWarehouse] = useState('');
  const [date, setDate] = useState(todayIso());
  const [reference, setReference] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [source, setSource] = useState('');
  const [note, setNote] = useState('');

  const [product, setProduct] = useState<Product | null>(null);
  const [pack, setPack] = useState<ProductPack | null>(null);
  const [scannedPackCode, setScannedPackCode] = useState<string | null>(null);
  const [location, setLocation] = useState<Location | null>(null);
  const [qty, setQty] = useState('1');
  const [lot, setLot] = useState('');
  const [expiry, setExpiry] = useState('');
  const [status, setStatus] = useState<StockStatus>('FG');

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [saveMessage, setSaveMessage] = useState<Message | null>(null);
  const [docOpen, setDocOpen] = useState(false);
  const [showDocErrors, setShowDocErrors] = useState(false);
  const [focusField, setFocusField] = useState<'rx-reference' | 'rx-source' | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<Receipt | null>(null);
  const attempt = useRef<{ hash: string; requestId: string } | null>(null);
  const scanRef = useRef<ScanInputHandle>(null);
  const productSpark = useRef<SparkBurstHandle>(null);
  // รหัสที่สแกน/พิมพ์ไม่ตรงตัว: ค้นจากชื่อแบบไม่สนเว้นวรรค (เหมือนหน้าออเดอร์) แล้วให้แตะเลือก
  const [hits, setHits] = useState<{ term: string; rows: Product[] } | null>(null);
  const locationSpark = useRef<SparkBurstHandle>(null);
  const savedSpark = useRef<SparkBurstHandle>(null);

  useEffect(() => {
    api<ReceivingSetup>('/receipts/setup')
      .then((s) => {
        setSetup(s);
        if (s.warehouses.length === 1) setWarehouse(s.warehouses[0].code);
      })
      .catch((e: Error) => setMessage({ text: e.message, kind: 'error' }));
  }, []);

  useEffect(() => {
    if (saved) savedSpark.current?.burst();
  }, [saved]);

  /** เริ่มใบรับใหม่โดยไม่โหลดหน้าใหม่ คงคลังเดิมไว้ (มักรับต่อที่คลังเดียวกัน) วันที่กลับเป็นวันนี้ */
  function startNew() {
    setKind('RECEIVE');
    setDate(todayIso());
    setReference('');
    setPoNumber('');
    setSource('');
    setNote('');
    setProduct(null);
    setPack(null);
    setScannedPackCode(null);
    setLocation(null);
    setQty('1');
    setLot('');
    setExpiry('');
    setStatus('FG');
    setLines([]);
    setMessage(null);
    setSaveMessage(null);
    setDocOpen(false);
    setShowDocErrors(false);
    attempt.current = null;
    setSaved(null);
  }

  async function handleScan(code: string): Promise<ScanFeedback> {
    setMessage(null);
    try {
      const r = await api<ScanResult>('/scan/' + encodeURIComponent(code));
      if (r.type === 'product') return takeProduct(r.product, r.packCode);
      const l = r.location;
      if (!l.active) throw new Error(`Location ${l.displayCode} ปิดใช้งานอยู่ สแกน Location อื่น`);
      if (!warehouse && !lines.length) setWarehouse(l.warehouse);
      else if (l.warehouse !== warehouse) throw new Error(`Location ${l.displayCode} อยู่คลัง ${l.warehouse} ใบนี้รับเข้าคลัง ${warehouse}`);
      setLocation(l);
      locationSpark.current?.burst();
      return { ok: true, text: `Location ${l.displayCode}` };
    } catch (e) {
      // ไม่ใช่บาร์โค้ด/Location: ลองค้นชื่อสินค้า เจอแล้วแสดงรายการให้เลือก
      if (e instanceof ApiError && e.status === 404 && code.trim().length >= 2) {
        try {
          const rows = (await api<Product[]>('/products?q=' + encodeURIComponent(code.trim()))).filter((p) => p.active).slice(0, 20);
          if (rows.length) {
            setHits({ term: code.trim(), rows });
            return { ok: true, text: `ค้น “${code.trim()}” พบ ${rows.length}${rows.length === 20 ? '+' : ''} รายการ แตะเลือกด้านล่าง` };
          }
        } catch { /* ใช้ข้อความ 404 เดิม */ }
      }
      setMessage({ text: e instanceof Error ? e.message : String(e), kind: 'error' });
      navigator.vibrate?.([60, 60, 60]);
      return { ok: false };
    }
  }

  /** ตั้งสินค้าที่จะรับ ขนาดบรรจุตั้งต้นตามบาร์โค้ดที่สแกน เช่นสแกนบาร์โค้ดแพ็ค 12 ได้ "PACK x 12" ทันที */
  function takeProduct(found: Product, packCode: string | null): ScanFeedback {
    if (!found.active) throw new Error(`สินค้า ${found.sku} ปิดใช้งานอยู่ รับเข้าไม่ได้`);
    const scannedPack = defaultPack(found, packCode);
    setHits(null);
    setProduct(found);
    setPack(scannedPack);
    setScannedPackCode(packCode);
    setQty('1');
    setExpiry('');
    setLot('');
    productSpark.current?.burst();
    return { ok: true, text: `${scannedPack.name} · ${scannedPack.unitName}` };
  }

  /** เลือกจากผลค้นชื่อ: ดึงสินค้าพร้อมบาร์โค้ดทุกขนาด แล้วกลับไปที่ช่องสแกน */
  async function pickHit(sku: string) {
    setMessage(null);
    try {
      takeProduct(await api<Product>('/products/lookup/' + encodeURIComponent(sku)), null);
      scanRef.current?.focus();
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), kind: 'error' });
    }
  }

  function addLine() {
    const n = Number(qty);
    if (!product || !pack || !location) return setMessage({ text: 'สแกนสินค้าและ Location ก่อนเพิ่มรายการ', kind: 'error' });
    if (!Number.isFinite(n) || n <= 0) return setMessage({ text: 'กรอกจำนวนมากกว่า 0', kind: 'error' });
    if (product.expiryRequired && !expiry) return setMessage({ text: `${product.sku} ต้องมีวันหมดอายุ กรอกวันหมดอายุก่อนเพิ่มรายการ`, kind: 'error' });
    const same = (l: DraftLine) =>
      l.product.sku === product.sku &&
      l.pack.code === pack.code &&
      l.location.id === location.id &&
      l.lot === lot.trim() &&
      l.expiry === expiry &&
      l.status === status;
    if (lines.some(same)) {
      setLines(lines.map((l) => (same(l) ? { ...l, packQty: l.packQty + n } : l)));
    } else {
      if (lines.length >= MAX_RECEIPT_LINES) return setMessage({ text: `ใบนี้ครบ ${MAX_RECEIPT_LINES} รายการแล้ว บันทึกใบนี้ แล้วสร้างใบรับใหม่`, kind: 'error' });
      setLines([...lines, { product, location, pack, packQty: n, lot: lot.trim(), expiry, status }]);
    }
    const stockQty = n * pack.factor;
    setProduct(null);
    setPack(null);
    setScannedPackCode(null);
    setQty('1');
    setLot('');
    setExpiry('');
    setMessage({
      text:
        `เพิ่ม ${pack.name} ${formatQty(n)} ${pack.unitName}` +
        (pack.factor !== 1 ? ` (= ${formatQty(stockQty)} ${product.unit})` : '') +
        ` ที่ ${location.displayCode} แล้ว`,
      kind: 'info',
    });
    scanRef.current?.focus();
  }

  function openConfirm() {
    setSaveMessage(null);
    if (!lines.length) return setSaveMessage({ text: 'เพิ่มสินค้าอย่างน้อย 1 รายการก่อนบันทึก', kind: 'error' });
    const missing = !reference.trim() ? 'rx-reference' : !source.trim() ? 'rx-source' : null;
    if (missing) {
      // การ์ดเอกสารพับอยู่ได้ จึงกางให้เอง แล้วพาไปที่ช่องที่ยังไม่กรอก
      setShowDocErrors(true);
      setDocOpen(true);
      setFocusField(missing);
      return;
    }
    setConfirmOpen(true);
  }

  useEffect(() => {
    if (!docOpen || !focusField) return;
    const el = document.getElementById(focusField);
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    el?.focus({ preventScroll: true });
    setFocusField(null);
  }, [docOpen, focusField]);

  async function save() {
    const body = {
      kind,
      warehouse,
      date,
      reference,
      poNumber,
      source,
      note,
      lines: lines.map((l) => ({
        sku: l.product.sku,
        locationId: l.location.id,
        packCode: l.pack.code,
        packQty: l.packQty,
        lot: l.lot,
        expiry: l.expiry,
        status: l.status,
      })),
    };
    // ข้อมูลชุดเดิมใช้ requestId เดิม ถ้าเน็ตหลุดแล้วกดซ้ำ เซิร์ฟเวอร์จะไม่เพิ่มสต็อกซ้ำ
    const hash = JSON.stringify(body);
    if (!attempt.current || attempt.current.hash !== hash) attempt.current = { hash, requestId: newRequestId() };
    setSaving(true);
    try {
      const r = await api<Receipt>('/receipts', { method: 'POST', body: { ...body, requestId: attempt.current.requestId } });
      setConfirmOpen(false);
      setSaved(r);
    } catch (e) {
      setConfirmOpen(false);
      setSaveMessage({ text: e instanceof Error ? e.message : String(e), kind: 'error' });
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="mx-auto grid max-w-3xl gap-4">
        <Card className="relative overflow-visible">
          <SparkBurst ref={savedSpark} count={16} reach={30} />
          <CardHeader>
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-mint">
              <CheckCircle2Icon className="size-4" aria-hidden="true" />
              บันทึกใบรับแล้ว สต็อกเพิ่มแล้ว
            </span>
            <CardTitle role="heading" aria-level={2} className="text-2xl">
              {saved.id}
            </CardTitle>
            <CardDescription>
              {RECEIPT_KINDS[saved.kind]} · คลัง {saved.warehouse} · {saved.reference} · {formatTime(saved.createdAt)} · {saved.createdBy}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>SKU / ชื่อ</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">จำนวน</TableHead>
                  <TableHead>ล็อต / หมดอายุ</TableHead>
                  <TableHead>สถานะ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {saved.lines.map((l) => (
                  <TableRow key={l.lineNo}>
                    <TableCell className="tabular-nums">{l.lineNo}</TableCell>
                    <TableCell>
                      <div className="font-medium">{l.packName || l.name}</div>
                      <div className="text-muted-foreground">{l.sku}</div>
                    </TableCell>
                    <TableCell>{l.locationCode}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div className="font-medium">
                        {formatQty(l.packQty)} {l.packUnit}
                      </div>
                      {l.factor !== 1 && (
                        <div className="text-muted-foreground">
                          = {formatQty(l.qty)} {l.unit}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {l.lot || '—'} / {l.expiry || '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={l.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Button size="touch" className="w-full" onClick={startNew}>
          <PlusIcon />
          สร้างใบรับใหม่
        </Button>
      </div>
    );
  }

  const lockedWarehouse = lines.length > 0;
  // รวมเป็นหน่วยนับสต็อก (คนละสินค้าอาจคนละหน่วย จึงบอกเป็น "หน่วยนับสต็อก")
  const totalQty = lines.reduce((sum, l) => sum + l.packQty * l.pack.factor, 0);
  const qtyNumber = Number(qty);
  const stockPreview = pack && Number.isFinite(qtyNumber) && qtyNumber > 0 ? qtyNumber * pack.factor : null;
  const missingDoc = [!reference.trim() && 'เลขที่เอกสารอ้างอิง', !source.trim() && 'ผู้ส่ง'].filter(Boolean) as string[];
  const docSummary = [RECEIPT_KINDS[kind], warehouse ? `คลัง ${warehouse}` : 'ยังไม่เลือกคลัง', date, reference.trim(), source.trim()]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="mx-auto grid max-w-3xl gap-4">
      {/* เวทีสแกนอยู่บนสุด แยกจากการ์ด: เปิดหน้ามาบน Handheld เห็นช่องสแกนและผลที่สแกนได้ทันที */}
      <ScanInput ref={scanRef} label="สแกนสินค้าหรือป้าย Location" placeholder="สแกนบาร์โค้ด หรือพิมพ์ชื่อสินค้าแล้วกด Enter" onScan={handleScan} autoFocus disabled={!setup} />
      {hits && (
        <section aria-label="ผลค้นชื่อสินค้า" className="grid gap-2 rounded-xl border border-border bg-card p-3">
          <div className="flex items-center gap-2">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">ผลค้น “{hits.term}” · {hits.rows.length}{hits.rows.length === 20 ? '+' : ''} รายการ แตะสินค้าที่จะรับ</p>
            <Button variant="ghost" size="icon-touch" aria-label="ปิดผลค้นหา" onClick={() => { setHits(null); scanRef.current?.focus(); }}><XIcon /></Button>
          </div>
          <ul className="grid max-h-80 gap-1 overflow-y-auto overscroll-contain">
            {hits.rows.map((p) => (
              <li key={p.sku}>
                <button type="button" onClick={() => void pickHit(p.sku)} className="flex min-h-14 w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none hover:bg-secondary focus-visible:ring-3 focus-visible:ring-ring/50">
                  <span className="grid min-w-0 flex-1">
                    <span className="font-medium break-words">{p.name}</span>
                    <span className="truncate text-sm text-muted-foreground">{[p.sku, p.brand, p.unit].filter(Boolean).join(' · ')}</span>
                  </span>
                  <ChevronRightIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!setup && !message && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
          <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
          กำลังโหลดรายชื่อคลัง…
        </p>
      )}
      <Card className="overflow-visible">
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {/* ชื่อที่แสดงเป็นชื่อของขนาดบรรจุ (GOODSMASTER) ส่วนรายละเอียดมาจากสินค้าหลัก (SKUMASTER) */}
            <PickTile
              icon={<PackageIcon className="size-5" />}
              label="สินค้า"
              value={product ? (pack?.name ?? product.name) : undefined}
              detail={
                product
                  ? [product.sku, product.brand, product.category, product.expiryRequired && 'ต้องมีวันหมดอายุ'].filter(Boolean).join(' · ')
                  : undefined
              }
              sparkRef={productSpark}
            />
            <PickTile
              icon={<MapPinIcon className="size-5" />}
              label="Location"
              value={location?.displayCode}
              detail={location ? `คลัง ${location.warehouse}` : undefined}
              sparkRef={locationSpark}
            />
          </div>
          {product && pack && (
            <PackPicker
              product={product}
              value={pack}
              scannedCode={scannedPackCode}
              onChange={(next) => {
                setPack(next);
                scanRef.current?.focus();
              }}
            />
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field id="rx-qty" label={pack ? `จำนวน (${pack.unitName})` : 'จำนวน'}>
              <Input
                id="rx-qty"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                className={cn(touchInput, 'tabular-nums')}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                aria-describedby={pack && pack.factor !== 1 ? 'rx-qty-stock' : undefined}
              />
              {/* แปลงเป็นหน่วยนับสต็อกให้เห็นทันที กันกรอกผิดหน่วย */}
              {product && pack && pack.factor !== 1 && stockPreview !== null && (
                <span id="rx-qty-stock" className="text-xs font-medium text-star-ink tabular-nums">
                  = {formatQty(stockPreview)} {product.unit} เข้าสต็อก
                </span>
              )}
            </Field>
            <Field id="rx-lot" label="ล็อต">
              <Input id="rx-lot" className={touchInput} value={lot} onChange={(e) => setLot(e.target.value)} />
            </Field>
            <Field id="rx-expiry" label={product?.expiryRequired ? 'วันหมดอายุ (บังคับ)' : 'วันหมดอายุ'}>
              <Input
                id="rx-expiry"
                type="date"
                className={touchInput}
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
                required={product?.expiryRequired}
                aria-invalid={!!product?.expiryRequired && !expiry}
              />
            </Field>
            <Field id="rx-status" label="สถานะ">
              <NativeSelect id="rx-status" size="touch" className="w-full" value={status} onChange={(e) => setStatus(e.target.value as StockStatus)}>
                {Object.entries(STOCK_STATUSES).map(([k, v]) => (
                  <NativeSelectOption key={k} value={k}>
                    {v}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Button size="touch" className="w-full" onClick={addLine} disabled={!product || !location}>
            <PlusIcon />
            เพิ่มรายการ
          </Button>
          <Notice message={message} />
        </CardContent>
      </Card>

      {/* ข้อมูลเอกสาร: คลังกับวันที่ตั้งให้อัตโนมัติ จึงพับไว้เป็นบรรทัดสรุป กางเมื่อจะกรอก */}
      <Card className="gap-0 py-0">
        <button
          type="button"
          data-slot="collapsible-trigger"
          className="flex min-h-14 w-full items-center gap-3 rounded-xl px-4 py-3 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          aria-expanded={docOpen}
          aria-controls="rx-doc-fields"
          onClick={() => setDocOpen((open) => !open)}
        >
          <FileTextIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="grid min-w-0 flex-1">
            <span className="font-heading text-base font-medium">ข้อมูลเอกสาร</span>
            <span className="truncate text-sm text-muted-foreground">{docSummary}</span>
          </span>
          {missingDoc.length > 0 && (
            <Badge variant={showDocErrors ? 'destructive' : 'outline'} className="shrink-0">
              ยังไม่กรอก {missingDoc.length} ช่อง
            </Badge>
          )}
          <ChevronDownIcon
            className={cn('size-5 shrink-0 text-muted-foreground transition-transform', docOpen && 'rotate-180')}
            aria-hidden="true"
          />
        </button>
        {docOpen && (
          <CardContent id="rx-doc-fields" className="grid gap-3 pb-4 sm:grid-cols-2">
            <Field id="rx-reference" label="เลขที่ Invoice / เอกสารอ้างอิง (บังคับ)">
              <Input
                id="rx-reference"
                className={touchInput}
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                aria-required="true"
                aria-invalid={showDocErrors && !reference.trim()}
              />
            </Field>
            <Field id="rx-source" label="ผู้ส่ง / ที่มา (บังคับ)">
              <Input
                id="rx-source"
                className={touchInput}
                value={source}
                onChange={(e) => setSource(e.target.value)}
                aria-required="true"
                aria-invalid={showDocErrors && !source.trim()}
              />
            </Field>
            <Field id="rx-kind" label="ประเภท">
              <NativeSelect id="rx-kind" size="touch" className="w-full" value={kind} onChange={(e) => setKind(e.target.value as ReceiptKind)}>
                {Object.entries(RECEIPT_KINDS).map(([k, v]) => (
                  <NativeSelectOption key={k} value={k}>
                    {v}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field id="rx-warehouse" label="คลัง">
              <NativeSelect
                id="rx-warehouse"
                size="touch"
                className="w-full"
                value={warehouse}
                onChange={(e) => setWarehouse(e.target.value)}
                disabled={lockedWarehouse}
              >
                <NativeSelectOption value="">เลือกคลัง</NativeSelectOption>
                {setup?.warehouses.map((w) => (
                  <NativeSelectOption key={w.code} value={w.code}>
                    {w.code} — {w.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field id="rx-date" label="วันที่รับ">
              <Input id="rx-date" type="date" className={touchInput} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id="rx-po" label="เลขที่ PO (ถ้ามี)">
              <Input id="rx-po" className={touchInput} value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
            </Field>
            <Field id="rx-note" label="หมายเหตุ (ถ้ามี)" className="sm:col-span-2">
              <Input id="rx-note" className={touchInput} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            {showDocErrors && missingDoc.length > 0 && (
              <p className="text-sm text-destructive sm:col-span-2" role="alert">
                กรอก{missingDoc.join('และ')}ก่อนบันทึกใบรับ
              </p>
            )}
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle role="heading" aria-level={2}>
            รายการในใบรับ{' '}
            <span className="text-muted-foreground tabular-nums">
              ({lines.length}/{MAX_RECEIPT_LINES})
            </span>
          </CardTitle>
          <CardDescription className="tabular-nums">
            {lines.length > 0
              ? `รวม ${totalQty.toLocaleString('th-TH')} หน่วยนับสต็อก · คลัง ${warehouse}`
              : `ตรวจนับของจริงก่อนบันทึก · สูงสุด ${MAX_RECEIPT_LINES} รายการต่อใบ`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {!lines.length && <p className="text-sm text-muted-foreground">ยังไม่มีสินค้าในใบรับ สแกนสินค้าและ Location เพื่อเริ่ม</p>}
          {lines.length > 0 && (
            <ul className="divide-y divide-border">
              {lines.map((l, i) => (
                <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{l.pack.name}</div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <span>{l.product.sku}</span>
                      <span>{l.location.displayCode}</span>
                      <span>ล็อต {l.lot || '—'}</span>
                      <span>หมดอายุ {l.expiry || '—'}</span>
                      <StatusBadge status={l.status} />
                    </div>
                  </div>
                  <span className="grid text-right whitespace-nowrap tabular-nums">
                    <span className="font-semibold">
                      {formatQty(l.packQty)} {l.pack.unitName}
                    </span>
                    {l.pack.factor !== 1 && (
                      <span className="text-xs text-muted-foreground">
                        = {formatQty(l.packQty * l.pack.factor)} {l.product.unit}
                      </span>
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-touch"
                    aria-label={`ลบ ${l.product.sku} ออกจากใบรับ`}
                    onClick={() => setLines(lines.filter((_, j) => j !== i))}
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <Notice message={saveMessage} />
          <Button size="touch" className="w-full" onClick={openConfirm} disabled={saving || !lines.length}>
            <SparklesIcon />
            บันทึกใบรับสินค้า
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={(open) => !saving && setConfirmOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันบันทึกใบรับสินค้า</AlertDialogTitle>
            <AlertDialogDescription>
              {lines.length} รายการ รวม {totalQty.toLocaleString('th-TH')} หน่วยนับสต็อก เข้าคลัง {warehouse} บันทึกแล้วสต็อกเพิ่มทันที และแก้ไขใบนี้ไม่ได้
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
              {saving ? 'กำลังบันทึกใบรับ…' : 'บันทึกใบรับ'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
