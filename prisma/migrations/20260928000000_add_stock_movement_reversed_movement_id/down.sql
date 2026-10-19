-- DropForeignKey
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_replaced_movement_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_movement" DROP CONSTRAINT "stock_movement_reversed_movement_id_fkey";

-- DropIndex
DROP INDEX "stock_movement_replaced_movement_id_key";

-- DropIndex
DROP INDEX "stock_movement_reversed_movement_id_key";

-- AlterTable
ALTER TABLE "stock_movement" DROP COLUMN "replaced_movement_id",
DROP COLUMN "reversed_movement_id";
