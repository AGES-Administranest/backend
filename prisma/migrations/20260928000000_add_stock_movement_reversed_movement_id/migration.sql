-- AlterTable
ALTER TABLE "stock_movement" ADD COLUMN "reversed_movement_id" UUID,
ADD COLUMN "replaced_movement_id" UUID;

-- Backfill: reversals written before this column existed name the original
-- only in notes ("Reversal of stock movement <id>"). Should two of them name
-- the same original, only one is linked, so the unique index below holds.
UPDATE "stock_movement" AS "reversal"
SET "reversed_movement_id" = substring("reversal"."notes" FROM '^Reversal of stock movement ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::UUID
WHERE "reversal"."source" = 'CORRECTION_REVERSAL'
  AND "reversal"."notes" ~ '^Reversal of stock movement [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND EXISTS (
    SELECT 1
    FROM "stock_movement" AS "original"
    WHERE "original"."id" = substring("reversal"."notes" FROM '^Reversal of stock movement ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')::UUID
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "stock_movement" AS "earlier"
    WHERE "earlier"."source" = 'CORRECTION_REVERSAL'
      AND "earlier"."notes" = "reversal"."notes"
      AND ("earlier"."created_at", "earlier"."id") < ("reversal"."created_at", "reversal"."id")
  );

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_reversed_movement_id_key" ON "stock_movement"("reversed_movement_id");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_replaced_movement_id_key" ON "stock_movement"("replaced_movement_id");

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_reversed_movement_id_fkey" FOREIGN KEY ("reversed_movement_id") REFERENCES "stock_movement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_replaced_movement_id_fkey" FOREIGN KEY ("replaced_movement_id") REFERENCES "stock_movement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
