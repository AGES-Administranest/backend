-- AlterTable
ALTER TABLE "purchase_invoice_line" ADD COLUMN     "expiration_date" DATE,
ADD COLUMN     "lot_number" TEXT,
ADD COLUMN     "position" INTEGER NOT NULL,
ADD COLUMN     "source_index" INTEGER,
ALTER COLUMN "quantity" DROP NOT NULL,
ALTER COLUMN "unit_cost" DROP NOT NULL;
