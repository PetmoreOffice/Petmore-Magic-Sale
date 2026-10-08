import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { UsersModule } from './users/users.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { StorageModule } from './storage/storage.module';
import { ProductsModule } from './products/products.module';
import { ReceivingModule } from './receiving/receiving.module';
import { StockModule } from './stock/stock.module';
import { MovesModule } from './moves/moves.module';
import { ScanModule } from './scan/scan.module';
import { SyncModule } from './sync/sync.module';
import { OrdersModule } from './orders/orders.module';
import { ReturnsModule } from './returns/returns.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    WarehousesModule,
    StorageModule,
    ProductsModule,
    ReceivingModule,
    StockModule,
    MovesModule,
    ScanModule,
    SyncModule,
    OrdersModule,
    ReturnsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
