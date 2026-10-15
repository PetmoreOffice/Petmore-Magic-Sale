/** รหัสสินค้าที่แสดงในเอกสาร: SKU_CODE ของทะเบียน หรือรหัสที่กรอกเอง (สินค้านอกทะเบียน) */
export const lineCode = (line: { sku: string; itemCode?: string }) => line.sku || line.itemCode || '';

/**
 * ลำดับรายการในเอกสารที่พิมพ์ (ใบจัดสินค้า/ใบคืน): ตาม SKU_CODE ของ dbo.SKUMASTER (= line.sku) แบบเดียวกับ ORDER BY SKU_CODE
 * เทียบทีละตัวอักษรไม่สนตัวพิมพ์ (Thai_CI_AS) ไม่ใช่แบบตัวเลข ("1000" มาก่อน "999") แล้วตามลำดับที่จด
 * สินค้ากรอกเองที่ไม่มีรหัสอยู่ท้าย
 */
export function sortBySkuCode<T extends { sku: string; itemCode?: string; lineNo: number }>(lines: T[]): T[] {
  return [...lines].sort((a, b) => {
    const ca = lineCode(a).toUpperCase(), cb = lineCode(b).toUpperCase();
    if (!ca !== !cb) return ca ? -1 : 1;
    return (ca < cb ? -1 : ca > cb ? 1 : 0) || a.lineNo - b.lineNo;
  });
}
