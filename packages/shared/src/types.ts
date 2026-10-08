import type { Permission, RoleCode } from './permissions';

export type WarehouseKind = 'WAREHOUSE' | 'BACKROOM' | 'STOREFRONT';
export type ReceiptKind = 'RECEIVE' | 'OPENING';
export type StockStatus = 'FG' | 'DM';
export type MovementKind = 'RECEIVE' | 'OPENING' | 'MOVE';

export const WAREHOUSE_KINDS: Record<WarehouseKind, string> = {
  WAREHOUSE: 'คลังสินค้า',
  BACKROOM: 'หลังร้าน',
  STOREFRONT: 'หน้าร้าน',
};

export const STOCK_STATUSES: Record<StockStatus, string> = {
  FG: 'FG — สินค้าปกติ',
  DM: 'DM — เสียหาย / รอตรวจสอบ',
};

export const RECEIPT_KINDS: Record<ReceiptKind, string> = {
  RECEIVE: 'รับสินค้าใหม่',
  OPENING: 'ยอดตั้งต้นจากการตรวจนับ',
};

export const MAX_RECEIPT_LINES = 50;
export const SESSION_HOURS = 12;

export interface WarehouseScope {
  all: boolean;
  codes: string[];
}

export interface SessionUser {
  id: string;
  username: string;
  displayName: string;
  roleCode: RoleCode;
  permissions: Permission[];
  warehouseScope: WarehouseScope;
}

/** ผู้ใช้ในหน้าจัดการผู้ใช้ */
export interface ManagedUser extends SessionUser {
  active: boolean;
  revision: number;
}

export interface UserInput {
  requestId: string;
  create: boolean;
  /** revision ที่โหลดมา กันสองคนแก้ทับกัน (สร้างใหม่ส่ง 0) */
  revision: number;
  username: string;
  displayName: string;
  role: RoleCode;
  active: boolean;
  /** ว่าง = ไม่เปลี่ยนรหัสผ่าน (สร้างใหม่ต้องมี อย่างน้อย 8 ตัว) */
  password?: string;
  warehouseScope: WarehouseScope;
  permissions: Permission[];
}

/** ประวัติการแก้ผู้ใช้ 1 ครั้ง before = null คือสร้างใหม่ */
export interface UserAuditEntry {
  id: string;
  username: string;
  actor: string;
  createdAt: string;
  before: SessionUser | null;
  after: (SessionUser & { active?: boolean; passwordChanged?: boolean }) | null;
}

export interface LoginResult {
  token: string;
  expiresAt: string;
  user: SessionUser;
}

export interface Warehouse {
  code: string;
  name: string;
  kind: WarehouseKind;
  active: boolean;
  revision: number;
}

export interface Zone {
  id: string;
  warehouse: string;
  code: string;
  name: string;
  active: boolean;
  revision: number;
}

export interface Location {
  id: string;
  warehouse: string;
  zoneId: string;
  code: string;
  /** รหัสที่แสดงบนป้าย เช่น A-01-02 (โซน-Location) */
  displayCode: string;
  name: string;
  active: boolean;
  revision: number;
}

/** ขนาดบรรจุ 1 แบบ (GOODSMASTER) เช่น ชิ้น, PACK x 12 */
export interface ProductPack {
  /** บาร์โค้ด/รหัสของขนาดบรรจุนี้ */
  code: string;
  /** ชื่อที่แสดง (GOODS_ALIAS หรือชื่อสินค้า) */
  name: string;
  unitName: string;
  /** จำนวนชิ้นต่อ 1 หน่วยนี้ */
  unitQty: number;
  /** 1 หน่วยนี้ = กี่หน่วยนับสต็อกของสินค้า */
  factor: number;
  active: boolean;
}

export interface Product {
  sku: string;
  name: string;
  barcode: string | null;
  /** หน่วยนับสต็อก ยอดสต็อกทั้งหมดเป็นหน่วยนี้ */
  unit: string;
  brand: string;
  category: string;
  categoryGroup: string;
  active: boolean;
  expiryRequired: boolean;
  /** COMPANY = ข้อมูลมาจาก SQL Server บริษัท แก้ใน WMS ได้เฉพาะ expiryRequired */
  source: 'LOCAL' | 'COMPANY';
  /** ICCAT_CODE ของผู้สั่ง/บริษัทคู่ค้าเจ้าของสินค้า (SKU_ICCAT) ว่างถ้าไม่ได้ผูก */
  customerCode: string;
  revision: number;
  /** ขนาดบรรจุที่เลือกรับได้ มีอย่างน้อย 1 แบบเสมอ (สินค้าที่สร้างใน WMS ได้หน่วยนับสต็อกแบบเดียว) */
  packs?: ProductPack[];
}

