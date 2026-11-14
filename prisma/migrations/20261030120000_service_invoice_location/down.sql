-- Manual reversal of migration 20261030120000_service_invoice_location.
-- Prisma Migrate does not run this file automatically; see
-- prisma/migrations/README.md for the test procedure (up + down).
--
-- Drops the column: the locations typed or filled in are lost.

-- AlterTable
ALTER TABLE "service_invoice" DROP COLUMN "location";
