# Petmore Magic Sale

ระบบคลังสินค้า (WMS) ของร้านอาหารสัตว์ ใช้บน Handheld (หัวสแกนแบบคีย์บอร์ด), กล้องมือถือ และคอม
ข้อความในหน้าจอเป็นภาษาไทย

- `packages/shared` สิทธิ์และ type ร่วม (API ใช้ dist ต้อง `npm run build:shared` ก่อน, เว็บ alias ไปที่ `src` ใน vite.config.ts แก้แล้ว HMR ทันที ห้ามกลับไปใช้ optimizeDeps เพราะ cache ค้างจนหน้าเว็บพัง)
- `apps/api` NestJS + Prisma + PostgreSQL, sync สินค้าจาก SQL Server บริษัทแบบอ่านอย่างเดียว
- `apps/web` React + Vite PWA
- ตรวจงาน: `npm run typecheck`, `npm run build`

## ธีม

**Magic × ร้านอาหารสัตว์** — เวทมนตร์ (ประกายดาว ท้องฟ้ายามค่ำ หมวกพ่อมด) ผสมความอบอุ่นของร้านขายอาหารสัตว์ (รอยเท้า เม็ดอาหาร ถุงอาหาร)
- เวทมนตร์ใช้เป็นจังหวะตอบรับ (สแกนสำเร็จ บันทึกสำเร็จ) ไม่ใช่ของประดับทุกจุด
- หน้าจองานคลังต้องอ่านง่ายบนจอ Handheld เล็กๆ ปุ่มสูง ≥ 48px
- ห้ามให้แอนิเมชันแย่งโฟกัสจากช่องสแกน และต้องเคารพ `prefers-reduced-motion`

## SQL Server บริษัท (ตรวจเมื่อ 2026-10-06)

- SQL Server 2014 RTM (12.0.2000) Standard, ฐาน NEWGENMAN31, collation Thai_CI_AS
- รองรับแค่ TLS 1.0 ต้องตั้ง `MSSQL_TLS_MIN_VERSION=TLSv1` ไม่งั้นเชื่อมไม่ได้ (`unsupported protocol`)
- ตารางที่ดึง (มี foreign key ประกาศไว้จริง join ได้ 100%):
  - `SKUMASTER` สินค้าหลัก (SKU_KEY, SKU_CODE, SKU_NAME, SKU_BARCODE, SKU_ENABLE Y/N) ~24,745
  - `GOODSMASTER.GOODS_SKU → SKUMASTER.SKU_KEY` ขนาดบรรจุ/บาร์โค้ด ~59,797 (GOODS_CODE ไม่ซ้ำ, ชื่อที่แสดง = GOODS_ALIAS ว่าง 15% ใช้ SKU_NAME แทน)
  - `GOODSMASTER.GOODS_UTQ` และ `SKUMASTER.SKU_S_UTQ → UOFQTY.UTQ_KEY` (UTQ_NAME, UTQ_QTY = ชิ้นต่อหน่วย)
  - `SKUMASTER.SKU_BRN → BRAND.BRN_KEY`, `SKUMASTER.SKU_ICDEPT → ICDEPT.ICDEPT_KEY` (ICDEPT_PARENT = หมวดแม่, key 0 = ไม่ระบุ)
