import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import type { Location } from '@petmore/shared';

export interface LabelBatchInfo {
  id: string;
  actor: string;
  time: string;
}

/**
 * ป้าย Location ขนาด 190 × 88 มม. (A4 วางได้ 3 ป้าย)
 * ทั้ง QR และ Code128 เก็บ Location ID ซึ่งเป็นค่าที่ /api/scan อ่านเป็น Location
 * ขนาดทุกส่วนอิงความกว้างป้าย (container query, cqw) ภาพตัวอย่างบนจอกับกระดาษจริงจึงเหมือนกันทุกจุด
 * ป้ายเป็นวัตถุจริงที่พิมพ์ จึงใช้ขาว-ดำตายตัว ไม่เปลี่ยนตามธีม
 */
export function LocationLabel({ location, zoneName, batch }: { location: Location; zoneName?: string; batch: LabelBatchInfo }) {
  const [qr, setQr] = useState('');
  const barcodeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let alive = true;
    QRCode.toString(location.id, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: '#000000', light: '#ffffff' } })
      .then((svg) => alive && setQr(svg))
      .catch(() => alive && setQr(''));
    return () => {
      alive = false;
    };
  }, [location.id]);

  useEffect(() => {
    if (!barcodeRef.current) return;
    JsBarcode(barcodeRef.current, location.id, {
      format: 'CODE128',
      displayValue: false,
      margin: 0,
      width: 2,
      height: 80,
      lineColor: '#000000',
      background: '#ffffff',
    });
    // ยืดบาร์โค้ดเต็มความกว้างป้าย เครื่องสแกนอ่าน Code128 ได้แม้แท่งกว้างไม่เท่าค่าเริ่มต้น
    barcodeRef.current.setAttribute('preserveAspectRatio', 'none');
  }, [location.id]);

  const code = location.displayCode;
  // รหัสยาวลดขนาดตัวอักษรลง ให้อยู่ในบรรทัดเดียวเสมอ
  const codeSize = `min(15cqw, ${Math.floor(118 / Math.max(code.length, 1))}cqw)`;

  return (
    <article
      className="relative grid aspect-[190/88] w-full grid-rows-[minmax(0,1fr)_auto_auto] gap-[1.4cqw] overflow-hidden rounded-[1.2cqw] border-[0.35cqw] border-black bg-white p-[2.6cqw] text-black [container-type:inline-size] break-inside-avoid"
      aria-label={`ป้าย Location ${code}`}
    >
      <div className="grid min-h-0 grid-cols-[minmax(0,1fr)_22cqw] items-center gap-[2.5cqw]">
        <div className="flex min-w-0 flex-col justify-between">
          <div className="flex items-center justify-between gap-[2cqw] text-[2.1cqw] font-semibold tracking-[0.12em] uppercase">
            <span>Petmore Magic Sale</span>
            <span className="rounded-[0.8cqw] bg-black px-[1.2cqw] py-[0.3cqw] tracking-normal text-white">คลัง {location.warehouse}</span>
          </div>
          <strong className="block font-heading leading-none font-semibold tracking-tight whitespace-nowrap" style={{ fontSize: codeSize }}>
            {code}
          </strong>
          <div className="truncate text-[2.6cqw]">
            {[zoneName, location.name].filter(Boolean).join(' · ') || ' '}
          </div>
        </div>
        <div
          // ขนาดคงที่ 22% ของความกว้างป้าย (≈ 42 มม. บนกระดาษ) พอดีกับพื้นที่ส่วนบน
          className="size-[22cqw] [&>svg]:block [&>svg]:size-full"
          aria-hidden="true"
          // QR เป็น SVG ที่สร้างจาก Location ID เอง ไม่ได้มาจากผู้ใช้
          dangerouslySetInnerHTML={{ __html: qr }}
        />
      </div>
      <svg ref={barcodeRef} className="h-[13cqw] w-full" aria-hidden="true" />
      <div className="flex items-center justify-between gap-[2cqw] font-mono text-[1.7cqw]">
        <span className="truncate">{location.id}</span>
        <span className="shrink-0">
          ชุด {batch.id.slice(-8)} · {batch.actor} · {new Date(batch.time).toLocaleDateString('th-TH', { timeZone: 'Asia/Bangkok' })}
        </span>
      </div>
    </article>
  );
}
