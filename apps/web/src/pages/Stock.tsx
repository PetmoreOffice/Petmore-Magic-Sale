import { useEffect, useRef, useState } from 'react';
import { LoaderCircleIcon, MapPinIcon, XIcon } from 'lucide-react';
import type { StockRow } from '@petmore/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ScanFeedback, ScanInput, ScanInputHandle } from '@/components/ScanInput';
import { Message, Notice, QtyBreakdown, StatusBadge } from '@/components/wms';
import { formatQty } from '@/lib/packs';
import { api } from '../api';

export function StockPage() {
  const [term, setTerm] = useState('');
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [loading, setLoading] = useState(true);
  const scanRef = useRef<ScanInputHandle>(null);

  /** คืนจำนวนแถวที่พบ หรือ null ถ้าโหลดไม่สำเร็จ */
  async function load(q: string): Promise<number | null> {
    setMessage(null);
    setLoading(true);
    try {
      const found = await api<StockRow[]>('/stock?q=' + encodeURIComponent(q));
      setRows(found);
      setTerm(q);
      return found.length;
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), kind: 'error' });
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function search(code: string): Promise<ScanFeedback> {
    const n = await load(code);
    // ไม่เจออะไรเลย = รหัสผิดหรือไม่มีสต็อก บอกเหตุผลใต้ช่องสแกนด้วย ไม่สั่นแดงเฉยๆ
    return n ? { ok: true, text: `${code} · ${n.toLocaleString('th-TH')} รายการ` } : { ok: false, text: `ไม่พบสต็อกที่ตรงกับ “${code}”` };
  }

  async function clearSearch() {
    await load('');
    // ล้างแล้วพร้อมสแกนชิ้นถัดไปทันที
    scanRef.current?.focus();
  }

  useEffect(() => {
    void load('');
  }, []);

  const total = rows?.reduce((sum, r) => sum + r.qty, 0) ?? 0;
  return (
    <div className="grid gap-4">
      {/* ช่องเดียวใช้ได้ทั้งสแกนบาร์โค้ด/ป้าย Location และพิมพ์คำค้น */}
      <ScanInput
        ref={scanRef}
        label="ค้นสต็อกด้วย SKU ชื่อสินค้า Location หรือล็อต"
        placeholder="เช่น SKU หรือ A-01"
        hint="สแกนบาร์โค้ดสินค้า/ป้าย Location หรือพิมพ์แล้วกด Enter"
        onScan={search}
        autoFocus
      />
      {term && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-secondary px-3 py-1">
          <span className="min-w-0 truncate text-sm">
            ผลการค้นหา <strong className="font-semibold">{term}</strong>
          </span>
          <Button variant="ghost" size="touch" className="-mr-2 shrink-0 px-3" onClick={() => void clearSearch()} disabled={loading}>
            <XIcon />
            ล้างคำค้น
          </Button>
        </div>
      )}
      <Notice message={message} />

      {!rows && loading && (
        <Card>
          <CardContent>
            <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
              <LoaderCircleIcon className="size-4 animate-spin" aria-hidden="true" />
              กำลังโหลดสต็อก…
            </p>
          </CardContent>
        </Card>
      )}

      {rows && (
        <Card aria-busy={loading}>
          <CardHeader>
            <CardTitle role="heading" aria-level={2}>
              สต็อกคงเหลือ
            </CardTitle>
            <CardDescription className="tabular-nums" role="status">
              {loading ? 'กำลังค้นหาสต็อก…' : `${rows.length.toLocaleString('th-TH')} รายการ · รวม ${total.toLocaleString('th-TH')} หน่วยนับสต็อก`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!rows.length && (
              <p className="text-sm text-muted-foreground">
                {term
                  ? `ไม่พบสต็อกที่ตรงกับ "${term}" ลองคำค้นอื่น หรือแตะ "ล้างคำค้น" เพื่อดูทั้งหมด`
                  : 'ยังไม่มีสต็อกในคลังที่คุณมีสิทธิ์ เริ่มจากเมนูรับสินค้า'}
              </p>
            )}

            {/* จอแคบ (Handheld/มือถือ): การ์ดทีละแถว อ่านได้โดยไม่ต้องเลื่อนซ้ายขวา */}
            {rows.length > 0 && (
              <ul className="divide-y divide-border sm:hidden">
                {rows.map((r) => (
                  <li key={r.id} className="grid gap-1 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-semibold">{r.name}</div>
                        <div className="text-sm text-muted-foreground">{[r.sku, r.brand].filter(Boolean).join(' · ')}</div>
                      </div>
                      <div className="shrink-0 text-right font-heading text-lg font-semibold tabular-nums">
                        {formatQty(r.qty)} <span className="text-sm font-normal text-muted-foreground">{r.unit}</span>
                      </div>
                    </div>
                    <QtyBreakdown qty={r.qty} unit={r.unit} unitQty={r.unitQty} sizes={r.sizes} className="justify-end" />
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1 font-medium text-foreground">
                        <MapPinIcon className="size-3.5" aria-hidden="true" />
                        {r.locationCode}
                      </span>
                      <span>คลัง {r.warehouse}</span>
                      <span>ล็อต {r.lot || '—'}</span>
                      <span>หมดอายุ {r.expiry || '—'}</span>
                      <StatusBadge status={r.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* จอกว้าง: ตาราง */}
            {rows.length > 0 && (
              <div className="hidden sm:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>คลัง</TableHead>
                      <TableHead>SKU / ชื่อ</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead className="text-right">จำนวน</TableHead>
                      <TableHead>ล็อต</TableHead>
                      <TableHead>หมดอายุ</TableHead>
                      <TableHead>สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.warehouse}</TableCell>
                        <TableCell className="max-w-72 whitespace-normal">
                          <div className="font-medium">{r.name}</div>
                          <div className="text-muted-foreground">{[r.sku, r.brand].filter(Boolean).join(' · ')}</div>
                        </TableCell>
                        <TableCell>{r.locationCode}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          <div className="font-semibold">
                            {formatQty(r.qty)} {r.unit}
                          </div>
                          <QtyBreakdown qty={r.qty} unit={r.unit} unitQty={r.unitQty} sizes={r.sizes} className="mt-1 justify-end" />
                        </TableCell>
                        <TableCell>{r.lot || '—'}</TableCell>
                        <TableCell className="tabular-nums">{r.expiry || '—'}</TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
