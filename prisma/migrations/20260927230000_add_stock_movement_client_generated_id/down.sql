-- DropIndex
DROP INDEX "stock_movement_user_id_client_generated_id_key";

-- AlterTable
ALTER TABLE "stock_movement" DROP COLUMN "client_generated_id";
