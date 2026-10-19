-- AlterTable
ALTER TABLE "appointment" ADD COLUMN "client_generated_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "appointment_user_id_client_generated_id_key"
ON "appointment"("user_id", "client_generated_id");