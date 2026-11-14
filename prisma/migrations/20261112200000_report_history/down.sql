-- Manual reversal of migration 20261112200000_report_history.
-- Prisma Migrate does not run this file automatically; see
-- prisma/migrations/README.md for the test procedure (up + down).
--
-- Drops the file name, the size and the soft delete of every report: a deleted
-- report shows up again in anything that reads the table.

ALTER TABLE "report" DROP COLUMN "deleted_at",
DROP COLUMN "file_bytes_size",
DROP COLUMN "file_name";

ALTER TABLE "report" ALTER COLUMN "kind" TYPE TEXT USING "kind"::TEXT;

DROP TYPE "report_kind_enum";
