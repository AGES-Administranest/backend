-- CreateEnum
CREATE TYPE "client_type_enum" AS ENUM ('INDIVIDUAL', 'CLINIC');

-- CreateEnum
CREATE TYPE "tax_id_type_enum" AS ENUM ('CPF', 'CNPJ');

-- CreateEnum
CREATE TYPE "weekday_enum" AS ENUM ('MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN');

-- CreateEnum
CREATE TYPE "payment_method_enum" AS ENUM ('CARD', 'BANK_SLIP', 'PIX', 'OTHER');

-- CreateEnum
CREATE TYPE "species_enum" AS ENUM ('CANINE', 'FELINE', 'OTHER');

-- CreateEnum
CREATE TYPE "appointment_status_enum" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "entry_nature_enum" AS ENUM ('INCOME', 'EXPENSE');

-- CreateEnum
CREATE TYPE "entry_scope_enum" AS ENUM ('PROFESSIONAL', 'PERSONAL');

-- CreateEnum
CREATE TYPE "entry_status_enum" AS ENUM ('PENDING', 'SETTLED', 'CANCELED');

-- CreateEnum
CREATE TYPE "entry_source_enum" AS ENUM ('APPOINTMENT', 'SERVICE_INVOICE', 'PURCHASE_INVOICE', 'TRIP', 'MANUAL');

-- CreateEnum
CREATE TYPE "stock_movement_type_enum" AS ENUM ('IN', 'OUT', 'ADJUSTMENT', 'LOSS', 'EXPIRED');

