-- Postgres cannot drop enum values: the type is rebuilt without them, and the
-- items that used them fall back to OTHER.
UPDATE "item" SET "unit" = 'OTHER' WHERE "unit" IN ('LITER', 'MICROGRAM', 'MG_PER_ML', 'MCG_PER_ML');

ALTER TYPE "measurement_unit_enum" RENAME TO "measurement_unit_enum_old";
CREATE TYPE "measurement_unit_enum" AS ENUM ('UNIT', 'AMPOULE', 'VIAL', 'BOX', 'ML', 'MG', 'GRAM', 'TABLET', 'OTHER');
ALTER TABLE "item" ALTER COLUMN "unit" TYPE "measurement_unit_enum" USING "unit"::text::"measurement_unit_enum";
DROP TYPE "measurement_unit_enum_old";
