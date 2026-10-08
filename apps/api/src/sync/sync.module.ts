import { Controller, Injectable, Logger, Module, Post, ServiceUnavailableException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import sql from 'mssql';
import { searchKey } from '@petmore/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RequirePermissions } from '../auth/decorators';

/** แถวที่ MSSQL_PRODUCT_QUERY ต้องคืนมา (ตั้งชื่อคอลัมน์ด้วย AS ให้ตรง) */
interface CompanyProductRow {
  sku: string;
  name: string;
  barcode: string | null;
  /** หน่วยนับสต็อก และจำนวนชิ้นต่อหน่วยนั้น */
  unit: string | null;
  unitQty?: number | null;
  brand?: string | null;
  category?: string | null;
  categoryGroup?: string | null;
  active: boolean | number | null;
}

/** แถวที่ MSSQL_PACK_QUERY ต้องคืนมา: ขนาดบรรจุ/บาร์โค้ด 1 แถวต่อ 1 รหัส */
interface CompanyPackRow {
  code: string;
  sku: string;
  name: string | null;
  unitName: string | null;
  unitQty: number | null;
  active: boolean | number | null;
}

/** แถวผู้สั่ง (บริษัทคู่ค้า) จาก dbo.ICCAT */
interface CompanyCustomerRow {
  code: string;
  name: string | null;
}

/**
 * ผู้สั่งในหน้าออเดอร์ = dbo.ICCAT (ตรวจ 2026-10-07: 256 รายการ, ICCAT_CODE ไม่ซ้ำ)
 * ตัด key 0 "ไม่กำหนดประเภท" ออก ตั้ง MSSQL_CUSTOMER_QUERY ใน .env เพื่อเปลี่ยนได้
 */
const DEFAULT_CUSTOMER_QUERY = 'SELECT ICCAT_CODE AS code, ICCAT_NAME AS name FROM dbo.ICCAT WHERE ICCAT_KEY <> 0';
/**
 * สินค้าของผู้สั่งแต่ละราย: SKUMASTER.SKU_ICCAT → ICCAT (มี foreign key จริง)
 * ตรวจ 2026-10-07: 24,275 จาก 24,287 SKU ที่เปิดใช้ผูกกับผู้สั่ง 229 ราย ตั้ง MSSQL_PRODUCT_CUSTOMER_QUERY เพื่อเปลี่ยนได้
 */
const DEFAULT_PRODUCT_CUSTOMER_QUERY =
  'SELECT s.SKU_CODE AS sku, i.ICCAT_CODE AS customerCode FROM dbo.SKUMASTER s JOIN dbo.ICCAT i ON i.ICCAT_KEY = s.SKU_ICCAT WHERE s.SKU_ICCAT <> 0';

type Counts = { count: number; created: number; updated: number; unchanged: number; deactivated?: number };
export type SyncResult = { products: Counts; packs: Counts | null; customers: Counts; productCustomers: { updated: number }; at: string };

const BATCH = 500;
/** ชื่อ/ข้อความ: ยุบช่องว่างซ้ำและตัดหัวท้าย */
const clean = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
/**
 * รหัส/บาร์โค้ด: ตัดแค่หัวท้าย ห้ามยุบช่องว่างกลาง
 * ระบบบริษัทมีรหัสที่ต่างกันแค่จำนวนช่องว่าง เช่น "12  KBC (P) 1007" กับ "12 KBC (P) 1007" เป็นคนละสินค้า
 */
const code = (v: unknown) => String(v ?? '').trim();
const flag = (v: unknown) => (v === null || v === undefined ? true : !!v);
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * ดึงข้อมูลสินค้าจาก SQL Server บริษัทมาเก็บสำเนาใน PostgreSQL
 * - MSSQL_PRODUCT_QUERY: สินค้าหลัก (SKUMASTER + หน่วย + ยี่ห้อ + หมวด)
 * - MSSQL_PACK_QUERY: ขนาดบรรจุ/บาร์โค้ด (GOODSMASTER) ไม่ตั้งก็ได้ สินค้าจะมีขนาดเดียวคือหน่วยนับสต็อก
 * ใช้ user ที่มีสิทธิ์ SELECT อย่างเดียว ระบบนี้ไม่เขียนกลับไปที่ SQL Server
 * เขียนลง PostgreSQL เฉพาะแถวที่ใหม่หรือเปลี่ยน
 */
@Injectable()
export class SyncService {
  private readonly log = new Logger(SyncService.name);
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return !!process.env.MSSQL_HOST;
  }

  @Cron(process.env.SYNC_CRON || '*/15 * * * *')
  async scheduled() {
    if (!this.enabled) return;
    try {
      const r = await this.syncProducts();
      if ('products' in r) {
        const p = r.products;
        const k = r.packs;
        this.log.log(
          `sync สินค้า ${p.count} (ใหม่ ${p.created}, เปลี่ยน ${p.updated})` +
            (k ? ` · ขนาดบรรจุ ${k.count} (ใหม่ ${k.created}, เปลี่ยน ${k.updated}, ปิด ${k.deactivated ?? 0})` : '') +
            ` · ผู้สั่ง ${r.customers.count} (ใหม่ ${r.customers.created}, เปลี่ยน ${r.customers.updated})`,
        );
      }
    } catch (e) {
      this.log.error(`sync สินค้าไม่สำเร็จ: ${e instanceof Error ? e.message : e}`);
    }
  }

  private connect() {
    // SQL Server รุ่นเก่า (เช่น 2014 ที่ไม่ได้อัปเดต) รองรับแค่ TLS 1.0/1.1 ซึ่ง Node.js ปิดไว้
    // เปิดเฉพาะเมื่อตั้ง MSSQL_TLS_MIN_VERSION ใน .env ทางที่ดีกว่าคืออัปเดต SQL Server ให้รองรับ TLS 1.2
    const tlsMin = process.env.MSSQL_TLS_MIN_VERSION as 'TLSv1' | 'TLSv1.1' | 'TLSv1.2' | undefined;
    return new sql.ConnectionPool({
      server: process.env.MSSQL_HOST!,
      port: Number(process.env.MSSQL_PORT ?? 1433),
      database: process.env.MSSQL_DATABASE,
      user: process.env.MSSQL_USER,
      password: process.env.MSSQL_PASSWORD,
      requestTimeout: 120_000,
      options: {
        encrypt: process.env.MSSQL_ENCRYPT !== 'false',
        trustServerCertificate: process.env.MSSQL_TRUST_SERVER_CERTIFICATE !== 'false',
        readOnlyIntent: true,
        ...(tlsMin ? { cryptoCredentialsDetails: { minVersion: tlsMin, ciphers: 'DEFAULT@SECLEVEL=0' } } : {}),
      },
    }).connect();
  }

  async syncProducts(): Promise<SyncResult | { skipped: true }> {
    if (!this.enabled) throw new ServiceUnavailableException('ยังดึงสินค้าจากระบบบริษัทไม่ได้ เพราะยังไม่ได้ตั้งค่าการเชื่อมต่อ แจ้งผู้ดูแลระบบ');
    const productQuery = process.env.MSSQL_PRODUCT_QUERY;
    if (!productQuery) throw new ServiceUnavailableException('ยังดึงสินค้าจากระบบบริษัทไม่ได้ เพราะตั้งค่าไม่ครบ แจ้งผู้ดูแลระบบ');
    if (this.running) return { skipped: true };
    this.running = true;
    let pool: sql.ConnectionPool | undefined;
    try {
      pool = await this.connect();
      const now = new Date();
      const products = await this.syncProductRows((await pool.request().query<CompanyProductRow>(productQuery)).recordset, now);
      const packQuery = process.env.MSSQL_PACK_QUERY;
      const packs = packQuery ? await this.syncPackRows((await pool.request().query<CompanyPackRow>(packQuery)).recordset, now) : null;
      const customerQuery = process.env.MSSQL_CUSTOMER_QUERY || DEFAULT_CUSTOMER_QUERY;
      const customers = await this.syncCustomerRows((await pool.request().query<CompanyCustomerRow>(customerQuery)).recordset, now);
      const ownerQuery = process.env.MSSQL_PRODUCT_CUSTOMER_QUERY || DEFAULT_PRODUCT_CUSTOMER_QUERY;
      const productCustomers = await this.syncProductCustomers((await pool.request().query<{ sku: string; customerCode: string }>(ownerQuery)).recordset);
      return { products, packs, customers, productCustomers, at: now.toISOString() };
    } finally {
      this.running = false;
      await pool?.close().catch(() => undefined);
    }
  }

  private async syncProductRows(recordset: CompanyProductRow[], now: Date): Promise<Counts> {
    const rows = recordset
      .map((r) => ({
        sku: code(r.sku),
        name: clean(r.name),
        barcode: code(r.barcode) || null,
        unit: clean(r.unit) || 'ชิ้น',
        unitQty: Number(r.unitQty) > 0 ? round(Number(r.unitQty), 3) : 1,
        brand: clean(r.brand),
        category: clean(r.category),
        categoryGroup: clean(r.categoryGroup),
        active: flag(r.active),
      }))
      .filter((r) => r.sku && r.name)
      .map((r) => ({ ...r, searchKey: searchKey(`${r.sku} ${r.name} ${r.brand}`) }));

    const existing = new Map(
      (
        await this.prisma.product.findMany({
          select: { sku: true, name: true, barcode: true, unit: true, unitQty: true, brand: true, category: true, categoryGroup: true, active: true, source: true, searchKey: true },
        })
      ).map((p) => [p.sku, p]),
    );
    const toCreate = rows.filter((r) => !existing.has(r.sku));
    const toUpdate = rows.filter((r) => {
      const p = existing.get(r.sku);
      return (
        p &&
        (p.name !== r.name ||
          p.barcode !== r.barcode ||
          p.unit !== r.unit ||
          Number(p.unitQty) !== r.unitQty ||
          p.brand !== r.brand ||
          p.category !== r.category ||
          p.categoryGroup !== r.categoryGroup ||
          p.active !== r.active ||
          p.searchKey !== r.searchKey ||
          p.source !== 'COMPANY')
      );
    });

    for (let i = 0; i < toCreate.length; i += BATCH) {
      await this.prisma.product.createMany({
        data: toCreate.slice(i, i + BATCH).map((r) => ({ ...r, source: 'COMPANY' as const, companySyncedAt: now })),
        skipDuplicates: true,
      });
    }
    for (let i = 0; i < toUpdate.length; i += BATCH) {
      // ไม่แตะ expiryRequired เพราะเป็นข้อมูลที่ฝั่งคลังกำหนดเอง
      await this.prisma.$transaction(
        toUpdate.slice(i, i + BATCH).map((r) =>
          this.prisma.product.update({
            where: { sku: r.sku },
            data: { ...r, source: 'COMPANY', companySyncedAt: now, revision: { increment: 1 } },
          }),
        ),
      );
    }
    return { count: rows.length, created: toCreate.length, updated: toUpdate.length, unchanged: rows.length - toCreate.length - toUpdate.length };
  }

  /** อัปเดตเจ้าของสินค้า (ผู้สั่ง) เฉพาะ SKU ที่เปลี่ยน จัดกลุ่มตามผู้สั่งแล้ว updateMany ทีละก้อน */
  private async syncProductCustomers(recordset: { sku: string; customerCode: string }[]): Promise<{ updated: number }> {
    const owner = new Map(recordset.map((r) => [code(r.sku), code(r.customerCode)]));
    const current = await this.prisma.product.findMany({ where: { source: 'COMPANY' }, select: { sku: true, customerCode: true } });
    const changes = new Map<string, string[]>();
    for (const p of current) {
      const next = owner.get(p.sku) ?? '';
      if (next === p.customerCode) continue;
      if (!changes.has(next)) changes.set(next, []);
      changes.get(next)!.push(p.sku);
    }
    let updated = 0;
    for (const [customerCode, skus] of changes) {
      for (let i = 0; i < skus.length; i += BATCH) {
        updated += (await this.prisma.product.updateMany({ where: { sku: { in: skus.slice(i, i + BATCH) } }, data: { customerCode } })).count;
      }
    }
    return { updated };
  }

  private async syncCustomerRows(recordset: CompanyCustomerRow[], now: Date): Promise<Counts> {
    const seen = new Set<string>();
    const rows = [];
    for (const r of recordset) {
      // รหัสห้ามยุบช่องว่างกลาง (เช่น "X27 พี.ดี.ซี")
      const customerCode = code(r.code);
      const name = clean(r.name);
      if (!customerCode || !name || seen.has(customerCode)) continue;
      seen.add(customerCode);
      rows.push({ code: customerCode, name, active: true });
    }
    const existing = new Map((await this.prisma.customer.findMany()).map((c) => [c.code, c]));
    const toCreate = rows.filter((r) => !existing.has(r.code));
    const toUpdate = rows.filter((r) => {
      const c = existing.get(r.code);
      return c && (c.name !== r.name || !c.active);
    });
    // ลบจากระบบบริษัทแล้ว: ปิดไว้ ไม่ลบ เพราะออเดอร์เก่ายังอ้างถึง
    const gone = [...existing.values()].filter((c) => c.active && !seen.has(c.code)).map((c) => c.code);
    if (toCreate.length) await this.prisma.customer.createMany({ data: toCreate.map((r) => ({ ...r, companySyncedAt: now })), skipDuplicates: true });
    if (toUpdate.length) {
      await this.prisma.$transaction(toUpdate.map((r) => this.prisma.customer.update({ where: { code: r.code }, data: { ...r, companySyncedAt: now } })));
    }
    if (gone.length) await this.prisma.customer.updateMany({ where: { code: { in: gone } }, data: { active: false } });
    return { count: rows.length, created: toCreate.length, updated: toUpdate.length, unchanged: rows.length - toCreate.length - toUpdate.length, deactivated: gone.length };
  }

  private async syncPackRows(recordset: CompanyPackRow[], now: Date): Promise<Counts> {
    // ตัวคูณ = ชิ้นต่อหน่วยของขนาดบรรจุ ÷ ชิ้นต่อหน่วยนับสต็อกของสินค้า
    const productUnitQty = new Map(
      (await this.prisma.product.findMany({ where: { source: 'COMPANY' }, select: { sku: true, unitQty: true, name: true } })).map((p) => [
        p.sku,
        { unitQty: Number(p.unitQty) || 1, name: p.name },
      ]),
    );
    const seen = new Set<string>();
    const rows = [];
    for (const r of recordset) {
      const packCode = code(r.code);
      const sku = code(r.sku);
      const product = productUnitQty.get(sku);
      if (!packCode || !product || seen.has(packCode)) continue;
      seen.add(packCode);
      const unitQty = Number(r.unitQty) > 0 ? round(Number(r.unitQty), 3) : 1;
      rows.push({
        code: packCode,
        sku,
        name: clean(r.name) || product.name,
        unitName: clean(r.unitName) || 'ชิ้น',
        unitQty,
        factor: round(unitQty / product.unitQty, 4),
        active: flag(r.active),
      });
    }

    const existing = new Map((await this.prisma.productPack.findMany()).map((k) => [k.code, k]));
    const toCreate = rows.filter((r) => !existing.has(r.code));
    const toUpdate = rows.filter((r) => {
      const k = existing.get(r.code);
      return (
        k &&
        (k.sku !== r.sku ||
          k.name !== r.name ||
          k.unitName !== r.unitName ||
          Number(k.unitQty) !== r.unitQty ||
          Number(k.factor) !== r.factor ||
          k.active !== r.active)
      );
    });
    // บาร์โค้ดที่ถูกลบจากระบบบริษัท: ปิดใช้งาน ไม่ลบทิ้ง เพราะใบรับเก่ายังอ้างถึง
    const gone = [...existing.values()].filter((k) => k.active && !seen.has(k.code) && productUnitQty.has(k.sku)).map((k) => k.code);

    for (let i = 0; i < toCreate.length; i += BATCH) {
      await this.prisma.productPack.createMany({
        data: toCreate.slice(i, i + BATCH).map((r) => ({ ...r, companySyncedAt: now })),
        skipDuplicates: true,
      });
    }
    for (let i = 0; i < toUpdate.length; i += BATCH) {
      await this.prisma.$transaction(
        toUpdate.slice(i, i + BATCH).map((r) =>
          this.prisma.productPack.update({ where: { code: r.code }, data: { ...r, companySyncedAt: now } }),
        ),
      );
    }
    for (let i = 0; i < gone.length; i += BATCH) {
      await this.prisma.productPack.updateMany({ where: { code: { in: gone.slice(i, i + BATCH) } }, data: { active: false } });
    }
    return {
      count: rows.length,
      created: toCreate.length,
      updated: toUpdate.length,
      unchanged: rows.length - toCreate.length - toUpdate.length,
      deactivated: gone.length,
    };
  }
}

@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Post('products')
  @RequirePermissions('products.manage')
  products() {
    return this.sync.syncProducts();
  }
}

@Module({ controllers: [SyncController], providers: [SyncService] })
export class SyncModule {}
