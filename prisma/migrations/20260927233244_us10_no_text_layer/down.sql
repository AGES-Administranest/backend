-- AlterEnum
BEGIN;
-- The cast below fails on a row that uses the value; before it existed, a scan
-- was reported as unreadable.
UPDATE "purchase_invoice" SET "failure_reason" = 'UNREADABLE' WHERE "failure_reason" = 'NO_TEXT_LAYER';
CREATE TYPE "extraction_failure_reason_enum_new" AS ENUM ('UNREADABLE', 'NO_TABLE_FOUND', 'TIMEOUT', 'UNSUPPORTED_FORMAT');
ALTER TABLE "purchase_invoice" ALTER COLUMN "failure_reason" TYPE "extraction_failure_reason_enum_new" USING ("failure_reason"::text::"extraction_failure_reason_enum_new");
ALTER TYPE "extraction_failure_reason_enum" RENAME TO "extraction_failure_reason_enum_old";
ALTER TYPE "extraction_failure_reason_enum_new" RENAME TO "extraction_failure_reason_enum";
DROP TYPE "extraction_failure_reason_enum_old";
COMMIT;

