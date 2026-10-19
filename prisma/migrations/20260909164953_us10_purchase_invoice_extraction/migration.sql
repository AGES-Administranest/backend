-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- CreateEnum
CREATE TYPE "purchase_invoice_status_enum" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "extraction_status_enum" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'MANUAL', 'CANCELLED_ORPHAN');

-- CreateEnum
CREATE TYPE "extraction_failure_reason_enum" AS ENUM ('UNREADABLE', 'NO_TABLE_FOUND', 'TIMEOUT', 'UNSUPPORTED_FORMAT');

-- CreateEnum
CREATE TYPE "extraction_job_status_enum" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED');

-- DropIndex
DROP INDEX "purchase_invoice_file_hash_key";

-- AlterTable
ALTER TABLE "purchase_invoice" ADD COLUMN     "corrected_at" TIMESTAMPTZ(6),
ADD COLUMN     "extraction_status" "extraction_status_enum" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "failure_reason" "extraction_failure_reason_enum",
ADD COLUMN     "file_bytes_size" INTEGER,
ADD COLUMN     "file_name" TEXT,
ADD COLUMN     "status" "purchase_invoice_status_enum" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "upload_requested_at" TIMESTAMPTZ(6),
ADD COLUMN     "uploaded_at" TIMESTAMPTZ(6),
ALTER COLUMN "file_url" DROP NOT NULL;

-- AlterTable
ALTER TABLE "purchase_invoice_line" ADD COLUMN     "arithmetic_check" BOOLEAN,
ADD COLUMN     "match_confidence" DECIMAL(4,3),
ADD COLUMN     "total_value" DECIMAL(14,2);

-- CreateTable
CREATE TABLE "extraction_job" (
    "id" UUID NOT NULL,
    "purchase_invoice_id" UUID NOT NULL,
    "status" "extraction_job_status_enum" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "extraction_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "extraction_job_purchase_invoice_id_key" ON "extraction_job"("purchase_invoice_id");

-- CreateIndex
CREATE INDEX "extraction_job_status_created_at_idx" ON "extraction_job"("status", "created_at");

-- CreateIndex
CREATE INDEX "item_name_trgm_idx" ON "item" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "purchase_invoice_extraction_status_upload_requested_at_idx" ON "purchase_invoice"("extraction_status", "upload_requested_at");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoice_user_id_file_hash_key" ON "purchase_invoice"("user_id", "file_hash");

-- AddForeignKey
ALTER TABLE "extraction_job" ADD CONSTRAINT "extraction_job_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

