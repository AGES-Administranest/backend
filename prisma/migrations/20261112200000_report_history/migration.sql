-- US32: the history of generated reports and packages. The table exists since
-- the init migration and no released code has written to it, so it is changed
-- in place.
--
-- `kind` becomes an enum. The cast keeps every row: a value outside the enum
-- makes the migration fail instead of being dropped, which is what Prisma's
-- generated DROP + ADD COLUMN would do.

-- CreateEnum
CREATE TYPE "report_kind_enum" AS ENUM ('GENERAL_REPORT', 'TAX_PACKAGE');

-- AlterTable
ALTER TABLE "report"
  ALTER COLUMN "kind" TYPE "report_kind_enum" USING "kind"::"report_kind_enum";

-- The name and size of the file, for the history list, and the soft delete.
-- All nullable: ReportArchiveService fills the name and the size from the first
-- write, but the recording of US28 (#92) does not yet, so a CHECK that a DONE
-- row has them comes with that change. A deleted report keeps its row and key.
ALTER TABLE "report" ADD COLUMN     "file_name" TEXT,
ADD COLUMN     "file_bytes_size" INTEGER,
ADD COLUMN     "deleted_at" TIMESTAMPTZ(6);
