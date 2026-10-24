-- Manual reversal of migration 20261019180000_us01_service_invoice_extraction.
-- Prisma Migrate does not run this file automatically; see
-- prisma/migrations/README.md for the test procedure (up + down).
--
-- Destroys every NFSe draft that has no file yet: disposable environments only.

-- DropIndex
DROP INDEX "service_invoice_user_id_issue_date_amount_idx";

-- DropIndex
DROP INDEX "service_invoice_user_id_file_hash_key";

-- A draft born before its upload has no key and cannot go back under NOT NULL.
DELETE FROM "service_invoice" WHERE "file_url" IS NULL;

-- AlterTable
-- failure_reason goes before the enum below, which cannot be swapped while a
-- column of service_invoice still uses it.
ALTER TABLE "service_invoice" DROP COLUMN "extraction_status",
DROP COLUMN "failure_reason",
DROP COLUMN "file_bytes_size",
DROP COLUMN "file_name",
DROP COLUMN "status",
DROP COLUMN "taker_tax_id",
DROP COLUMN "upload_requested_at",
DROP COLUMN "uploaded_at",
ALTER COLUMN "file_url" SET NOT NULL;

-- DropEnum
DROP TYPE "service_invoice_status_enum";

-- AlterEnum
BEGIN;
-- The cast below fails on a row that uses the value. Purchase orders never
-- get it; this only guards the cast.
UPDATE "purchase_invoice" SET "failure_reason" = 'UNREADABLE' WHERE "failure_reason" = 'NO_FIELDS_FOUND';
CREATE TYPE "extraction_failure_reason_enum_new" AS ENUM ('UNREADABLE', 'NO_TABLE_FOUND', 'TIMEOUT', 'UNSUPPORTED_FORMAT', 'NO_TEXT_LAYER');
ALTER TABLE "purchase_invoice" ALTER COLUMN "failure_reason" TYPE "extraction_failure_reason_enum_new" USING ("failure_reason"::text::"extraction_failure_reason_enum_new");
ALTER TYPE "extraction_failure_reason_enum" RENAME TO "extraction_failure_reason_enum_old";
ALTER TYPE "extraction_failure_reason_enum_new" RENAME TO "extraction_failure_reason_enum";
DROP TYPE "extraction_failure_reason_enum_old";
COMMIT;

-- CreateIndex
-- Fails if two users stored the same file, which the new unique allowed.
CREATE UNIQUE INDEX "service_invoice_file_hash_key" ON "service_invoice"("file_hash");

-- CreateIndex
CREATE INDEX "service_invoice_user_id_issue_date_idx" ON "service_invoice"("user_id", "issue_date");
