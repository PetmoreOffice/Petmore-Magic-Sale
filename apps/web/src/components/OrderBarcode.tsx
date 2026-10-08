import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';

/**
 * บาร์โค้ดเลขออเดอร์ (Code128) บนใบออเดอร์ ให้คนตรวจของเบิกสแกนเปิดออเดอร์ได้ทันที
 * ขาว-ดำตายตัวเหมือนป้าย Location พิมพ์แล้วสแกนติดทุกโหมดสี
 */
export function OrderBarcode({ id }: { id: string }) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, id, { format: 'CODE128', displayValue: false, margin: 0, width: 2, height: 56, lineColor: '#000000', background: '#ffffff' });
  }, [id]);
  return (
    <div className="inline-grid justify-items-center gap-1 rounded-lg bg-white px-3 py-2 text-black">
      <svg ref={ref} role="img" aria-label={`บาร์โค้ดออเดอร์ ${id}`} />
      <span className="font-mono text-xs tracking-wider">{id}</span>
    </div>
  );
}