export interface ReceiptLineInput {
  sku: string;
  locationId: string;
  /** ขนาดบรรจุที่รับ (ProductPack.code) */
  packCode: string;
  /** จำนวนตามขนาดบรรจุที่เลือก เช่น 2 แพ็ค เซิร์ฟเวอร์แปลงเป็นหน่วยนับสต็อกเอง */
  packQty: number;
  lot: string;
  /** YYYY-MM-DD หรือ '' */
  expiry: string;
  status: StockStatus;
}

export interface ReceiptInput {
  requestId: string;
  kind: ReceiptKind;
  warehouse: string;
  /** YYYY-MM-DD */
  date: string;
  reference: string;
  poNumber: string;
  source: string;
  note: string;
  lines: ReceiptLineInput[];
}

export interface ReceiptLine extends ReceiptLineInput {
  lineNo: number;
  name: string;
  /** หน่วยนับสต็อก */
  unit: string;
  /** จำนวนที่เข้าสต็อก (หน่วยนับสต็อก) = packQty × factor */
  qty: number;
  packName: string;
  packUnit: string;
  factor: number;
  locationCode: string;
}

export interface Receipt {
  id: string;
  kind: ReceiptKind;
  warehouse: string;
  date: string;
  reference: string;
  poNumber: string;
  source: string;
  note: string;
  createdBy: string;
  createdAt: string;
  lines: ReceiptLine[];
}

export interface StockRow {
  id: string;
  warehouse: string;
  sku: string;
  name: string;
  barcode: string | null;
  unit: string;
  locationId: string;
  locationCode: string;
  lot: string;
  expiry: string;
  status: StockStatus;
  /** ยอดคงเหลือในหน่วยนับสต็อก */
  qty: number;
  brand: string;
  /** จำนวนชิ้นต่อ 1 หน่วยนับสต็อก (UTQ_QTY) */
  unitQty: number;
  /** ขนาดบรรจุที่ไม่ซ้ำของสินค้านี้ เรียงจากใหญ่ไปเล็ก ใช้แตกยอดเป็น ลัง/แพ็ค/ชิ้น */
  sizes: PackSize[];
}

/** ขนาดบรรจุแบบย่อ: ชื่อหน่วย, จำนวนชิ้นต่อหน่วย และ 1 หน่วยนี้เท่ากับกี่หน่วยนับสต็อก */
export interface PackSize {
  unitName: string;
  unitQty: number;
  factor: number;
}

export interface MoveInput {
  requestId: string;
  /** id ของแถวสต็อกต้นทาง (StockRow.id) */
  sourceId: string;
  destinationId: string;
  qty: number;
  note: string;
}

export interface Move {
  id: string;
  warehouse: string;
  sku: string;
  name: string;
  unit: string;
  fromCode: string;
  toCode: string;
  lot: string;
  expiry: string;
  status: StockStatus;
  qty: number;
  note: string;
  actor: string;
  createdAt: string;
}

export interface StockMovementRow {
  id: string;
  kind: MovementKind;
  refId: string;
  lineNo: number;
  warehouse: string;
  sku: string;
  name: string;
  fromCode: string | null;
  toCode: string | null;
  qty: number;
  actor: string;
  createdAt: string;
}

export interface Paged<T> {
  rows: T[];
  total: number;
  page: number;
  pages: number;
}

export type ScanResult =
  /** packCode = ขนาดบรรจุของบาร์โค้ดที่สแกน (null ถ้าสแกนรหัส SKU ตรงๆ) */
  | { type: 'product'; product: Product; packCode: string | null }
  | { type: 'location'; location: Location };

export interface ReceivingSetup {
  warehouses: Warehouse[];
  locations: Location[];
}

export interface StorageWorkspace {
  warehouses: Warehouse[];
  zones: Zone[];
  locations: Location[];
}

export const MAX_ORDER_LINES = 50;

/**
 * ข้อความสำหรับค้นแบบไม่สนเว้นวรรค: ตัวพิมพ์เล็ก ตัดช่องว่างและ . , - ( ) ' " / &
 * ชื่อในระบบบริษัทเว้นวรรคไม่แน่นอน ("เพ็ท โฟกัส", "ซี.ซี.อินเตอร์เทค") พิมพ์ติดกันก็ต้องเจอ
 * ต้องตรงกับ SQL ใน migration product_search_key ที่เติมค่าให้สินค้าเดิม
 */
