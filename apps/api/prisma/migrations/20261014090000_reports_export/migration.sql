-- สิทธิ์ใหม่ reports.export (ส่งออก Excel): ให้ผู้ดูแลระบบที่มีอยู่แล้วเท่านั้น
UPDATE "User" SET "permissions" = array_append("permissions", 'reports.export')
WHERE "roleCode" = 'ADMIN' AND NOT ('reports.export' = ANY("permissions"));
