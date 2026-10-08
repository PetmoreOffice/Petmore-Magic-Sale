import { Controller, Get, Injectable, Module, NotFoundException, Param } from '@nestjs/common';
import type { ScanResult, SessionUser } from '@petmore/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CurrentUser } from '../auth/decorators';
import { canAccessWarehouse } from '../common/scope';
import { toLocationDto } from '../common/util';
import { ProductsModule, ProductsService, toProductDto } from '../products/products.module';

/**
 * จุดเดียวสำหรับทุกการสแกน (Handheld / USB / กล้องมือถือ)
 * รับค่าที่อ่านได้ แล้วบอกว่าเป็นสินค้า (SKU/บาร์โค้ด) หรือป้าย Location (QR/Code128 = Location ID)
 */
@Injectable()
export class ScanService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly products: ProductsService,
  ) {}

  async resolve(user: SessionUser, raw: string): Promise<ScanResult> {
    const code = raw.trim();
    const location = await this.prisma.location.findUnique({ where: { id: code }, include: { zone: true } });
    if (location && canAccessWarehouse(user, location.warehouseCode)) {
      return { type: 'location', location: toLocationDto(location) };
    }
    const found = await this.products.findByCode(code);
    if (found) return { type: 'product', product: toProductDto(found.product, found.packs), packCode: found.packCode };
    throw new NotFoundException(`ไม่พบสินค้าหรือ Location ที่ตรงกับ ${code} สแกนใหม่หรือพิมพ์รหัสให้ถูกต้อง`);
  }
}

@Controller('scan')
export class ScanController {
  constructor(private readonly scan: ScanService) {}

  @Get(':code')
  resolve(@CurrentUser() user: SessionUser, @Param('code') code: string) {
    return this.scan.resolve(user, code);
  }
}

@Module({ imports: [ProductsModule], controllers: [ScanController], providers: [ScanService] })
export class ScanModule {}
