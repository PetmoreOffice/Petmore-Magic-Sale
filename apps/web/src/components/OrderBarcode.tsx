import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

/**
 * บาร์โค้ดเลขเอกสาร (Code128) บนใบออเดอร์/ใบคืน สแกนเปิดเอกสารนั้นได้ทันที
 * ขาว-ดำตายตัวเหมือนป้าย Location พิมพ์แล้วสแกนติดทุกโหมดสี
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
    <div className="inline-grid max-w-full justify-items-center gap-1 rounded-lg bg-white px-3 py-2 text-black">
      <svg ref={ref} className="block h-auto max-w-full" role="img" aria-label={`บาร์โค้ด${label} ${id}`} />
      <span className="font-mono text-xs tracking-wider">{id}</span>
    </div>
  );
}
