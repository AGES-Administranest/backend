-- A draft line still missing a value cannot go back under NOT NULL. Only
-- drafts have such lines, and their review restarts from raw_extraction.
DELETE FROM "purchase_invoice_line" WHERE "quantity" IS NULL OR "unit_cost" IS NULL;

-- AlterTable
ALTER TABLE "purchase_invoice_line" DROP COLUMN "expiration_date",
DROP COLUMN "lot_number",
DROP COLUMN "position",
DROP COLUMN "source_index",
ALTER COLUMN "quantity" SET NOT NULL,
ALTER COLUMN "unit_cost" SET NOT NULL;
