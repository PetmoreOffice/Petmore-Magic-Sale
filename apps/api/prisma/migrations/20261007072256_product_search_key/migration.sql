-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "searchKey" TEXT NOT NULL DEFAULT '';

-- เติมข้อความค้นให้สินค้าเดิม ต้องตรงกับ searchKey() ใน packages/shared (ตัวพิมพ์เล็ก ตัดช่องว่างและ . , - ( ) ' " / &)
UPDATE "Product" SET "searchKey" = regexp_replace(lower("sku" || ' ' || "name" || ' ' || "brand"), '[[:space:].,()''"/&-]+', '', 'g');
