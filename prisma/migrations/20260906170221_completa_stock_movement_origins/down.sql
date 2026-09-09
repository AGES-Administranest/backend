-- Manual reversal of migration 20260906170221_completa_stock_movement_origins.
-- Prisma Migrate does not run this file automatically; see
-- prisma/migrations/README.md for the test procedure (up + down).
--
-- Restores the old stock_movement enums and drops purchase_order,
-- item.needs_adjustment and the new columns/indexes/FKs.
--
-- The reversal is PARTIALLY LOSSY:
--   - type: uses adjustment_reason to restore LOSS/EXPIRED/ADJUSTMENT;
--     everything else becomes IN/OUT according to INBOUND/OUTBOUND.
--   - source: ORDER_IMPORT and CORRECTION_REVERSAL did not exist before and
--     collapse into MANUAL. MANUAL_PURCHASE goes back to PURCHASE,
--     MANUAL_ADJUSTMENT to MANUAL.

-- AlterEnum: type (uses adjustment_reason before the column is removed)
BEGIN;
CREATE TYPE "stock_movement_type_enum_new" AS ENUM ('IN', 'OUT', 'ADJUSTMENT', 'LOSS', 'EXPIRED');
ALTER TABLE "stock_movement" ALTER COLUMN "type" TYPE "stock_movement_type_enum_new" USING (
  CASE
    WHEN "adjustment_reason"::text = 'LOSS' THEN 'LOSS'
    WHEN "adjustment_reason"::text = 'EXPIRATION' THEN 'EXPIRED'
    WHEN "adjustment_reason"::text = 'OTHER' THEN 'ADJUSTMENT'
    WHEN "type"::text = 'INBOUND' THEN 'IN'
    ELSE 'OUT'
  END::"stock_movement_type_enum_new"
);
ALTER TYPE "stock_movement_type_enum" RENAME TO "stock_movement_type_enum_old";
ALTER TYPE "stock_movement_type_enum_new" RENAME TO "stock_movement_type_enum";
DROP TYPE "stock_movement_type_enum_old";
COMMIT;

-- AlterEnum: source
BEGIN;
CREATE TYPE "stock_movement_source_enum_new" AS ENUM ('PURCHASE', 'APPOINTMENT', 'MANUAL');
ALTER TABLE "stock_movement" ALTER COLUMN "source" TYPE "stock_movement_source_enum_new" USING (
  CASE "source"::text
    WHEN 'MANUAL_PURCHASE' THEN 'PURCHASE'
    WHEN 'APPOINTMENT' THEN 'APPOINTMENT'
    WHEN 'MANUAL_ADJUSTMENT' THEN 'MANUAL'
    ELSE 'MANUAL'
  END::"stock_movement_source_enum_new"
);
ALTER TYPE "stock_movement_source_enum" RENAME TO "stock_movement_source_enum_old";
ALTER TYPE "stock_movement_source_enum_new" RENAME TO "stock_movement_source_enum";
DROP TYPE "stock_movement_source_enum_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_purchase_order_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_supplier_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_order" DROP CONSTRAINT "purchase_order_user_id_fkey";

-- DropForeignKey
ALTER TABLE "purchase_order" DROP CONSTRAINT "purchase_order_supplier_id_fkey";

-- DropIndex
DROP INDEX "item_user_id_needs_adjustment_idx";

-- DropIndex
DROP INDEX "stock_movement_purchase_order_id_idx";

-- DropIndex
DROP INDEX "stock_movement_purchase_invoice_line_id_idx";

-- DropIndex
DROP INDEX "stock_movement_supplier_id_idx";

-- DropIndex
DROP INDEX "stock_movement_user_id_type_idx";

-- AlterTable
ALTER TABLE "item" DROP COLUMN "needs_adjustment";

-- AlterTable
ALTER TABLE "stock_movement" DROP COLUMN "adjustment_reason",
DROP COLUMN "purchase_order_id",
DROP COLUMN "supplier_id";

-- DropTable
DROP TABLE "purchase_order";

-- DropEnum
DROP TYPE "adjustment_reason_enum";

-- DropEnum
DROP TYPE "purchase_order_status_enum";