export function searchKey(text: string): string {
  return text.toLowerCase().replace(/[\s.,\-()'"/&]+/g, '');
}

/**
 * ชนิดสินค้าสำหรับตัวกรอง: หมวดแม่ ICDEPT (categoryGroup) และหมวดย่อย (category)
 * สินค้าที่ไม่มีหมวดแม่ใช้หมวดย่อยเป็นชนิดแทน ไม่มีทั้งคู่ = NO_PRODUCT_TYPE
 */
export interface ProductType {
  name: string;
  count: number;
  subs: { name: string; count: number }[];
}
export const NO_PRODUCT_TYPE = '-';

/**
 * หมวดใหญ่ของชนิดสินค้า (ชั้นบนสุดในหน้าเลือกสินค้า) ICDEPT มีแค่ 2 ชั้น จึงจัดกลุ่มเองในแอป
 * จับจากคำในชื่อชนิด ลำดับสำคัญ: คำเฉพาะก่อนคำกว้าง เช่น "อาหารเสริม" ต้องเข้าสุขภาพ ไม่ใช่อาหาร
 * ชนิดใหม่ในระบบบริษัทที่ไม่เข้าข้อไหนจะไปอยู่ "อื่นๆ" เอง แก้การจัดกลุ่มที่นี่ที่เดียว
 */
export const TYPE_GROUPS = [
  { key: 'health', name: 'สุขภาพ', match: /อาหารเสริม|วิตามิน|ยาสัตว์|ทำความสะอาด(ช่องปาก|ใบหู|รอบดวงตา|มือ)/ },
  { key: 'food', name: 'อาหาร', match: /^อาหาร|^นม|น้ำดื่ม/ },
  { key: 'treat', name: 'ขนม', match: /ขนม/ },
  { key: 'groom', name: 'อาบน้ำ กรูมมิ่ง', match: /อาบน้ำ|บำรุงขน|กรูมมิ่ง|ทิชชู่|น้ำหอม/ },
  { key: 'litter', name: 'ทราย ห้องน้ำ', match: /ทราย|ห้องน้ำ|ขี้เลื่อย|แผ่นรองฉี่|ผ้าอ้อม/ },
  { key: 'toy', name: 'ของเล่น', match: /ของเล่น/ },
  { key: 'outing', name: 'ออกนอกบ้าน', match: /สายจูง|ปลอกคอ|เสื้อผ้า|กระเป๋า|ตระกร้า|รถเข็น/ },
  { key: 'home', name: 'ที่นอน บ้าน กรง', match: /เบาะ|ที่นอน|บ้าน|คอนโด|กรง|คอก/ },
  { key: 'bowl', name: 'ชาม ที่ให้อาหาร', match: /ชาม|ที่ให้น้ำ|ที่ให้อาหาร/ },
  { key: 'other', name: 'อื่นๆ', match: /.*/ },
] as const;
export type TypeGroupKey = (typeof TYPE_GROUPS)[number]['key'];

export function typeGroup(typeName: string): TypeGroupKey {
  return TYPE_GROUPS.find((g) => g.match.test(typeName))!.key;
}

/** สินค้าในหน้าเลือกสินค้าของออเดอร์ (SKU ที่มีบาร์โค้ดใน GOODSMASTER) */
export interface CatalogItem {
  sku: string;
  name: string;
  brand: string;
  unit: string;
  /** หมวดแม่ (ICDEPT) ใช้ระบายสีการ์ดสินค้า */
  categoryGroup: string;
  /** หน่วยของบาร์โค้ดที่ผูกกับ SKU นี้ ตามชื่อใน UOFQTY ไม่ซ้ำ เรียงจากเล็กไปใหญ่ เช่น PC, PACK x 12 (qty = ชิ้นต่อหน่วย) */
  units: { name: string; qty: number }[];
  /** จำนวนบาร์โค้ดที่ใช้งานอยู่ */
  barcodes: number;
}

export interface OrderLineInput {
  sku: string;
  /** รหัสสินค้าที่กรอกเอง ใช้กับรายการที่ไม่มีในทะเบียน (sku ว่าง) */
  itemCode?: string;
  packCode: string;
  name: string;
  unit: string;
  qty: number;
  /** ไม่ใช้แล้ว ออเดอร์เก็บแค่จำนวน (คอลัมน์ยังอยู่ เซิร์ฟเวอร์บันทึกเป็น 0) */
  unitPrice?: number;
}

/** ผู้สั่งที่เลือกได้ (dbo.ICCAT บริษัทคู่ค้า) */
export interface Customer {
  code: string;
  name: string;
  /** จำนวนสินค้าที่เปิดใช้ของผู้สั่งนี้ (SKU_ICCAT) */
  products?: number;
}

export interface OrderInput {
  requestId: string;
  /** ICCAT_CODE ของผู้สั่ง เซิร์ฟเวอร์ดึงชื่อจากทะเบียนเอง */
  customerCode: string;
  phone: string;
  date: string;
  reference: string;
  note: string;
  lines: OrderLineInput[];
}

export interface OrderLine extends OrderLineInput {
  lineNo: number;
  name: string;
  amount: number;
}

export type PickCheckStatus = 'MATCH' | 'MISMATCH';
/** แท็บในหน้าตรวจของเบิก: PENDING = ยังไม่ตรวจ */
export type CheckFilter = 'PENDING' | PickCheckStatus | 'ALL';
export type CheckCounts = Record<CheckFilter, number>;

export interface PickCheckLine {
  lineNo: number;
  /** รายการในออเดอร์ (null = ของที่ไม่อยู่ในออเดอร์) */
  orderLineNo: number | null;
  sku: string;
  itemCode: string;
  packCode: string;
  name: string;
  unit: string;
  expectedQty: number;
  actualQty: number;
}

export interface PickCheck {
  id: string;
  orderId: string;
  pickerName: string;
  status: PickCheckStatus;
  note: string;
  checkedBy: string;
  createdAt: string;
  lines: PickCheckLine[];
}

/** ส่งผลตรวจ: รายการในออเดอร์ส่งแค่ orderLineNo + actualQty เซิร์ฟเวอร์เติมยอดที่ควรได้เอง */
export interface PickCheckInput {
  requestId: string;
  pickerName: string;
  note: string;
  lines: { orderLineNo: number | null; sku?: string; itemCode?: string; packCode?: string; name?: string; unit?: string; actualQty: number }[];
}

export type ReturnReason = 'OVER_PICK' | 'UNSOLD' | 'EVENT_END' | 'OTHER';
export const RETURN_REASONS: Record<ReturnReason, string> = {
  OVER_PICK: 'เบิกเกิน',
  UNSOLD: 'ขายไม่หมด',
  EVENT_END: 'ปิดงานอีเวนต์',
  OTHER: 'อื่นๆ',
};

export interface ReturnLine {
  lineNo: number;
  orderLineNo: number | null;
  sku: string;
  itemCode: string;
  packCode: string;
  name: string;
  unit: string;
  /** ของดี (FG) / ของเสียหาย (DM) */
  goodQty: number;
  damagedQty: number;
}

export interface ProductReturn {
  id: string;
  orderId: string | null;
  customerName: string;
  reason: ReturnReason;
  returnerName: string;
  note: string;
  createdBy: string;
  createdAt: string;
  lines: ReturnLine[];
}

/** รายการคืน: ผูกออเดอร์ส่ง orderLineNo, ใบคืนอิสระส่ง sku+packCode (สินค้าในทะเบียน) หรือ itemCode/name/unit (กรอกเอง) */
export interface ReturnInput {
  requestId: string;
  orderId: string | null;
  reason: ReturnReason;
  returnerName: string;
  note: string;
  lines: { orderLineNo: number | null; sku?: string; packCode?: string; itemCode?: string; name?: string; unit?: string; goodQty: number; damagedQty: number }[];
}

/** ยอดของออเดอร์สำหรับหน้าคืนสินค้า: เบิกไป (ยอดนับได้จากผลตรวจล่าสุด ถ้ายังไม่ตรวจใช้ยอดในออเดอร์) และคืนไปแล้ว */
export interface OrderReturnSummary {
  orderId: string;
  checked: boolean;
  lines: { orderLineNo: number; taken: number; returned: number }[];
}

export interface SalesOrder {
  id: string;
  customerCode: string;
  customerName: string;
  customerType: 'CUSTOMER' | 'SUPPLIER';
  phone: string;
  channel: string;
  date: string;
  dueDate: string;
  reference: string;
  note: string;
  createdAt: string;
  createdBy: string;
  total: number;
  lines: OrderLine[];
  /** ผลตรวจของเบิกครั้งล่าสุด (null = ยังไม่ตรวจ) */
  lastCheck: { id: string; status: PickCheckStatus; createdAt: string; pickerName: string } | null;
}
