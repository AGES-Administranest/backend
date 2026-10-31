-- CreateIndex
CREATE INDEX "service_invoice_user_id_client_id_idx" ON "service_invoice"("user_id", "client_id");
