// Integration checks run inside one PostgreSQL transaction, rolled back at the end.
require('reflect-metadata');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PrismaClient } = require('@prisma/client');
const { Reflector } = require('@nestjs/core');
const { OrdersService, OrdersController } = require('../apps/api/dist/orders/orders.module.js');
const { AuthGuard } = require('../apps/api/dist/auth/auth.guard.js');
const env = require('dotenv').parse(fs.readFileSync('apps/api/.env'));
const target = new URL(env.DATABASE_URL);
assert.equal(target.hostname, 'localhost');
assert.equal(target.port, '5432');
assert.equal(target.pathname, '/petmore_wms');
const prisma = new PrismaClient({ datasourceUrl: env.DATABASE_URL });
const rollback = new Error('ROLLBACK_ORDER_TESTS');
let checks = 0;

async function run() {
  const user = { id: 'order-integration-test', username: 'test', displayName: 'test', roleCode: 'WH', permissions: ['orders.create', 'orders.view'], warehouseScope: { all: false, codes: [] } };
  try {
    await prisma.$transaction(async (tx) => {
      const serviceDb = new Proxy(tx, { get(target, key) {
        if (key === '$transaction') return (task) => typeof task === 'function' ? task(tx) : Promise.all(task);
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } });
      const orders = new OrdersService(serviceDb);
      const marker = 'ORDER-TEST-' + randomUUID().slice(0, 8);
      const sku = marker + '-PRODUCT', packCode = marker + '-PACK';
      await tx.product.create({ data: { sku, name: 'สินค้าทดสอบ (transaction rollback)', unit: 'ชิ้น', active: true } });
      await tx.productPack.create({ data: { code: packCode, sku, name: 'สินค้าทดสอบแบบแพ็ค', unitName: 'แพ็ค', unitQty: 12, factor: 12 } });
      const stocks = await tx.stockBalance.count(), movements = await tx.stockMovement.count();
      const body = { requestId: randomUUID(), customerName: 'ผู้สั่งทดสอบ', customerType: 'CUSTOMER', phone: '', channel: 'ทดสอบ', date: '2026-10-06', dueDate: '2026-10-07', reference: marker, note: '', lines: [
        { sku: '', packCode: '', name: 'กรอกเอง', unit: 'ถุง', qty: 1.125, unitPrice: 0.10 },
        { sku, packCode, name: 'ชื่อปลอมจาก client', unit: 'หน่วยปลอม', qty: 1, unitPrice: 0.20 },
      ] };
      const saved = await orders.post(user, body);
      assert.match(saved.id, /^SO-\d{4}-\d{6,}$/); checks++;
      assert.equal(saved.total, 0.31); assert.equal(saved.lines[0].amount, 0.11); checks++;
      assert.equal(saved.lines[1].name, 'สินค้าทดสอบแบบแพ็ค'); assert.equal(saved.lines[1].unit, 'แพ็ค'); checks++;
      assert.equal((await orders.post(user, body)).id, saved.id);
      assert.equal(await tx.salesOrder.count({ where: { requestId: body.requestId } }), 1); checks++;
      await assert.rejects(() => orders.post(user, { ...body, customerName: 'เปลี่ยนผู้สั่ง' }), (e) => e.getStatus() === 409); checks++;
      const other = { ...user, id: 'another-test-actor' };
      await assert.rejects(() => orders.get(other, saved.id), (e) => e.getStatus() === 403); checks++;
      assert.equal((await orders.list(other, marker)).total, 0); checks++;
      assert.equal((await orders.list(user, marker)).rows[0].id, saved.id); checks++;
      for (const invalid of [
        { lines: [] }, { date: '2026-02-31' }, { dueDate: '2026-10-05' },
        { lines: [{ ...body.lines[0], qty: -1 }] }, { lines: [{ ...body.lines[0], qty: 1.0001 }] },
        { lines: [{ ...body.lines[0], unitPrice: -1 }] }, { lines: [{ ...body.lines[0], unitPrice: 0.001 }] },
        { lines: [{ ...body.lines[1], packCode: 'missing-pack' }] }, { customerName: '' },
        { lines: [{ ...body.lines[0], qty: 100000000, unitPrice: 100000000 }] },
      ]) { await assert.rejects(() => orders.post(user, { ...body, requestId: randomUUID(), ...invalid }), (e) => e.getStatus() === 400); checks++; }
      await tx.product.update({ where: { sku }, data: { active: false } });
      await assert.rejects(() => orders.post(user, { ...body, requestId: randomUUID() }), (e) => e.getStatus() === 400); checks++;
      assert.equal(await tx.stockBalance.count(), stocks); assert.equal(await tx.stockMovement.count(), movements); checks++;
      throw rollback;
    }, { timeout: 30000 });
  } catch (e) { if (e !== rollback) throw e; }

  const request = { headers: { authorization: 'Bearer test' } };
  const context = { getHandler: () => OrdersController.prototype.post, getClass: () => OrdersController, switchToHttp: () => ({ getRequest: () => request }) };
  await assert.rejects(() => new AuthGuard(new Reflector(), { resolve: async () => null }).canActivate(context), (e) => e.getStatus() === 401); checks++;
  await assert.rejects(() => new AuthGuard(new Reflector(), { resolve: async () => ({ user: { ...user, permissions: [] } }) }).canActivate(context), (e) => e.getStatus() === 403); checks++;
  assert.equal(await new AuthGuard(new Reflector(), { resolve: async () => ({ user }) }).canActivate(context), true); checks++;
  console.log(`Passed ${checks} order checks. All test orders/products rolled back; company SQL Server was never connected.`);
}
run().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
