-- Manual reversal of migration 20261019180100_drop_extraction_job.
-- Prisma Migrate does not run this file automatically; see
-- prisma/migrations/README.md for the test procedure (up + down).
--
-- Recreates the table empty, as US10 created it (20260909164953).

-- CreateEnum
CREATE TYPE "extraction_job_status_enum" AS ENUM ('QUEUED', 'PROCESSING', 'DONE', 'FAILED');

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

-- AddForeignKey
ALTER TABLE "extraction_job" ADD CONSTRAINT "extraction_job_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
