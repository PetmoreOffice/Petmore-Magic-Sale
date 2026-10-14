import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import { Sparkle } from '@/components/magic';

/** ท้องฟ้าดาวเหนือแท่งบาร์โค้ด: จุดดาวกับประกายเล็กๆ วาดเอง (อยู่เหนือแท่ง ไม่กินที่ว่างซ้าย-ขวาที่หัวสแกนต้องใช้) */
function StarStrip() {
  return (
    <svg viewBox="0 0 160 14" aria-hidden className="block h-3.5 w-36 text-star-deep print:text-black">
      <path d="M8 8h40M112 8h40" stroke="currentColor" strokeWidth="0.8" strokeDasharray="1.5 3" opacity="0.55" />
      {[[20, 4, 1.1], [34, 10, 0.8], [126, 4, 0.9], [142, 11, 1.1]].map(([cx, cy, r]) => <circle key={cx} cx={cx} cy={cy} r={r} fill="currentColor" />)}
      {/* พระจันทร์เสี้ยวกลางฟ้า */}
      <path d="M83.5 1.8a5.6 5.6 0 1 0 0 10.6a4.4 4.4 0 1 1 0-10.6Z" fill="currentColor" />
      <path d="M62 7.5l1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1Z M98 1.5l.8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8Z" fill="currentColor" />
    </svg>
  );
}

/**
 * บาร์โค้ดเลขเอกสาร (Code128) บนใบออเดอร์/ใบคืน สแกนเปิดเอกสารนั้นได้ทันที แต่งเป็น "ตั๋วเวทมนตร์"
 * แท่งบาร์โค้ดขาว-ดำล้วนและมีที่ว่างซ้าย-ขวาเกิน 10 เท่าของแท่งเล็กสุด (มาตรฐาน Code128) หัวสแกนอ่านติดเสมอ
 * เวทมนตร์อยู่นอกแท่งเท่านั้น: กรอบทองสองชั้น ประกายสี่มุม ฟ้าดาวด้านบน ตอนพิมพ์ทุกอย่างเป็นสีดำ
 */
export function OrderBarcode({ id, label = 'ออเดอร์' }: { id: string; label?: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    JsBarcode(svg, id, { format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 56, lineColor: '#000000', background: '#ffffff' });
    // ใส่ viewBox ให้ย่อตามจอแคบได้ (มือถือ) โดยแท่งไม่บิด ตอนพิมพ์ยังเต็มขนาด
    svg.setAttribute('viewBox', `0 0 ${parseFloat(svg.getAttribute('width') ?? '0')} ${parseFloat(svg.getAttribute('height') ?? '0')}`);
  }, [id]);
  return (
    <div className="relative inline-block max-w-full rounded-2xl border-2 border-star bg-white p-1 text-black shadow-[0_0_0_3px_color-mix(in_oklab,var(--pm-star)_22%,transparent)] print:border-black print:shadow-none">
      {/* ประกายสี่มุม เกาะอยู่บนกรอบ ไม่ทับแท่ง */}
      <Sparkle className="absolute -top-2 -left-2 size-4 text-star print:text-black" />
      <Sparkle className="absolute -top-1.5 -right-1.5 size-3 text-star print:text-black" />
      <Sparkle className="absolute -bottom-1.5 -left-1.5 size-3 text-star print:text-black" />
      <Sparkle className="absolute -right-2 -bottom-2 size-4 text-star print:text-black" />
      <div className="grid max-w-full justify-items-center gap-1 rounded-xl border border-dashed border-star-deep/45 px-6 pt-1.5 pb-2 print:border-black/60">
        <StarStrip />
        <svg ref={ref} className="block h-auto max-w-full" role="img" aria-label={`บาร์โค้ด${label} ${id}`} />
        <span className="flex items-center gap-1.5 font-mono text-xs font-semibold tracking-wider">
          <Sparkle className="size-2.5 text-star-deep print:text-black" />{id}<Sparkle className="size-2.5 text-star-deep print:text-black" />
        </span>
      </div>
    </div>
  );
}
