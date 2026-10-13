import { WHOLESALE_MIN_PIECES, type OrderLineInput, type PackSize, type Product, type ProductPack } from '@petmore/shared';

/**
 * รายการในตะกร้า: packCode เป็นบาร์ปกติเสมอ wholesale = บาร์ L คู่กัน (ใช้แสดงในตะกร้าเท่านั้น ไม่ส่งไปเซิร์ฟเวอร์)
 * เซิร์ฟเวอร์ตัดสินบาร์ที่ใช้จริงเองตอนบันทึก ด้วย packCodeForQty ใน shared
 */
export type CartLine = OrderLineInput & { wholesale?: { code: string; name: string; pieces: number } };

/** บาร์และชื่อที่จะใช้จริงตามจำนวนในตะกร้า (กติกาเดียวกับ packCodeForQty) */
export function cartLineShown(line: CartLine): { code: string; name: string; wholesale: boolean } {
  const w = line.wholesale;
  if (w && Math.round(w.pieces * line.qty * 1000) >= WHOLESALE_MIN_PIECES * 1000) return { code: w.code, name: w.name, wholesale: true };
  return { code: line.packCode, name: line.name, wholesale: false };
}

/** ตัดข้อมูลที่ใช้แสดงในตะกร้าออกก่อนส่งออเดอร์ */
export const toOrderLine = ({ wholesale: _wholesale, ...line }: CartLine): OrderLineInput => line;

export interface BreakdownPart {
  unitName: string;
  count: number;
}

/**
 * แตกยอดหน่วยนับสต็อกเป็นขนาดบรรจุ จากใหญ่ไปเล็ก เช่น 77 PC → 1 ลัง(48) · 2 แพ็ค(12) · 5 PC
 * คิดเป็น "ชิ้น" (UTQ_QTY ซึ่งเป็นจำนวนเต็ม) ไม่ใช้ตัวคูณทศนิยม เลยแม่นแม้หน่วยนับสต็อกเป็นแพ็ค
 * เศษที่แตกต่อไม่ได้ (ยอดทศนิยม) แสดงเป็นหน่วยที่เล็กที่สุด
 * @param stockUnitQty จำนวนชิ้นต่อ 1 หน่วยนับสต็อก
 */
export function breakdown(qty: number, sizes: PackSize[], stockUnitQty = 1): BreakdownPart[] {
  const sorted = [...sizes].filter((s) => s.unitQty > 0).sort((a, b) => b.unitQty - a.unitQty);
  if (!sorted.length) return [{ unitName: '', count: qty }];
  const parts: BreakdownPart[] = [];
  // ทำงานเป็นจำนวนเต็มหน่วยย่อย 1/1000 ชิ้น กันปัญหาทศนิยมของ float
  let left = Math.round(qty * stockUnitQty * 1000);
  for (const size of sorted) {
    const step = Math.round(size.unitQty * 1000);
    if (left < step) continue;
    const count = Math.floor(left / step);
    parts.push({ unitName: size.unitName, count });
    left -= count * step;
  }
  const smallest = sorted[sorted.length - 1];
  if (left > 0 || !parts.length) {
    const count = Math.round((left / Math.round(smallest.unitQty * 1000)) * 1000) / 1000;
    const same = parts.find((p) => p.unitName === smallest.unitName);
    if (same) same.count += count;
    else parts.push({ unitName: smallest.unitName, count });
  }
  return parts;
}

/** แสดงจำนวนแบบไทย ตัดทศนิยมเกิน 3 ตำแหน่ง */
export function formatQty(n: number): string {
  return n.toLocaleString('th-TH', { maximumFractionDigits: 3 });
}

/** ขนาดบรรจุทั้งหมดของสินค้า (อย่างน้อย 1 แบบเสมอ) */
export function allPacks(product: Product): ProductPack[] {
  return product.packs?.length
    ? product.packs
    : [{ code: product.sku, name: product.name, unitName: product.unit, unitQty: 1, factor: 1, active: true }];
}

/**
 * ขนาดบรรจุที่ให้เลือก: ไม่ซ้ำกันตามหน่วย+ตัวคูณ
 * สินค้า 1 ตัวมักมีหลายบาร์โค้ดของหน่วยเดียวกัน ให้เลือกแค่ขนาด ไม่ต้องเลือกบาร์โค้ด
 * ถ้ามีบาร์โค้ดที่เพิ่งสแกน ใช้แถวนั้นเป็นตัวแทนของขนาดนั้น (ชื่อตรงกับสินค้าที่ถืออยู่)
 */
export function packSizes(product: Product, preferCode?: string | null): ProductPack[] {
  const groups = new Map<string, ProductPack>();
  for (const pack of allPacks(product)) {
    const key = `${pack.unitName}|${pack.factor}`;
    if (!groups.has(key) || pack.code === preferCode) groups.set(key, pack);
  }
  return [...groups.values()].sort((a, b) => a.factor - b.factor || a.unitName.localeCompare(b.unitName, 'th'));
}

/** ขนาดเริ่มต้น: ขนาดของบาร์โค้ดที่สแกน ถ้าไม่มีใช้ขนาดเท่าหน่วยนับสต็อก */
export function defaultPack(product: Product, scannedCode?: string | null): ProductPack {
  const packs = allPacks(product);
  return packs.find((p) => p.code === scannedCode) ?? packs.find((p) => p.factor === 1) ?? packs[0];
}

/** "PACK x 12" หรือ "PACK x 12 (= 12 PC)" ถ้าไม่ใช่หน่วยนับสต็อก */
export function packLabel(pack: ProductPack, product: Product): string {
  return pack.factor === 1 && pack.unitName === product.unit ? pack.unitName : `${pack.unitName} (= ${formatQty(pack.factor)} ${product.unit})`;
}
