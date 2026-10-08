import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Product as ProductRow, ProductPack as PackRow } from '@prisma/client';
import { searchKey } from '@petmore/shared';
import { NO_PRODUCT_TYPE, typeGroup } from '@petmore/shared';
import type { CatalogItem, Paged, Product, ProductPack, ProductType, SessionUser } from '@petmore/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { CurrentUser, RequirePermissions } from '../auth/decorators';
import { audit, optionalText, requireRequestId, requireText } from '../common/util';

/** ขนาดบรรจุแบบเดียวของสินค้าที่ไม่มีข้อมูลจาก GOODSMASTER (สร้างใน WMS): 1 หน่วยนับสต็อก */
export function basePack(p: ProductRow): ProductPack {
  return { code: p.sku, name: p.name, unitName: p.unit, unitQty: Number(p.unitQty), factor: 1, active: true };
}

function toPackDto(k: PackRow): ProductPack {
  return { code: k.code, name: k.name, unitName: k.unitName, unitQty: Number(k.unitQty), factor: Number(k.factor), active: k.active };
}

export function toProductDto(p: ProductRow, packs?: PackRow[]): Product {
  const dto: Product = {
    sku: p.sku,
    name: p.name,
    barcode: p.barcode,
    unit: p.unit,
    brand: p.brand,
    category: p.category,
    categoryGroup: p.categoryGroup,
    active: p.active,
    expiryRequired: p.expiryRequired,
    source: p.source,
    customerCode: p.customerCode,
    revision: p.revision,
  };
  if (packs) {
    const active = packs.filter((k) => k.active).map(toPackDto);
    dto.packs = active.length ? active.sort((a, b) => a.factor - b.factor) : [basePack(p)];
  }
  return dto;
}

/**
 * หาขนาดบรรจุที่ใช้รับสินค้า: รหัสขนาดบรรจุจาก GOODSMASTER หรือ SKU เอง (= 1 หน่วยนับสต็อก)
 * คืน factor จากฐานข้อมูลเสมอ ไม่เชื่อตัวคูณที่หน้าเว็บส่งมา
 */
export async function resolvePack(db: Tx | PrismaService, product: ProductRow, packCode: string): Promise<ProductPack | null> {
  if (!packCode || packCode === product.sku) {
    const own = await db.productPack.findUnique({ where: { code: product.sku } });
    if (own && own.sku === product.sku && own.active) return toPackDto(own);
    return basePack(product);
  }
  const pack = await db.productPack.findUnique({ where: { code: packCode } });
  return pack && pack.sku === product.sku && pack.active ? toPackDto(pack) : null;
}