- สินค้า 1 SKU มีหลายบาร์โค้ดของหน่วยเดียวกันได้ ขนาดที่ให้เลือก = หน่วยไม่ซ้ำ (`packSizes()` ใน `apps/web/src/lib/packs.ts`)
- ห้ามใช้ GOODS_MASTER เป็นหน่วยหลัก (17,618 SKU ไม่ได้ตั้ง) ขนาดตั้งต้นใช้บาร์โค้ดที่สแกน
- สต็อกเก็บเป็นหน่วยนับสต็อก (SKU_S_UTQ) ตัวคูณ = UTQ_QTY ของขนาดบรรจุ ÷ UTQ_QTY ของหน่วยนับสต็อก เซิร์ฟเวอร์คำนวณเอง
- รหัส/บาร์โค้ดห้ามยุบช่องว่างกลาง มีรหัสที่ต่างกันแค่จำนวนช่องว่าง ("12  KBC (P) 1007" กับ "12 KBC (P) 1007")
- บาร์โค้ดหลัก SKU_BARCODE ซ้ำกัน 3 ชุด, ชื่อมีขึ้นบรรทัดใหม่ 68 รายการ (sync ล้างให้แล้ว)
- ห้ามรันคำสั่งเขียนใดๆ กับฐานนี้ ระบบนี้อ่านอย่างเดียว
- `ICCAT` บริษัทคู่ค้า 256 ราย (ICCAT_CODE ไม่ซ้ำ, key 0 = ไม่กำหนดประเภท ตัดทิ้ง) = ผู้สั่งในหน้าออเดอร์ sync ลงตาราง `Customer` รอบเดียวกับสินค้า
- `SKUMASTER.SKU_ICCAT → ICCAT.ICCAT_KEY` เจ้าของสินค้า (24,275/24,287 SKU ผูกแล้ว) sync ลง `Product.customerCode` หน้าออเดอร์ใช้เป็นตัวกรองผู้สั่ง (ไม่บังคับ) และเป็นผู้สั่งตั้งต้นตอนยืนยัน
- ชนิดสินค้า = หมวดแม่ ICDEPT (`categoryGroup` 33 ชนิด) + หมวดย่อย (`category`) สินค้าที่ไม่มีหมวดแม่ใช้หมวดย่อยเป็นชนิด ICDEPT มีแค่ 2 ชั้น จึงเพิ่ม "หมวดใหญ่" 10 หมวดเองที่ `TYPE_GROUPS` ใน shared (จับจากคำในชื่อ ไม่เข้าข้อไหน = อื่นๆ) ตัวเลือก 3 ชั้นอยู่ที่ `CategoryPicker` ใน `components/TypeRail.tsx` (`GET /products/types`, catalog รับ `group/type/sub`)
- ค้นสินค้า/ผู้สั่งไม่สนเว้นวรรค ใช้ `searchKey()` ใน shared ทั้งหน้าออเดอร์และหน้ารับสินค้า (รหัสไม่ตรงตัว → ค้นชื่อแล้วให้แตะเลือก)
- หน้าออเดอร์: เลือกสินค้า → แตะเข้าไปเห็นบาร์โค้ดทุกตัวที่ผูกกับ SKU ใน GOODSMASTER ใช้ชื่อหน่วยตามฐานข้อมูลตรงๆ (PC, PACK x 12, PACK x 4 x 12) ไม่จัดกลุ่มเป็นโหล/ลังเอง

## ตำแหน่ง (โรล) 3 แบบ (`ROLES` ใน shared/permissions.ts)

- `ADMIN` ผู้ดูแลระบบ: ทุกสิทธิ์
- `CHECKER` แอดมิน: ตรวจของเบิก, คืนสินค้า, ดูออเดอร์ทุกคน และงานคลัง (รับเข้า ย้าย ดู/พิมพ์สต็อก พิมพ์ป้าย) ไม่สร้างออเดอร์ ไม่จัดการผู้ใช้
- `PICKER` ผู้เบิกสินค้า (Sup): สร้างออเดอร์แล้วเบิกของ เห็นเฉพาะออเดอร์ที่ตัวเองจด Sup ไม่ได้ขาย อย่าเรียกว่าพนักงานขาย
- ตำแหน่งเป็นแค่ค่าตั้งต้น สิทธิ์เก็บรายคนใน `User.permissions` (migration เปลี่ยนตำแหน่งไม่แตะสิทธิ์)
- หน้าจัดการผู้ใช้ `/users` (`users.view`/`users.manage`, ประวัติต้อง `users.audit`): เลือกตำแหน่งในฟอร์ม = ตั้งสิทธิ์ตามตำแหน่งใหม่ แล้วปรับรายข้อต่อได้
- เซิร์ฟเวอร์กันล็อกตัวเอง: ปิดบัญชีตัวเอง หรือเอา `users.manage` ออกจากตัวเองไม่ได้ รูปแบบชื่อผู้ใช้ตรวจเฉพาะตอนสร้าง (บัญชีเดิม `sa` สั้นกว่า 3 ตัว)

## ตรวจของเบิก (`/check`, สิทธิ์ `picks.check`)

- ใช้ตอนคนเบิกเอาของมาส่ง: สแกนบาร์โค้ดเลขออเดอร์บนใบออเดอร์ แล้วสแกนของทีละชิ้น/กด −+ ระบบเทียบกับออเดอร์ทันที
- บาร์โค้ดคนละตัวแต่ขนาดเดียวกัน (unitName + unitQty) นับเป็นรายการเดียวกัน สแกนขนาดอื่นของ SKU เดียวกัน = ผิดขนาด, SKU ที่ไม่มีในออเดอร์ = ไม่อยู่ในออเดอร์
- ผลเก็บใน `PickCheck` (CK-ปี-เลข) ยอดที่ควรได้มาจากออเดอร์ที่เซิร์ฟเวอร์เท่านั้น ตรวจซ้ำได้ ใช้ครั้งล่าสุดเป็นสถานะ (`SalesOrder.lastCheck`)
- คนมีสิทธิ์ `picks.check` เห็นออเดอร์ทุกคน (เหมือน `users.manage`)

## คืนสินค้า (`/returns`, สิทธิ์ `returns.create`)

