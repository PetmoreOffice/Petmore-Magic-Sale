import type { OrderLine, PickCheckPart, SalesOrder } from '@petmore/shared';

/** ความคืบหน้าการจัด 1 รายการ: ให้ขนาดอื่นแทนแล้วเทียบเป็นชิ้น (ห้ามแสดงทศนิยมของหน่วยที่สั่ง) ไม่งั้นเทียบหน่วยที่สั่ง */
export type PrepProgress = { pieces: boolean; got: number; need: number; diff: number; own: number; perUnit: number; parts: PickCheckPart[] };

/** ใช้ร่วมหน้าจัดสินค้า (คิว + ใบจัด) และหน้าตรวจของเบิก (แสดงยอดที่คนจัดหยิบ) */
export function prepProgress(o: Pick<SalesOrder, 'prep'>, l: OrderLine): PrepProgress {
  const key = String(l.lineNo);
  const p = o.prep.parts?.[key];
  if (p && p.perUnit > 0) {
    const need = l.qty * p.perUnit;
    return { pieces: true, got: p.pieces, need, diff: Math.round((p.pieces - need) * 1000) / 1000, own: p.own, perUnit: p.perUnit, parts: p.parts };
  }
  const got = o.prep.picked[key] ?? 0;
  return { pieces: false, got, need: l.qty, diff: Math.round((got - l.qty) * 1000) / 1000, own: got, perUnit: 0, parts: [] };
}