interface SaveProductInput {
  requestId: string;
  create: boolean;
  revision: number;
  sku: string;
  name: string;
  barcode: string;
  unit: string;
  active: boolean;
  expiryRequired: boolean;
}

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  /** ค้นสินค้าแบบเดียวกับหน้าออเดอร์: บาร์โค้ดตรงตัว หรือทุกคำต้องเจอใน searchKey (ไม่สนเว้นวรรค) */
  async list(q = '') {
    const term = q.trim().slice(0, 100);
    const words = term.split(/\s+/).map(searchKey).filter(Boolean).slice(0, 6);
    const rows = await this.prisma.product.findMany({
      where: term
        ? {
            OR: [
              { barcode: { contains: term } },
              { packs: { some: { code: { contains: term } } } },
              ...(words.length ? [{ AND: words.map((w) => ({ searchKey: { contains: w } })) }] : []),
            ],
          }
        : undefined,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      take: 200,
    });
    return rows.map((p) => toProductDto(p));
  }

  /**
   * หาสินค้าจากรหัสที่สแกน ตามลำดับ:
   * 1) บาร์โค้ดของขนาดบรรจุ (GOODSMASTER) — ได้ขนาดบรรจุที่สแกนมาด้วย
   * 2) รหัส SKU  3) บาร์โค้ดหลักของสินค้า (SKU_BARCODE)
   */
  async findByCode(code: string): Promise<{ product: ProductRow; packs: PackRow[]; packCode: string | null } | null> {
    const value = code.trim();
    if (!value) return null;
    const pack = await this.prisma.productPack.findUnique({ where: { code: value } });
    let product: ProductRow | null = null;
    let packCode: string | null = null;
    if (pack) {
      product = await this.prisma.product.findUnique({ where: { sku: pack.sku } });
      packCode = pack.active ? pack.code : null;
    }
    product ??=
      (await this.prisma.product.findUnique({ where: { sku: value } })) ??
      (await this.prisma.product.findFirst({ where: { barcode: value, active: true } }));
    if (!product) return null;
    const packs = await this.prisma.productPack.findMany({ where: { sku: product.sku } });
    return { product, packs, packCode };
  }

  /** หน้าเลือกสินค้าของออเดอร์: SKU ที่เปิดใช้และมีบาร์โค้ดใน GOODSMASTER ค้นได้ทั้งชื่อ SKU ยี่ห้อ และบาร์โค้ด */
  /** เงื่อนไขชนิดสินค้า: หมวดแม่ หรือหมวดย่อยของสินค้าที่ไม่มีหมวดแม่ */
  private typeWhere(type: string, sub: string): Prisma.ProductWhereInput[] {
    const t = type.trim().slice(0, 200), s = sub.trim().slice(0, 200);
    const out: Prisma.ProductWhereInput[] = [];
    if (t === NO_PRODUCT_TYPE) out.push({ categoryGroup: '', category: '' });
    else if (t) out.push({ OR: [{ categoryGroup: t }, { categoryGroup: '', category: t }] });
    if (s) out.push({ category: s });
    return out;
  }

  /** รายการชนิดสินค้า + จำนวน (ตามตัวกรองผู้สั่ง) ใช้ทำแถบชนิดสินค้าแบบร้านค้าออนไลน์ */
  async types(customerValue = ''): Promise<ProductType[]> {
    const customerCode = customerValue.trim().slice(0, 50);
    const groups = await this.prisma.product.groupBy({
      by: ['categoryGroup', 'category'],
      where: { active: true, packs: { some: { active: true } }, ...(customerCode ? { customerCode } : {}) },
      _count: { _all: true },
    });
    const map = new Map<string, ProductType>();
    for (const g of groups) {
      const name = g.categoryGroup || g.category || NO_PRODUCT_TYPE;
      const type = map.get(name) ?? { name, count: 0, subs: [] };
      type.count += g._count._all;
      if (g.categoryGroup && g.category) type.subs.push({ name: g.category, count: g._count._all });
      map.set(name, type);
    }
    for (const t of map.values()) t.subs.sort((a, b) => b.count - a.count);
    // ชนิดที่มีสินค้ามากขึ้นก่อน "ไม่ระบุชนิด" ท้ายสุด
    return [...map.values()].sort((a, b) => Number(a.name === NO_PRODUCT_TYPE) - Number(b.name === NO_PRODUCT_TYPE) || b.count - a.count);
  }

  async catalog(q = '', pageValue = '1', customerValue = '', type = '', sub = '', group = ''): Promise<Paged<CatalogItem>> {
    const size = 30;
    const page = /^\d+$/.test(pageValue) ? Math.max(1, Math.min(10_000, Number(pageValue))) : 1;
    const term = q.trim().slice(0, 100);
    // เลือกผู้สั่งแล้ว แสดงเฉพาะสินค้าของผู้สั่งนั้น (SKU_ICCAT)
    const customerCode = customerValue.trim().slice(0, 50);
    const where: Prisma.ProductWhereInput = {
      active: true,
      packs: { some: { active: true } },
      ...(customerCode ? { customerCode } : {}),
      AND: this.typeWhere(type, sub),
    };
    // หมวดใหญ่ (ยังไม่ได้เลือกชนิด): รวมทุกชนิดที่จัดอยู่ในหมวดนั้น
    if (group && !type.trim()) {
      const names = (await this.types(customerValue)).map((t) => t.name).filter((n) => typeGroup(n) === group);
      (where.AND as Prisma.ProductWhereInput[]).push({ OR: names.length ? names.flatMap((n) => this.typeWhere(n, '')) : [{ sku: '' }] });
    }
    if (term) {
      // บาร์โค้ดที่สแกนมาตรงตัว (มีช่องว่างกลางได้) หรือทุกคำที่พิมพ์ต้องเจอใน searchKey (SKU+ชื่อ+ยี่ห้อ ไม่สนเว้นวรรค)
      // "torofreeze" เจอ "Toro Freeze Dried", "กระเป๋า ชมพู" เจอทั้งสองคำแม้อยู่ห่างกัน
      const words = term.split(/\s+/).map(searchKey).filter(Boolean).slice(0, 6);
      where.OR = [
        { packs: { some: { active: true, code: { contains: term } } } },
        ...(words.length ? [{ AND: words.map((w) => ({ searchKey: { contains: w } })) }] : []),
      ];
    }
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        orderBy: [{ name: 'asc' }, { sku: 'asc' }],
        skip: (page - 1) * size,
        take: size,
        include: { packs: { where: { active: true } } },
      }),
    ]);
    return {
      rows: rows.map((p) => {
        const packs = [...p.packs].sort((a, b) => Number(a.unitQty) - Number(b.unitQty));
        const units = new Map<string, number>();
        for (const k of packs) if (!units.has(k.unitName)) units.set(k.unitName, Number(k.unitQty));
        return {
          sku: p.sku, name: p.name, brand: p.brand, unit: p.unit, categoryGroup: p.categoryGroup || p.category,
          units: [...units].map(([name, qty]) => ({ name, qty })), barcodes: packs.length,
        };
      }),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / size)),
    };
  }

  async save(actor: SessionUser, input: SaveProductInput) {
    requireRequestId(input.requestId);
    const sku = requireText(input.sku, 'SKU', 50);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.product.findUnique({ where: { sku } });
      if (input.create && before) throw new ConflictException('SKU นี้มีอยู่แล้ว แก้ไขรายการเดิม หรือใช้ SKU อื่น');
      if (!input.create && (!before || before.revision !== input.revision)) {
        throw new ConflictException('มีคนแก้สินค้านี้ไปก่อน โหลดหน้าใหม่แล้วแก้อีกครั้ง');
      }
      let after: ProductRow;
      if (before?.source === 'COMPANY') {
        // สินค้าจาก SQL Server บริษัท: แก้ได้เฉพาะช่องของคลัง ส่วนอื่นจะถูก sync ทับ
        after = await tx.product.update({
          where: { sku },
          data: { expiryRequired: !!input.expiryRequired, revision: { increment: 1 } },
        });
      } else {
        const data = {
          name: requireText(input.name, 'ชื่อสินค้า', 200),
          barcode: optionalText(input.barcode, 50) || null,
          unit: requireText(input.unit, 'หน่วย', 20),
          active: !!input.active,
          expiryRequired: !!input.expiryRequired,
        };
        const key = searchKey(`${sku} ${data.name} ${before?.brand ?? ''}`);
        after = before
          ? await tx.product.update({ where: { sku }, data: { ...data, searchKey: key, revision: { increment: 1 } } })
          : await tx.product.create({ data: { ...data, sku, searchKey: key } });
      }
      await audit(tx, 'product', sku, actor.id, before, after);
      return toProductDto(after);
    });
  }

  async setExpiryBulk(actor: SessionUser, body: { skus: string[]; expiryRequired: boolean }) {
    const skus = [...new Set(body.skus ?? [])].slice(0, 500);
    if (!skus.length) throw new BadRequestException('ยังไม่ได้เลือกสินค้า เลือกอย่างน้อย 1 รายการ');
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.product.updateMany({
        where: { sku: { in: skus } },
        data: { expiryRequired: !!body.expiryRequired, revision: { increment: 1 } },
      });
      await audit(tx, 'product', `bulk:${skus.length}`, actor.id, null, { skus, expiryRequired: !!body.expiryRequired });
      return { updated: r.count };
    });
  }
}

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermissions('products.manage', 'receive.create', 'stock.view', 'orders.create')
  list(@Query('q') q?: string) {
    return this.products.list(q);
  }

  @Get('catalog')
  @RequirePermissions('orders.create')
  catalog(
    @Query('q') q?: string, @Query('page') page?: string, @Query('customer') customer?: string,
    @Query('type') type?: string, @Query('sub') sub?: string, @Query('group') group?: string,
  ) {
    return this.products.catalog(q, page, customer, type, sub, group);
  }

  @Get('types')
  @RequirePermissions('orders.create')
  types(@Query('customer') customer?: string) {
    return this.products.types(customer);
  }

  @Get('lookup/:code')
  async lookup(@Param('code') code: string) {
    const found = await this.products.findByCode(code);
    if (!found) throw new NotFoundException(`ไม่พบสินค้าที่ตรงกับ ${code} สแกนใหม่หรือพิมพ์รหัสให้ถูกต้อง`);
    return toProductDto(found.product, found.packs);
  }

  @Post()
  @RequirePermissions('products.manage')
  save(@CurrentUser() actor: SessionUser, @Body() body: SaveProductInput) {
    return this.products.save(actor, body);
  }

  @Patch('expiry')
  @RequirePermissions('products.manage')
  setExpiryBulk(@CurrentUser() actor: SessionUser, @Body() body: { skus: string[]; expiryRequired: boolean }) {
    return this.products.setExpiryBulk(actor, body);
  }
}

@Module({ controllers: [ProductsController], providers: [ProductsService], exports: [ProductsService] })
export class ProductsModule {}
