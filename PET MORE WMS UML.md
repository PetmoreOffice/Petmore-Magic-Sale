OMS (gs.) · Google Apps Script Web App

# PET MORE WMS — แผนภาพ UML

สรุปจากไฟล์ `OMS (gs.).txt` (หน้าเว็บ HTML ฝั่ง client \~3,200 บรรทัด) ที่เรียกฟังก์ชันฝั่งเซิร์ฟเวอร์ 32 ตัวผ่าน `google.script.run`

[ภาพรวมระบบ](#overview) [Use Case](#usecase) [Class Diagram](#class) [Sequence: Login](#seq-login) [Sequence: รับสินค้า](#seq-receive) [Sequence: ย้าย Location](#seq-move) [State: หน้าจอ](#state) [ตาราง API](#api)

ไฟล์นี้มีเฉพาะโค้ดฝั่งหน้าเว็บ (Index.html) ส่วนโค้ด `.gs` ฝั่งเซิร์ฟเวอร์ไม่ได้อยู่ในไฟล์ แผนภาพฝั่งเซิร์ฟเวอร์และโครงสร้างข้อมูลจึงอนุมานจาก payload ที่หน้าเว็บส่งและรับ ส่วนชื่อชีตจริงใน Google Sheets ไม่ปรากฏในไฟล์

Component Diagram

## ภาพรวมสถาปัตยกรรม

หน้าเว็บเป็น Single Page App ที่สลับ panel 21 หน้าจอ ทุกคำสั่งผ่านตัวช่วย `call(fn, token, …)` และก่อนทุก action จะตรวจ session ซ้ำ (`refreshIdentity`) รวมทั้งตรวจสิทธิ์ทุก 60 วินาที

```mermaid
flowchart LR
  subgraph Browser["เบราว์เซอร์ (Index.html)"]
    UI["SPA · 21 panelsscreen(name)"]
    Auth["SessionsessionStorage token · หมดอายุ 12 ชม."]
    Call["call(fn, ...args)Promise wrapper"]
    Libs["ไลบรารีฝังในไฟล์SheetJS · JsBarcode · qrcode"]
    LS["localStorageงานนำเข้าสินค้าค้าง"]
  end
  subgraph GAS["Google Apps Script (.gs — ไม่อยู่ในไฟล์)"]
    API["Server functions ×32"]
    Perm["ตรวจ token + permission+ warehouseScope"]
    Idem["IdempotencyrequestId + revision"]
  end
  Sheets[("Google Sheetsข้อมูล WMS")]
  UI --> Call
  Auth --> Call
  UI --> Libs
  UI --> LS
  Call -- "google.script.run" --> API
  API --> Perm --> Idem --> Sheets
  
```

Use Case Diagram

## ผู้ใช้และสิ่งที่ทำได้ตามสิทธิ์

สิทธิ์เป็นรายข้อ (permission keys) ไม่ผูกกับตำแหน่งตายตัว ตำแหน่ง (role) ใช้เป็นแค่ค่าเริ่มต้น เช่น `WH`

receive.viewreceive.createreceive.print stock.viewstock.printmove.viewmove.create products.managelocations.viewlocations.editlocations.print locations.manageusers.viewusers.manageusers.audit

```mermaid
flowchart LR
  Setup(["ผู้ติดตั้งระบบ"])
  Staff(["พนักงานคลัง"])
  Admin(["ผู้จัดการ / Admin"])
  subgraph WMS["PET MORE WMS"]
    UC0(["สร้างบัญชีผู้จัดการคนแรก"])
    UC1(["เข้าสู่ระบบ / ออกจากระบบ"])
    UC2(["รับสินค้า RECEIVE / OPENING"])
    UC3(["พิมพ์ใบรับสินค้า"])
    UC4(["ดูสต็อก · Movement"])
    UC5(["ย้าย Location"])
    UC6(["จัดการทะเบียนสินค้า"])
    UC7(["นำเข้าสินค้าจาก Excel"])
    UC8(["จัดการโซน / Location"])
    UC9(["พิมพ์ป้าย LocationQR + Barcode"])
    UC10(["จัดการทะเบียนคลัง"])
    UC11(["จัดการผู้ใช้และสิทธิ์"])
    UC12(["ดูประวัติการแก้ไข"])
  end
  Setup --> UC0
  Staff --> UC1
  Staff --> UC2
  Staff --> UC3
  Staff --> UC4
  Staff --> UC5
  Staff --> UC9
  Admin --> UC1
  Admin --> UC6
  Admin --> UC7
  Admin --> UC8
  Admin --> UC10
  Admin --> UC11
  Admin --> UC12
  UC7 -. "include" .-> UC6
  UC9 -. "extend" .-> UC8
  
```

Class Diagram

## โครงสร้างข้อมูล (Domain Model)

ทุก entity ที่แก้ไขได้มี `revision` สำหรับกันการบันทึกทับกัน และทุกคำสั่งเขียนแนบ `requestId` (UUID) เพื่อกันกดซ้ำ

```mermaid
classDiagram
  direction LR
  class User {
    +string username
    +string displayName
    +string roleCode
    +string role
    +bool active
    +string[] permissions
    +WarehouseScope warehouseScope
    +int revision
  }
  class WarehouseScope {
    +bool all
    +string[] codes
  }
  class Session {
    +string token
    +bool valid
    +number expiresAt
    +string version
    +string system
  }
  class AccessCatalog {
    +map roles
    +PermissionGroup[] groups
    +map defaults
  }
  class Warehouse {
    +string code
    +string name
    +WarehouseKind kind
    +bool active
    +int revision
  }
  class WarehouseKind {
    <<enumeration>>
    WAREHOUSE
    BACKROOM
    STOREFRONT
  }
  class Zone {
    +string id
    +string warehouse
    +string code
    +string name
    +bool active
    +int revision
  }
  class Location {
    +string id
    +string warehouse
    +string zoneId
    +string code
    +string name
    +bool active
    +int revision
  }
  class Product {
    +string id (SKU)
    +string name
    +string barcode
    +string unit
    +bool active
    +bool expiryRequired
    +int revision
  }
  class Receipt {
    +string id
    +ReceiptKind kind
    +string warehouse
    +date date
    +string reference
    +string poNumber
    +string source
    +string note
    +string requestId
  }
  class ReceiptKind {
    <<enumeration>>
    RECEIVE
    OPENING
  }
  class ReceiptLine {
    +string sku
    +string locationId
    +number qty
    +string lot
    +date expiry
    +StockStatus status
  }
  class StockStatus {
    <<enumeration>>
    FG สินค้าปกติ
    DM เสียหาย/รอตรวจ
  }
  class StockRow {
    +string warehouse
    +string sku
    +string locationId
    +string locationCode
    +string lot
    +date expiry
    +StockStatus status
    +number qty
  }
  class Move {
    +string id
    +string warehouse
    +string sourceKey
    +string destinationId
    +number qty
    +string note
    +string actor
    +datetime time
  }
  class StockMovement {
    +string id
    +string kind
    +int line
    +string sku
    +number qty
    +string actor
    +datetime time
  }
  class LabelBatch {
    +string id
    +string requestId
    +string actor
    +datetime time
    +string[] locationIds
  }
  class AuditEntry {
    +string id
    +string actor
    +datetime time
    +object before
    +object after
  }

  User "1" *-- "1" WarehouseScope
  User "1" --> "0..*" Session : login
  User ..> AccessCatalog : permissions จาก
  WarehouseScope "0..*" --> "0..*" Warehouse : codes
  Warehouse --> WarehouseKind
  Warehouse "1" *-- "0..*" Zone
  Zone "1" *-- "0..*" Location
  Receipt "1" *-- "1..50" ReceiptLine
  Receipt --> ReceiptKind
  Receipt "0..*" --> "1" Warehouse
  ReceiptLine "0..*" --> "1" Product
  ReceiptLine "0..*" --> "1" Location
  ReceiptLine --> StockStatus
  StockRow "0..*" --> "1" Product
  StockRow "0..*" --> "1" Location
  StockRow --> StockStatus
  Move "0..*" --> "1" StockRow : ต้นทาง
  Move "0..*" --> "1" Location : ปลายทาง
  StockMovement ..> Receipt : RECEIVE/OPENING
  StockMovement ..> Move : MOVE
  LabelBatch "0..*" --> "1..*" Location
  AuditEntry ..> User
  AuditEntry ..> Product
  AuditEntry ..> Zone
  AuditEntry ..> Location
  
```

Sequence Diagram

## เข้าสู่ระบบและตรวจสิทธิ์ต่อเนื่อง

```mermaid
sequenceDiagram
  autonumber
  actor U as ผู้ใช้
  participant P as หน้าเว็บ (SPA)
  participant S as sessionStorage
  participant G as Apps Script
  U->>P: เปิด URL
  P->>S: readToken()
  alt มี token เดิม
    P->>G: getSession(token)
    G-->>P: {valid, user, expiresAt, version}
  else ไม่มี token
    P-->>U: แสดงฟอร์ม Login
    U->>P: username + password
    P->>G: login(username, password)
    G-->>P: {token, user, expiresAt, version, system}
    P->>P: checkVersion() ต้องตรง CONFIG
    P->>S: remember(token)
  end
  P->>G: getAccessCatalog(token)
  G-->>P: roles, groups, defaults
  P->>P: renderAccess() ซ่อน/แสดงเมนูตาม permission
  loop ทุก 60 วินาที และเมื่อกลับมาที่แท็บ
    P->>G: getSession(token)
    G-->>P: สิทธิ์ล่าสุด
    P->>P: renderAccess() ถ้าสิทธิ์ถูกถอน เด้งกลับเมนูหลัก
  end
  Note over P: setTimeout ครบ expiresAt (12 ชม.) → ล้าง token แล้วกลับหน้า Login
  
```

Sequence Diagram

## รับสินค้าเข้าคลัง (postReceipt)

```mermaid
sequenceDiagram
  autonumber
  actor U as พนักงานคลัง
  participant P as หน้าเว็บ
  participant G as Apps Script
  participant D as Google Sheets
  U->>P: + สร้างใบรับสินค้า
  P->>G: getSession(token)
  P->>G: getReceivingSetup(token)
  G-->>P: warehouses, zones, locations, products
  loop เพิ่มได้สูงสุด 50 รายการ
    U->>P: สแกน SKU/บาร์โค้ด · Location · qty · lot · expiry · FG/DM
    P->>P: addReceiptLine() ตรวจวันหมดอายุถ้า expiryRequired
  end
  U->>P: บันทึก (ยืนยันในกล่อง confirm)
  P->>P: สร้าง requestId (UUID) ครั้งเดียวต่อข้อมูลชุดเดิม
  P->>G: postReceipt(token, {warehouse, kind, date, reference, poNumber, source, note, lines, requestId})
  G->>D: ตรวจสิทธิ์ receive.create + warehouseScope
  G->>D: บันทึกใบรับ + เพิ่มยอดสต็อก + บันทึก Movement
  G-->>P: {receipt}
  P-->>U: showReceipt() แสดงใบรับ
  opt มีสิทธิ์ receive.print
    U->>P: พิมพ์ / บันทึก PDF
    P->>G: getReceipt(token, id, true)
    P->>P: window.print()
  end
  
```

Sequence Diagram

## ย้าย Location ภายในคลัง (postMove)

```mermaid
sequenceDiagram
  autonumber
  actor U as พนักงานคลัง
  participant P as หน้าเว็บ
  participant G as Apps Script
  U->>P: ย้ายสินค้า
  P->>G: getMoveSetup(token)
  G-->>P: stock[], locations[]
  U->>P: เลือกสต็อกต้นทาง (SKU / ล็อต / Location / สถานะ)
  P->>P: moveKey() = [warehouse, sku, locationId, lot, expiry, status]
  U->>P: เลือกปลายทาง + จำนวน (0 < qty ≤ คงเหลือ)
  P->>G: postMove(token, {warehouse, sourceKey, destinationId, qty, note, requestId})
  G-->>P: Move record
  P-->>U: showMove() รายละเอียดการย้าย
  
```

State Diagram

## การเปลี่ยนหน้าจอ

ทุกการเปลี่ยนหน้าผ่าน `navigate()` ซึ่งถามก่อนออกถ้าฟอร์มยังไม่บันทึก (`formDirty`)

```mermaid
stateDiagram-v2
  [*] --> Login
  Login --> menu : login สำเร็จ
  menu --> receipts
  receipts --> receiveEditor : + สร้างใบรับ
  receiveEditor --> receiptDetail : postReceipt
  receipts --> receiptDetail : เปิด
  menu --> stock
  stock --> movement : Movement
  menu --> moves
  moves --> moveEditor
  moveEditor --> moveDetail : postMove
  menu --> products
  products --> productEditor
  products --> productImport
  menu --> storage
  storage --> storageEditor
  storage --> labels : เตรียมป้าย
  storage --> storageHistory
  menu --> warehouses
  menu --> users
  users --> editor
  menu --> audit
  menu --> account
  menu --> Login : logout / หมดอายุ
  
```

Server API

## ฟังก์ชันฝั่งเซิร์ฟเวอร์ที่หน้าเว็บเรียก (32 ตัว)

| โมดูล | ฟังก์ชัน | สิทธิ์ที่เกี่ยวข้อง |
| --- | --- | --- |
| Auth | `createManager` `login` `logout` `getSession` `getAccessCatalog` | — |
| ผู้ใช้ | `listUsers` `saveUser` `getUserAudit` `getWarehouseChoices` | users.view · users.manage · users.audit |
| คลัง | `listWarehouseRegistry` `saveWarehouse` | locations.manage |
| โซน / Location | `getStorageWorkspace` `saveStorageEntry` `deleteStorageEntry` `getStorageAudit` | locations.view · locations.edit |
| ป้าย | `prepareLocationLabels` `getLocationPrintHistory` | locations.print |
| สินค้า | `getProducts` `saveProduct` `setProductExpiryBulk` `previewProductImport` `commitProductImport` | products.manage |
| รับสินค้า | `getReceivingSetup` `postReceipt` `listReceipts` `getReceipt` | receive.view · receive.create · receive.print |
| สต็อก | `getStock` `getStockMovement` | stock.view · stock.print |
| ย้าย Location | `getMoveSetup` `postMove` `listMoveHistory` `getMove` | move.view · move.create |