- คืนจากออเดอร์ (เบิกเกิน/ขายไม่หมด) หรือใบคืนอิสระ (ปิดงานอีเวนต์) เลขเอกสาร RT-ปี-เลข แยกของดี (FG) / เสียหาย (DM) ต่อบรรทัด
- ยอดเบิก = ยอดนับได้จากผลตรวจของเบิกล่าสุด (ยังไม่ตรวจใช้ยอดในออเดอร์) คืนรวมทุกใบห้ามเกินยอดเบิก (เซิร์ฟเวอร์ตรวจในธุรกรรมเดียวกัน) ขายได้จริง = เบิก − คืน
- ตอนนี้บันทึกประวัติอย่างเดียว ยังไม่เปลี่ยนยอดสต็อก (การเบิกก็ยังไม่ตัดสต็อก ถ้าจะทำต้องทำคู่กัน)

## UI: Tailwind v4 + shadcn/ui

- เพิ่มคอมโพเนนต์: `cd apps/web` แล้ว `npx shadcn@latest add <ชื่อ>` (ไฟล์ลงที่ `src/components/ui`, import ด้วย `@/components/ui/...`)
- สีทั้งหมดอยู่ที่ `--pm-*` ใน `apps/web/src/styles.css` token ของ shadcn (`--primary` ฯลฯ) อ้างจาก `--pm-*` เปลี่ยนที่เดียวพอ
- คลาสสีธีมใช้ได้ใน Tailwind: `bg-brand`, `text-star-ink`, `bg-star-soft`, `text-kibble`, `text-mint`, `font-heading`
- โหมดมืดตามการตั้งค่าเครื่อง (`dark:` = `prefers-color-scheme`) ไม่ใช้คลาส `.dark`
- ปุ่มบนหน้าจองานคลังใช้ `size="touch"` หรือ `size="icon-touch"` (48px)
- ทุกหน้าใช้ shadcn + Tailwind แล้ว CSS เขียนเองเหลือแค่ `.login` (ดาวนิ่งสำรอง) อย่าเพิ่มคลาส CSS แบบเดิมกลับมา
- ชิ้นส่วนงานคลังที่ใช้ซ้ำอยู่ใน `@/components/wms` (Field, PickTile, Notice, StatusBadge) ใช้ตัวเดิมก่อนสร้างใหม่
- หัวข้อ: ชื่อหน้าใน Shell เป็น `<h1>` แล้ว หัวการ์ดในหน้าใช้ `<CardTitle role="heading" aria-level={2}>` ห้ามมี h1 ซ้ำในหน้า
- ปุ่ม/ลิงก์ที่กดได้ต้องสูงอย่างน้อย 44px (ใช้ `size="touch"`), ข้อความแจ้งผลใช้ `<Notice>` (ข้อผิดพลาดเป็น role=alert)
- ห้ามป้ายตัวเล็กเหนือหัวข้อ (eyebrow) ตามกฎของ Impeccable
- ฟอนต์ต้องรองรับภาษาไทย (อย่าใช้ Geist/Inter เป็นฟอนต์หลัก)
- ช่องกรอกใช้ `className={touchInput}` จาก `@/lib/touch`, เลือกรายการใช้ `<NativeSelect size="touch">` (เมนูของเครื่องเอง ใช้ง่ายบนมือถือ)
- บนพื้นท้องฟ้า (bg-brand) ใช้ `on-sky/10` ฯลฯ แทน `white/10` เงาใช้ `shadow-lift` (การ์ด hover) `shadow-stage` `shadow-dock` (แถบล่าง) ห้ามเขียน `rgb(36 26 61)` เอง
- เอกสารที่พิมพ์ (ใบออเดอร์/ใบคืน) ใส่ `data-print-doc` ที่ Card สีขาว-ดำอยู่ใน `@media print`
- ตัวเลือกแบบ `role="radio"` ใน `role="radiogroup"` ได้ลูกศร/Home/End และ roving tabindex อัตโนมัติจาก `lib/radio.ts` (ติดตั้งที่ main.tsx) ห้ามใส่ tabIndex เอง
- หน้าที่โหลดพร้อมแอป (Login, Menu, Receive, Stock, Move) ห้าม import `motion/react` ตรงๆ ใช้ `usePrefersReducedMotion` จาก `@/lib/motion` และ lazy คอมโพเนนต์ที่ใช้ motion; BlurText/CountUp เช็กลดการเคลื่อนไหวในตัวเองแล้ว
- เมนูทั้งหมดของแอปอยู่ที่ `lib/menus.ts` (`APP_MENUS`) หน้าแรกและแถบ "เมนูที่เปิดได้" ในหน้าจัดการผู้ใช้อ่านจากที่นี่ เพิ่มเมนูใหม่ต้องใส่ `perms` (เปิดได้เมื่อมีข้อใดข้อหนึ่ง) และ `related` (สิทธิ์ทุกข้อของเมนู)
- `components/ui/sheet.tsx` เขียนเองตามแบบ shadcn (`shadcn add sheet` จะขอเขียนทับ button.tsx) แผงด้านข้างใช้ตัวนี้
- ตอนติดตั้งคอมโพเนนต์ที่พ่วง button.tsx มาด้วย ให้ตอบ **ไม่** เขียนทับ (มีขนาด touch ที่เพิ่มเอง)

