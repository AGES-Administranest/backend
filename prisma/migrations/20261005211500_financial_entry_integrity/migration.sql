DROP INDEX "financial_category_user_id_name_key";

CREATE UNIQUE INDEX "financial_category_user_id_nature_name_key"
  ON "financial_category" ("user_id", "nature", "name");

CREATE UNIQUE INDEX "financial_category_default_nature_name_key"
  ON "financial_category" ("nature", "name")
  WHERE "user_id" IS NULL;

DROP INDEX "financial_entry_appointment_id_key";
DROP INDEX "financial_entry_service_invoice_id_key";
DROP INDEX "financial_entry_purchase_invoice_id_key";
DROP INDEX "financial_entry_trip_id_key";

CREATE UNIQUE INDEX "financial_entry_appointment_id_key"
  ON "financial_entry" ("appointment_id")
  WHERE "appointment_id" IS NOT NULL;

CREATE UNIQUE INDEX "financial_entry_service_invoice_id_key"
  ON "financial_entry" ("service_invoice_id")
  WHERE "service_invoice_id" IS NOT NULL;

CREATE UNIQUE INDEX "financial_entry_purchase_invoice_id_key"
  ON "financial_entry" ("purchase_invoice_id")
  WHERE "purchase_invoice_id" IS NOT NULL;

CREATE UNIQUE INDEX "financial_entry_trip_id_key"
  ON "financial_entry" ("trip_id")
  WHERE "trip_id" IS NOT NULL;

ALTER TABLE "financial_entry"
  ADD CONSTRAINT "financial_entry_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "financial_entry"
  ADD CONSTRAINT "financial_entry_source_origin" CHECK (
    (
      (CASE WHEN "appointment_id" IS NULL THEN 0 ELSE 1 END) +
      (CASE WHEN "service_invoice_id" IS NULL THEN 0 ELSE 1 END) +
      (CASE WHEN "purchase_invoice_id" IS NULL THEN 0 ELSE 1 END) +
      (CASE WHEN "trip_id" IS NULL THEN 0 ELSE 1 END)
    ) = CASE WHEN "source" = 'MANUAL' THEN 0 ELSE 1 END
  );

CREATE INDEX "financial_entry_user_id_nature_scope_idx"
  ON "financial_entry" ("user_id", "nature", "scope");
