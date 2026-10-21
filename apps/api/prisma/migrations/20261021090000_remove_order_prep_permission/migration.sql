-- เลิกใช้หน้าจัดสินค้า (2026-10-21): เอาสิทธิ์ picks.prepare ออกจากทุกคน ผู้ใช้ตำแหน่งคนจัดสินค้า (ถ้ามี) กลับเป็นผู้เบิกสินค้า
-- คอลัมน์ prep* ใน SalesOrder ยังเก็บไว้ (ข้อมูลเดิมไม่หาย) แต่แอปไม่อ่าน/เขียนแล้ว
UPDATE "User" SET "permissions" = array_remove("permissions", 'picks.prepare') WHERE 'picks.prepare' = ANY("permissions");
UPDATE "User" SET "roleCode" = 'PICKER' WHERE "roleCode" = 'PACKER';