## โลโก้และไอคอน

- โลโก้อยู่ที่ `apps/web/public/brand/` (`logo.png` 720px สำหรับหน้าเข้าสู่ระบบ, `logo-sm.png` 240px สำหรับแถบบน)
- ไอคอน PWA: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (โลโก้บนพื้นสี `--pm-brand`), `apple-touch-icon.png`
- favicon ยังเป็น `public/icon.svg` (รอยเท้า + ดาว) เพราะโลโก้เต็มเล็กเกินจะอ่านที่ 32px
- ไฟล์ต้นฉบับโลโก้มีพื้นโปร่งใส ถ้าได้ไฟล์ใหม่ ให้ trim ขอบแล้วสร้างไอคอนใหม่ทุกขนาด

## เวทีสแกน (ScanInput)

- พื้นท้องฟ้ายามค่ำทั้งสองโหมด, เลเซอร์ทองวิ่งเมื่อพร้อมสแกน, ป้าย "พร้อมสแกน / กำลังค้นหา / แตะเพื่อสแกน"
- `onScan` คืน `{ ok, text? }`: ok=true สว่างทอง + แสดง "สแกนล่าสุด", ok=false สั่น + แดง
- วาง ScanInput เป็นชิ้นระดับบนของหน้า อย่าซ้อนในการ์ด (Impeccable: ห้ามการ์ดซ้อนการ์ด)
- เปลี่ยนโฟกัสผ่าน `focusInput()` เท่านั้น เพื่อให้สถานะพร้อมสแกนตรงกับความจริง

## ป้าย Location

- `LocationLabel` ขนาด 190×88 มม. A4 หน้าละ 3 ป้าย, QR + Code128 เก็บ Location ID (อ่านด้วย /api/scan ได้)
- ขนาดภายในป้ายใช้หน่วย `cqw` ภาพบนจอกับกระดาษจึงเหมือนกัน ป้ายเป็นขาว-ดำตายตัว ไม่ตามธีม
- CSS ตอนพิมพ์อยู่ใน `@media print` ของ styles.css ส่วนที่ไม่ต้องพิมพ์ใส่ `print:hidden`

## เวทมนตร์ (Magic)

- `MagicSky` — ท้องฟ้าดาวจาก React Bits Galaxy (WebGL) ใช้เป็นพื้นหลังหน้าเข้าสู่ระบบ โหลดแยกไฟล์ ปิดเองเมื่อเครื่องตั้งลดการเคลื่อนไหว ไม่มี WebGL หรือ RAM ≤ 2GB
  จอสัมผัสวาดครึ่งความละเอียด (`resolutionScale`) ทุกเครื่องจำกัด 30 เฟรม/วินาที (`maxFps`) สองค่านี้เพิ่มเองใน Galaxy.tsx
  ถ้าใช้ Galaxy ตรงๆ ต้องส่ง prop ที่เป็น array เป็นค่าคงที่ ไม่งั้น WebGL ถูกสร้างใหม่ทุกครั้งที่ render
- `SparkBurst` — ประกายทองจากขอบกล่อง สั่งด้วย `ref.current.burst()` ใช้ตอนสแกนเจอและบันทึกสำเร็จ (กล่องแม่ต้อง `relative`)
  ไม่ใช้ ClickSpark ของ React Bits เพราะ Handheld สแกนด้วย Enter ไม่มีการคลิก

## แหล่งอ้างอิงงานออกแบบ (Bookmark)

เรียกดูได้ด้วยคำสั่ง `/design-refs`

| แหล่ง | ใช้ทำอะไร |
|---|---|
| [React Bits](https://github.com/DavidHDev/react-bits) | แอนิเมชันข้อความ พื้นหลัง micro-interaction สำหรับความรู้สึก "magic" ติดตั้ง: `npx shadcn@latest add @react-bits/<Name>-TS-TW` |
| [shadcn/ui](https://github.com/shadcn-ui/ui) | คอมโพเนนต์พื้นฐาน (ฟอร์ม ตาราง dialog) Radix + Tailwind |
| [Vercel Templates](https://vercel.com/templates) | ตัวอย่างโครงหน้าและ layout |
| [Impeccable](https://github.com/pbakaus/impeccable) | skill ตรวจ/ขัดเกลางานออกแบบ: `/impeccable audit`, `critique`, `polish` ติดตั้ง: `npx impeccable install` |
