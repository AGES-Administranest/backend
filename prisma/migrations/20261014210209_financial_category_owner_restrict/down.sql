-- Manual reversal of migration 20261014210209_financial_category_owner_restrict.
-- Prisma Migrate does not run this file automatically; see
-- prisma/migrations/README.md for the test procedure (up + down).

-- DropForeignKey
ALTER TABLE "financial_category" DROP CONSTRAINT "financial_category_user_id_fkey";

-- AddForeignKey
ALTER TABLE "financial_category" ADD CONSTRAINT "financial_category_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
