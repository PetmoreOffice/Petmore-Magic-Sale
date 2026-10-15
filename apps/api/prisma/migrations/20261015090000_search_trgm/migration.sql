-- ค้นสินค้าแบบ "มีคำนี้ตรงไหนก็ได้" (LIKE '%คำ%') ให้ใช้ index ได้ ไม่ต้องไล่ทั้งตาราง (ทดสอบโหลด 2026-10-15)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Product_searchKey_idx" ON "Product" USING GIN ("searchKey" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ProductPack_code_idx" ON "ProductPack" USING GIN ("code" gin_trgm_ops);
