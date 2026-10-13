/**
 * บาร์เรทส่ง (บาร์ L) ของ GOODSMASTER: "L" + รหัสบาร์ปกติ ใน SKU เดียวกัน หน่วยและจำนวนชิ้นเท่ากัน
 * เช่น 8859160401026 (PC) กับ L8859160401026 (PC, ชื่อลงท้าย "(ส่งโหล)") บริษัทใช้บาร์ L เมื่อสั่งตั้งแต่ 12 ชิ้นขึ้นไป
 * ทะเบียนมีบาร์ L ~13,700 ตัว เกือบทั้งหมดมีบาร์ปกติคู่กัน (ตรวจเมื่อ 2026-10-13)
 *
 * หน้าออเดอร์ซ่อนบาร์ L ให้เลือกบาร์ปกติอย่างเดียว เซิร์ฟเวอร์สลับเป็นบาร์ L ให้เองตอนบันทึกเมื่อครบเกณฑ์
 * บาร์ L ที่ไม่มีบาร์ปกติคู่กัน หรือหน่วย/จำนวนชิ้นไม่ตรงกัน ไม่ถือเป็นคู่ แสดงและใช้ตามเดิม
 */
export const WHOLESALE_PREFIX = 'L';
/** สั่งบาร์ปกติรวมตั้งแต่กี่ชิ้นขึ้นไปถึงใช้บาร์ L (ชิ้น = UTQ_QTY ของหน่วยนั้น × จำนวน) */
export const WHOLESALE_MIN_PIECES = 12;

interface PackLike {
  code: string;
  unitName: string;
  /** ชิ้นต่อ 1 หน่วย (ฝั่ง API เป็น Prisma.Decimal) */
  unitQty: number | string | { toString(): string };
  active?: boolean;
}

const usable = <T extends PackLike>(packs: T[], code: string) => packs.find((p) => p.code === code && p.active !== false);

/** บาร์ L ที่คู่กับบาร์ปกติ code (ไม่มีคู่ = null) */
export function wholesaleOf<T extends PackLike>(packs: T[], code: string): T | null {
  const retail = usable(packs, code);
  const twin = retail && usable(packs, WHOLESALE_PREFIX + code);
  return retail && twin && twin.unitName === retail.unitName && Number(twin.unitQty) === Number(retail.unitQty) ? twin : null;
}

/** ถ้า code เป็นบาร์ L ที่มีบาร์ปกติคู่กัน คืนบาร์ปกตินั้น */
export function retailOf<T extends PackLike>(packs: T[], code: string): T | null {
  if (!code.startsWith(WHOLESALE_PREFIX)) return null;
  const base = code.slice(WHOLESALE_PREFIX.length);
  return wholesaleOf(packs, base) ? usable(packs, base) ?? null : null;
}

/** บาร์ที่ให้เลือกในหน้าออเดอร์: ตัดบาร์ L ที่มีบาร์ปกติคู่กันออก */
export function withoutWholesale<T extends PackLike>(packs: T[]): T[] {
  return packs.filter((p) => !retailOf(packs, p.code));
}

/**
 * บาร์ที่ใช้จริงตามจำนวนที่สั่ง: ครบ 12 ชิ้น = บาร์ L, ไม่ถึง = บาร์ปกติ
 * ส่งบาร์ปกติหรือบาร์ L มาก็ได้ บาร์ที่ไม่มีคู่คืนตามเดิม
 */
export function packCodeForQty<T extends PackLike>(packs: T[], code: string, qty: number): string {
  const retail = retailOf(packs, code) ?? usable(packs, code);
  const twin = retail && wholesaleOf(packs, retail.code);
  if (!retail || !twin) return code;
  // เทียบเป็นหน่วย 1/1000 ชิ้น กันทศนิยมของ float (จำนวนมีทศนิยมได้ 3 ตำแหน่ง)
  const milliPieces = Math.round(Number(retail.unitQty) * qty * 1000);
  return milliPieces >= WHOLESALE_MIN_PIECES * 1000 ? twin.code : retail.code;
}
