import { cn } from 'cn';
import type { Product, ProductPack } from '@petmore/shared';
import { formatQty, packSizes } from '@/lib/packs';

/**
 * เลือกขนาดบรรจุ (GOODSMASTER) ของสินค้า เช่น ชิ้น / PACK x 12 / PACK x 4 x 12
 * แตะครั้งเดียวเปลี่ยนได้ ปุ่มสูง 48px บอกตัวคูณเป็นหน่วยนับสต็อกทุกปุ่ม
 */
export function PackPicker({
  product,
  value,
  onChange,
  scannedCode,
}: {
  product: Product;
  value: ProductPack;
  onChange: (pack: ProductPack) => void;
  scannedCode?: string | null;
}) {
  const sizes = packSizes(product, scannedCode ?? value.code);
  const selectedKey = `${value.unitName}|${value.factor}`;
  if (sizes.length < 2) return null;
  return (
    <div className="grid gap-1.5">
      <span id="pack-picker-label" className="text-sm font-medium">
        ขนาดบรรจุ <span className="text-muted-foreground">({sizes.length} แบบ)</span>
      </span>
      <div role="radiogroup" aria-labelledby="pack-picker-label" className="flex flex-wrap gap-2">
        {sizes.map((pack) => {
          const selected = `${pack.unitName}|${pack.factor}` === selectedKey;
          return (
            <button
              key={pack.code}
              type="button"
              role="radio"
              data-slot="pack-option"
              aria-checked={selected}
              onClick={() => onChange(pack)}
              className={cn(
                'grid min-h-12 min-w-24 content-center rounded-xl border-2 px-3 py-1.5 text-left transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
                selected ? 'border-star bg-star-soft' : 'border-border bg-card hover:bg-secondary',
              )}
            >
              <span className="font-heading text-base leading-tight font-semibold">{pack.unitName}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {pack.factor === 1 ? `1 ${product.unit}` : `= ${formatQty(pack.factor)} ${product.unit}`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
