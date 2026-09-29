-- AlterTable
ALTER TABLE "stock_movement" ADD COLUMN "client_generated_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "stock_movement_user_id_client_generated_id_key"
ON "stock_movement"("user_id", "client_generated_id");