-- CreateEnum
CREATE TYPE "stock_movement_source_enum" AS ENUM ('PURCHASE', 'APPOINTMENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "report_status_enum" AS ENUM ('PENDING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "measurement_unit_enum" AS ENUM ('UNIT', 'AMPOULE', 'VIAL', 'BOX', 'ML', 'MG', 'TABLET', 'OTHER');

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL,
    "cognito_sub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "crmv" TEXT,
    "tax_id" TEXT,
    "tax_id_type" "tax_id_type_enum",
    "birth_date" DATE,
    "photo_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "type" "client_type_enum" NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "tax_id_type" "tax_id_type_enum",
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address_line" TEXT,
    "city" TEXT,
    "state" TEXT,
    "service_days" "weekday_enum"[],
    "payment_terms_days" INTEGER,
    "preferred_payment_method" "payment_method_enum",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID,
    "procedure_name" TEXT,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6),
    "location" TEXT,
    "amount" DECIMAL(14,2),
    "patient_name" TEXT,
    "owner_name" TEXT,
    "species" "species_enum",
    "patient_age_years" INTEGER,
    "weight_kg" DECIMAL(6,3),
    "notes" TEXT,
    "status" "appointment_status_enum" NOT NULL DEFAULT 'SCHEDULED',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "appointment_id" UUID,
    "occurred_on" DATE NOT NULL,
    "distance_km" DECIMAL(10,2),
    "cost" DECIMAL(14,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tax_id" TEXT,
    "tax_id_type" "tax_id_type_enum",
    "contact" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "supplier_id" UUID,
    "unit" "measurement_unit_enum" NOT NULL,
    "name" TEXT NOT NULL,
    "default_unit_cost" DECIMAL(14,4),
    "minimum_stock" DECIMAL(14,3),
    "current_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_lot" (
    "id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_number" TEXT,
    "expiration_date" DATE,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "current_quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "received_on" DATE NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "item_lot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movement" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "lot_id" UUID,
    "type" "stock_movement_type_enum" NOT NULL,
    "source" "stock_movement_source_enum" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "appointment_id" UUID,
    "purchase_invoice_line_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "stock_movement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "equipment" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "supplier_id" UUID,
    "name" TEXT NOT NULL,
    "purchase_value" DECIMAL(14,2) NOT NULL,
    "salvage_value" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "acquisition_date" DATE NOT NULL,
    "useful_life_years" INTEGER NOT NULL,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_invoice" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "client_id" UUID,
    "number" TEXT,
    "issue_date" DATE,
    "amount" DECIMAL(14,2),
    "description" TEXT,
    "file_url" TEXT NOT NULL,
    "file_mime_type" TEXT,
    "file_hash" TEXT,
    "raw_extraction" JSONB,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "service_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "supplier_id" UUID,
    "number" TEXT,
    "issue_date" DATE,
    "total_amount" DECIMAL(14,2),
    "file_url" TEXT NOT NULL,
    "file_mime_type" TEXT,
    "file_hash" TEXT,
    "raw_extraction" JSONB,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "purchase_invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_invoice_line" (
    "id" UUID NOT NULL,
    "purchase_invoice_id" UUID NOT NULL,
    "item_id" UUID,
    "lot_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit_cost" DECIMAL(14,4) NOT NULL,

    CONSTRAINT "purchase_invoice_line_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_category" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "nature" "entry_nature_enum" NOT NULL,
    "default_scope" "entry_scope_enum" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "financial_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_entry" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "nature" "entry_nature_enum" NOT NULL,
    "scope" "entry_scope_enum" NOT NULL,
    "category_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "accrual_date" TIMESTAMPTZ(6) NOT NULL,
    "due_date" DATE,
    "settlement_date" DATE,
    "status" "entry_status_enum" NOT NULL DEFAULT 'PENDING',
    "source" "entry_source_enum" NOT NULL,
    "appointment_id" UUID,
    "service_invoice_id" UUID,
    "purchase_invoice_id" UUID,
    "trip_id" UUID,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "financial_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_settings" (
    "user_id" UUID NOT NULL,
    "monthly_income_goal" DECIMAL(14,2),
    "weekly_hours" DECIMAL(6,2),
    "safety_margin_pct" DECIMAL(6,2),
    "transport_cost_monthly" DECIMAL(14,2),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pricing_settings_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "report" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "period_start" DATE,
    "period_end" DATE,
    "filters" JSONB,
    "file_url" TEXT,
    "status" "report_status_enum" NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_cognito_sub_key" ON "user"("cognito_sub");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "client_user_id_active_idx" ON "client"("user_id", "active");

-- CreateIndex
CREATE INDEX "appointment_user_id_starts_at_idx" ON "appointment"("user_id", "starts_at");

-- CreateIndex
CREATE INDEX "appointment_user_id_status_starts_at_idx" ON "appointment"("user_id", "status", "starts_at");

-- CreateIndex
CREATE INDEX "appointment_user_id_client_id_idx" ON "appointment"("user_id", "client_id");

-- CreateIndex
CREATE INDEX "appointment_patient_name_idx" ON "appointment"("patient_name");

-- CreateIndex
CREATE INDEX "trip_user_id_occurred_on_idx" ON "trip"("user_id", "occurred_on");

-- CreateIndex
CREATE INDEX "supplier_user_id_active_idx" ON "supplier"("user_id", "active");

-- CreateIndex
CREATE INDEX "item_user_id_name_idx" ON "item"("user_id", "name");

-- CreateIndex
CREATE INDEX "item_user_id_active_idx" ON "item"("user_id", "active");

-- CreateIndex
CREATE INDEX "item_lot_item_id_expiration_date_idx" ON "item_lot"("item_id", "expiration_date");

-- CreateIndex
CREATE INDEX "stock_movement_user_id_occurred_at_idx" ON "stock_movement"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movement_item_id_occurred_at_idx" ON "stock_movement"("item_id", "occurred_at");

-- CreateIndex
CREATE INDEX "stock_movement_appointment_id_idx" ON "stock_movement"("appointment_id");

-- CreateIndex
CREATE INDEX "stock_movement_lot_id_idx" ON "stock_movement"("lot_id");

-- CreateIndex
CREATE INDEX "equipment_user_id_active_idx" ON "equipment"("user_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "service_invoice_file_hash_key" ON "service_invoice"("file_hash");

-- CreateIndex
CREATE INDEX "service_invoice_user_id_issue_date_idx" ON "service_invoice"("user_id", "issue_date");

-- CreateIndex
CREATE INDEX "service_invoice_user_id_number_idx" ON "service_invoice"("user_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_invoice_file_hash_key" ON "purchase_invoice"("file_hash");

-- CreateIndex
CREATE INDEX "purchase_invoice_user_id_issue_date_idx" ON "purchase_invoice"("user_id", "issue_date");

-- CreateIndex
CREATE INDEX "purchase_invoice_line_purchase_invoice_id_idx" ON "purchase_invoice_line"("purchase_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_category_user_id_name_key" ON "financial_category"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entry_appointment_id_key" ON "financial_entry"("appointment_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entry_service_invoice_id_key" ON "financial_entry"("service_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entry_purchase_invoice_id_key" ON "financial_entry"("purchase_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "financial_entry_trip_id_key" ON "financial_entry"("trip_id");

-- CreateIndex
CREATE INDEX "financial_entry_user_id_settlement_date_idx" ON "financial_entry"("user_id", "settlement_date");

-- CreateIndex
CREATE INDEX "financial_entry_user_id_accrual_date_idx" ON "financial_entry"("user_id", "accrual_date");

-- CreateIndex
CREATE INDEX "financial_entry_user_id_status_due_date_idx" ON "financial_entry"("user_id", "status", "due_date");

-- CreateIndex
CREATE INDEX "financial_entry_user_id_scope_accrual_date_idx" ON "financial_entry"("user_id", "scope", "accrual_date");

-- CreateIndex
CREATE INDEX "financial_entry_user_id_category_id_idx" ON "financial_entry"("user_id", "category_id");

-- CreateIndex
CREATE INDEX "report_user_id_created_at_idx" ON "report"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "client" ADD CONSTRAINT "client_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment" ADD CONSTRAINT "appointment_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip" ADD CONSTRAINT "trip_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier" ADD CONSTRAINT "supplier_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item" ADD CONSTRAINT "item_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "item_lot" ADD CONSTRAINT "item_lot_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "item_lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movement" ADD CONSTRAINT "stock_movement_purchase_invoice_line_id_fkey" FOREIGN KEY ("purchase_invoice_line_id") REFERENCES "purchase_invoice_line"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "equipment" ADD CONSTRAINT "equipment_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_invoice" ADD CONSTRAINT "service_invoice_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_invoice" ADD CONSTRAINT "service_invoice_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_invoice_line" ADD CONSTRAINT "purchase_invoice_line_lot_id_fkey" FOREIGN KEY ("lot_id") REFERENCES "item_lot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_category" ADD CONSTRAINT "financial_category_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entry" ADD CONSTRAINT "financial_entry_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entry" ADD CONSTRAINT "financial_entry_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "financial_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entry" ADD CONSTRAINT "financial_entry_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entry" ADD CONSTRAINT "financial_entry_service_invoice_id_fkey" FOREIGN KEY ("service_invoice_id") REFERENCES "service_invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entry" ADD CONSTRAINT "financial_entry_purchase_invoice_id_fkey" FOREIGN KEY ("purchase_invoice_id") REFERENCES "purchase_invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_entry" ADD CONSTRAINT "financial_entry_trip_id_fkey" FOREIGN KEY ("trip_id") REFERENCES "trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_settings" ADD CONSTRAINT "pricing_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report" ADD CONSTRAINT "report_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
