DROP INDEX "financial_category_user_id_name_key";

CREATE UNIQUE INDEX "financial_category_user_id_nature_name_key"
  ON "financial_category" ("user_id", "nature", "name");

CREATE UNIQUE INDEX "financial_category_default_nature_name_key"
  ON "financial_category" ("nature", "name")
  WHERE "user_id" IS NULL;

ALTER TABLE "financial_entry"
  ADD CONSTRAINT "financial_entry_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "financial_entry"
  ADD CONSTRAINT "financial_entry_source_origin" CHECK (
    CASE "source"
      WHEN 'MANUAL' THEN
        "appointment_id" IS NULL
        AND "service_invoice_id" IS NULL
        AND "purchase_invoice_id" IS NULL
        AND "trip_id" IS NULL
      WHEN 'APPOINTMENT' THEN
        "appointment_id" IS NOT NULL
        AND "service_invoice_id" IS NULL
        AND "purchase_invoice_id" IS NULL
        AND "trip_id" IS NULL
      WHEN 'SERVICE_INVOICE' THEN
        "service_invoice_id" IS NOT NULL
        AND "appointment_id" IS NULL
        AND "purchase_invoice_id" IS NULL
        AND "trip_id" IS NULL
      WHEN 'PURCHASE_INVOICE' THEN
        "purchase_invoice_id" IS NOT NULL
        AND "appointment_id" IS NULL
        AND "service_invoice_id" IS NULL
        AND "trip_id" IS NULL
      WHEN 'TRIP' THEN
        "trip_id" IS NOT NULL
        AND "appointment_id" IS NULL
        AND "service_invoice_id" IS NULL
        AND "purchase_invoice_id" IS NULL
      ELSE FALSE
    END
  );

CREATE INDEX "financial_entry_user_id_nature_scope_idx"
  ON "financial_entry" ("user_id", "nature", "scope");
