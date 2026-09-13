-- Completes the stock_movement origins (US10 / stock traceability).
--
-- - Direction and origin enums redesigned: type is now just INBOUND/OUTBOUND
--   (direction); source gains MANUAL_PURCHASE, ORDER_IMPORT and
--   CORRECTION_REVERSAL.
-- - New reason enum: adjustment_reason_enum (LOSS/EXPIRATION/BREAKAGE/OTHER).
-- - stock_movement: new columns adjustment_reason, purchase_order_id and
--   supplier_id, all indexed; FKs to purchase_order and supplier.
-- - Missing index on stock_movement.purchase_invoice_line_id.
-- - New table purchase_order + enum purchase_order_status_enum.
-- - item.needs_adjustment (bool, default false) — US10 flag.
--
-- Sign convention: quantity is ALWAYS positive; the direction comes from type.
-- "up" reversal available in ./down.sql (see prisma/migrations/README.md).
--
-- Backfill: existing stock_movement rows are remapped to the new enums before
-- the type swap (the CASE in ALTER ... USING), and the adjustment reason is
-- preserved from the old type. Assumed mapping:
--   type:   IN -> INBOUND | OUT -> OUTBOUND | ADJUSTMENT/LOSS/EXPIRED -> OUTBOUND
--   source: PURCHASE -> MANUAL_PURCHASE | APPOINTMENT -> APPOINTMENT
--           MANUAL -> MANUAL_ADJUSTMENT
--   adjustment_reason: LOSS -> LOSS | EXPIRED -> EXPIRATION | ADJUSTMENT -> OTHER
-- ADJUSTMENT was ambiguous (could be an inbound); review manually if there is
-- production data with that value.

-- CreateEnum
CREATE TYPE "adjustment_reason_enum" AS ENUM ('LOSS', 'EXPIRATION', 'BREAKAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "purchase_order_status_enum" AS ENUM ('DRAFT', 'PLACED', 'RECEIVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "stock_movement" ADD COLUMN     "adjustment_reason" "adjustment_reason_enum",
ADD COLUMN     "purchase_order_id" UUID,
ADD COLUMN     "supplier_id" UUID;

-- Backfill adjustment_reason from the old type, before swapping it.
UPDATE "stock_movement"
SET "adjustment_reason" = CASE "type"::text
    WHEN 'LOSS' THEN 'LOSS'::"adjustment_reason_enum"
    WHEN 'EXPIRED' THEN 'EXPIRATION'::"adjustment_reason_enum"
    WHEN 'ADJUSTMENT' THEN 'OTHER'::"adjustment_reason_enum"
  END
WHERE "type"::text IN ('LOSS', 'EXPIRED', 'ADJUSTMENT');

-- Where a reason was set but source was not the adjustment one, align before the swap.
UPDATE "stock_movement"
SET "source" = 'MANUAL'
WHERE "adjustment_reason" IS NOT NULL AND "source"::text <> 'MANUAL';

-- AlterEnum
BEGIN;
CREATE TYPE "stock_movement_type_enum_new" AS ENUM ('INBOUND', 'OUTBOUND');
ALTER TABLE "stock_movement" ALTER COLUMN "type" TYPE "stock_movement_type_enum_new" USING (
  CASE "type"::text
    WHEN 'IN' THEN 'INBOUND'
    WHEN 'OUT' THEN 'OUTBOUND'
    ELSE 'OUTBOUND'
  END::"stock_movement_type_enum_new"
);
ALTER TYPE "stock_movement_type_enum" RENAME TO "stock_movement_type_enum_old";
ALTER TYPE "stock_movement_type_enum_new" RENAME TO "stock_movement_type_enum";
DROP TYPE "stock_movement_type_enum_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "stock_movement_source_enum_new" AS ENUM ('MANUAL_PURCHASE', 'ORDER_IMPORT', 'APPOINTMENT', 'MANUAL_ADJUSTMENT', 'CORRECTION_REVERSAL');
ALTER TABLE "stock_movement" ALTER COLUMN "source" TYPE "stock_movement_source_enum_new" USING (
  CASE "source"::text
    WHEN 'PURCHASE' THEN 'MANUAL_PURCHASE'
    WHEN 'APPOINTMENT' THEN 'APPOINTMENT'
    WHEN 'MANUAL' THEN 'MANUAL_ADJUSTMENT'
    ELSE "source"::text
  END::"stock_movement_source_enum_new"
);
ALTER TYPE "stock_movement_source_enum" RENAME TO "stock_movement_source_enum_old";
ALTER TYPE "stock_movement_source_enum_new" RENAME TO "stock_movement_source_enum";
DROP TYPE "stock_movement_source_enum_old";
COMMIT;

-- AlterTable
ALTER TABLE "item" ADD COLUMN     "needs_adjustment" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "purchase_order" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "supplier_id" UUID,
    "number" TEXT,
    "status" "purchase_order_status_enum" NOT NULL DEFAULT 'DRAFT',
    "order_date" DATE,
    "expected_date" DATE,
    "received_at" TIMESTAMPTZ(6),
    "total_amount" DECIMAL(14,2),
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "purchase_order_user_id_status_idx" ON "purchase_order"("user_id", "status");

-- CreateIndex
CREATE INDEX "purchase_order_supplier_id_idx" ON "purchase_order"("supplier_id");

-- CreateIndex
CREATE INDEX "item_user_id_needs_adjustment_idx" ON "item"("user_id", "needs_adjustment");

-- CreateIndex
CREATE INDEX "stock_movement_purchase_order_id_idx" ON "stock_movement"("purchase_order_id");

-- CreateIndex
CREATE INDEX "stock_movement_purchase_invoice_line_id_idx" ON "stock_movement"("purchase_invoice_line_id");

-- CreateIndex
CREATE INDEX "stock_movement_supplier_id_idx" ON "stock_movement"("supplier_id");

-- CreateIndex
CREATE INDEX "stock_movement_user_id_type_idx" ON "stock_movement"("user_id", "type");

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_purchase_order_id_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
