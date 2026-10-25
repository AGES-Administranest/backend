-- The owner of a user category was ON DELETE SET NULL only because that is
-- Prisma's default for an optional relation. Deleting a user then turned their
-- categories into system defaults (user_id NULL) that every other user sees.
-- RESTRICT matches every other relation to "user".

-- DropForeignKey
ALTER TABLE "financial_category" DROP CONSTRAINT "financial_category_user_id_fkey";

-- AddForeignKey
ALTER TABLE "financial_category" ADD CONSTRAINT "financial_category_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
