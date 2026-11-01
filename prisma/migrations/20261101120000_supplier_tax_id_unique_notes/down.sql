DROP INDEX "supplier_user_id_tax_id_key";

ALTER TABLE "supplier" DROP COLUMN "notes";

-- Normalized tax_id values cannot be restored to their original formatting.