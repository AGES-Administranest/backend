-- CreateEnum
CREATE TYPE "service_invoice_status_enum" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "extraction_failure_reason_enum" ADD VALUE 'NO_FIELDS_FOUND';

-- DropIndex
DROP INDEX "service_invoice_file_hash_key";

-- DropIndex
DROP INDEX "service_invoice_user_id_issue_date_idx";

-- AlterTable
ALTER TABLE "service_invoice" ADD COLUMN     "extraction_status" "extraction_status_enum" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "failure_reason" "extraction_failure_reason_enum",
ADD COLUMN     "file_bytes_size" INTEGER,
ADD COLUMN     "file_name" TEXT,
ADD COLUMN     "status" "service_invoice_status_enum" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "taker_tax_id" VARCHAR(14),
ADD COLUMN     "upload_requested_at" TIMESTAMPTZ(6),
ADD COLUMN     "uploaded_at" TIMESTAMPTZ(6),
ALTER COLUMN "file_url" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "service_invoice_user_id_issue_date_amount_idx" ON "service_invoice"("user_id", "issue_date", "amount");

-- CreateIndex
CREATE UNIQUE INDEX "service_invoice_user_id_file_hash_key" ON "service_invoice"("user_id", "file_hash");
