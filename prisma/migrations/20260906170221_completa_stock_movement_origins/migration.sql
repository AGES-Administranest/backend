-- Completa as origens de stock_movement (US10 / rastreabilidade de estoque).
--
-- - Enums de direção e de origem redesenhados: type passa a ser apenas
--   INBOUND/OUTBOUND (direção); source ganha MANUAL_PURCHASE, ORDER_IMPORT e
--   CORRECTION_REVERSAL.
-- - Novo enum de motivo: adjustment_reason_enum (LOSS/EXPIRATION/BREAKAGE/OTHER).
-- - stock_movement: novas colunas adjustment_reason, purchase_order_id e
--   supplier_id, todas indexadas; FKs para purchase_order e supplier.
-- - Índice que faltava em stock_movement.purchase_invoice_line_id.
-- - Nova tabela purchase_order + enum purchase_order_status_enum.
-- - item.needs_adjustment (bool, default false) — sinalizador da US10.
--
-- Convenção de sinal: quantity é SEMPRE positiva; a direção vem de type.
-- Reversão de "up" disponível em ./down.sql (ver prisma/migrations/README.md).
--
-- Backfill: as linhas existentes de stock_movement são remapeadas para os novos
-- enums antes da troca de tipo (o CASE no ALTER ... USING), e o motivo do ajuste
-- é preservado a partir do type antigo. Mapeamento assumido:
--   type:   IN -> INBOUND | OUT -> OUTBOUND | ADJUSTMENT/LOSS/EXPIRED -> OUTBOUND
--   source: PURCHASE -> MANUAL_PURCHASE | APPOINTMENT -> APPOINTMENT
--           MANUAL -> MANUAL_ADJUSTMENT
--   adjustment_reason: LOSS -> LOSS | EXPIRED -> EXPIRATION | ADJUSTMENT -> OTHER
-- ADJUSTMENT era ambíguo (podia ser entrada); revisar manualmente se houver
-- dados de produção com esse valor.

-- CreateEnum
CREATE TYPE "adjustment_reason_enum" AS ENUM ('LOSS', 'EXPIRATION', 'BREAKAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "purchase_order_status_enum" AS ENUM ('DRAFT', 'PLACED', 'RECEIVED', 'CANCELLED');

-- AlterTable
ALTER TABLE "stock_movement" ADD COLUMN     "adjustment_reason" "adjustment_reason_enum",
ADD COLUMN     "purchase_order_id" UUID,
ADD COLUMN     "supplier_id" UUID;

-- Backfill adjustment_reason a partir do type antigo, antes de trocá-lo.
UPDATE "stock_movement"
SET "adjustment_reason" = CASE "type"::text
    WHEN 'LOSS' THEN 'LOSS'::"adjustment_reason_enum"
    WHEN 'EXPIRED' THEN 'EXPIRATION'::"adjustment_reason_enum"
    WHEN 'ADJUSTMENT' THEN 'OTHER'::"adjustment_reason_enum"
  END
WHERE "type"::text IN ('LOSS', 'EXPIRED', 'ADJUSTMENT');

-- Onde havia motivo mas o source não era o de ajuste, alinhar antes da troca.
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
