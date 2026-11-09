ALTER TABLE "supplier" ADD COLUMN "notes" TEXT;

UPDATE "supplier"
SET "tax_id" = upper(regexp_replace("tax_id", '[^A-Za-z0-9]', '', 'g'))
WHERE "tax_id" IS NOT NULL;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "supplier"
        WHERE "deleted_at" IS NULL AND "tax_id" IS NOT NULL
        GROUP BY "user_id", "tax_id"
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate supplier CNPJs exist after normalization; resolve them before applying this migration';
    END IF;
END $$;

CREATE UNIQUE INDEX "supplier_user_id_tax_id_key"
ON "supplier"("user_id", "tax_id")
WHERE ("deleted_at" IS NULL AND "tax_id" IS NOT NULL);