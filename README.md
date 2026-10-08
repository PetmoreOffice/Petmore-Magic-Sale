# Petmore Magic Sale

ระบบคลังสินค้าของร้านอาหารสัตว์ ธีม Magic × ร้านอาหารสัตว์ ขึ้นโครงใหม่จากระบบเดิมบน Google Apps Script (`OMS (gs.).txt`) โดยอิงแผนภาพใน `PET MORE WMS UML.md`

ใช้ได้ 3 แบบจากเว็บแอปตัวเดียว:

| อุปกรณ์ | วิธีสแกน |
|---|---|
| Handheld (Zebra, Honeywell, Urovo ฯลฯ) | หัวสแกนในตัวเครื่อง ทำงานแบบคีย์บอร์ด ต้องตั้งให้ส่ง **Enter** ต่อท้าย (Zebra: DataWedge → Keystroke output → Send ENTER) |
| คอม + เครื่องสแกน USB | ทำงานแบบคีย์บอร์ดเหมือนกัน |
| โทรศัพท์ | กดปุ่มกล้องข้างช่องสแกน (ต้องเปิดเว็บผ่าน **https://** เท่านั้น) |

## โครงสร้าง

หน้าออเดอร์สินค้า `/orders`: จดออเดอร์ที่ลูกค้าหรือคู่ค้าสั่งเข้ามา เลือกจากทะเบียนสินค้าหรือกรอกชื่อเอง บันทึกผู้สั่ง จำนวน ราคา วันที่นัดรับ และดูย้อนหลัง/พิมพ์ได้ การบันทึกยังไม่ตัดสต็อกและไม่คำนวณภาษีหรือส่วนลด

ออเดอร์เก็บใน PostgreSQL ของแอปเท่านั้น ไม่มีการเขียนไป SQL Server บริษัท ผู้ดูแลมีสิทธิ์หน้าออเดอร์จาก migration; ผู้ใช้อื่นต้องได้รับ `orders.create` / `orders.view` และดูเฉพาะออเดอร์ที่ตนสร้าง ผู้มี `users.manage` ดูได้ทุกออเดอร์

เพิ่มตารางบนฐานข้อมูล local ด้วย `node scripts/migrate-local-orders.cjs` (ปฏิเสธปลายทางอื่นนอก `localhost:5432/petmore_wms`) ทดสอบหลัง build ด้วย `node scripts/test-orders.cjs`; การทดสอบใช้ transaction แล้ว rollback ข้อมูลทดสอบทั้งหมด

```
packages/shared   สิทธิ์ 15 ข้อ + type ที่ใช้ร่วมกันทั้งหน้าเว็บและเซิร์ฟเวอร์
apps/api          NestJS + Prisma + PostgreSQL
  prisma/schema.prisma   โครงข้อมูลตาม Class Diagram
  src/receiving          รับสินค้า (transaction: ใบรับ + เพิ่มสต็อก + Movement)
  src/moves              ย้าย Location (ตัดยอดแบบกันติดลบเมื่อกดพร้อมกัน)
  src/scan               GET /api/scan/:code → บอกว่าเป็นสินค้าหรือ Location
  src/sync               ดึงสินค้าจาก SQL Server บริษัท (อ่านอย่างเดียว) ทุก 15 นาที
apps/web          React + Vite + PWA (ติดตั้งเป็นไอคอนบนมือถือ/Handheld ได้)
  src/components/ScanInput.tsx   ช่องสแกนเดียวใช้ได้ทุกอุปกรณ์
```

## เริ่มใช้งานครั้งแรก

ต้องมี Node.js 22 ขึ้นไป และ PostgreSQL (ติดตั้งเอง หรือใช้ Docker Desktop)

```bash
npm install
```

```bash
copy apps\api\.env.example apps\api\.env
```

แก้ `apps/api/.env`: ตั้ง `DATABASE_URL` ให้ชี้ PostgreSQL และตั้ง `SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` (อย่างน้อย 8 ตัวอักษร) สำหรับผู้ดูแลคนแรก

```bash
npm run db:up
```

(ข้ามขั้นนี้ถ้าติดตั้ง PostgreSQL เองแล้ว)

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm run dev
```

เปิด http://localhost:5173 แล้วเข้าสู่ระบบด้วยบัญชีผู้ดูแลที่ตั้งไว้

## ทดสอบกล้องบนมือถือ

มือถือกับคอมต้องอยู่ Wi-Fi เดียวกัน

```bash
npm run dev:https -w @petmore/web
```

เปิด `https://<IP ของคอม>:5173` บนมือถือ แล้วกดยอมรับใบรับรองทดสอบ ตอนใช้งานจริงให้ใช้โดเมนที่มีใบรับรอง HTTPS จริง

## เชื่อม SQL Server บริษัท

1. ขอ IT สร้าง user บน SQL Server ที่มีสิทธิ์ **SELECT อย่างเดียว** เฉพาะตารางสินค้า
2. ใส่ `MSSQL_HOST`, `MSSQL_DATABASE`, `MSSQL_USER`, `MSSQL_PASSWORD` ใน `apps/api/.env`
3. แก้ `MSSQL_PRODUCT_QUERY` ให้ตรงตารางจริง โดยตั้งชื่อคอลัมน์ผลลัพธ์เป็น `sku, name, barcode, unit, active`
4. ระบบ sync เองทุก 15 นาที หรือสั่งทันทีด้วย `POST /api/sync/products` (ต้องมีสิทธิ์ `products.manage`)

สินค้าที่มาจาก SQL Server (`source = COMPANY`) แก้ใน WMS ได้เฉพาะ "ต้องกรอกวันหมดอายุ" ส่วนชื่อ บาร์โค้ด และหน่วย ให้แก้ที่ระบบบริษัท

## สิ่งที่ทำแล้ว / ยังไม่ทำ

ทำแล้วและทดสอบผ่าน (API 25 กรณี + หน้าเว็บขนาดจอมือถือ):
- เข้าสู่ระบบ / ออก / หมดอายุ 12 ชม. / ตรวจสิทธิ์ใหม่ทุก 60 วินาที
- สิทธิ์รายข้อ + จำกัดคลังรายคน
- รับสินค้า (สแกนสินค้าและ Location, บังคับวันหมดอายุ, กันกดซ้ำ)
- ย้าย Location (กันยอดติดลบ, กันกดซ้ำ)
- ดูสต็อก ค้นด้วย SKU / บาร์โค้ด / Location / ล็อต

มี API แล้ว แต่ยังไม่มีหน้าเว็บ:
- ทะเบียนสินค้า และการนำเข้าจาก Excel
- คลัง / โซน / Location (สร้างและแก้ไข) — ส่วนพิมพ์ป้าย QR + Code128 มีหน้าเว็บแล้วที่เมนู "พิมพ์ป้าย Location"
- ผู้ใช้และสิทธิ์ ประวัติการแก้ไข
- รายการใบรับย้อนหลัง พิมพ์ใบรับ ประวัติ Movement

ยังไม่รองรับ: ทำงานตอนไม่มีเน็ต (offline)
