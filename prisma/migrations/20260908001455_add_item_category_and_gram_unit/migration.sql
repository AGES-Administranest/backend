

CREATE TYPE "item_category_enum" AS ENUM ('MEDICATION', 'ANESTHETIC', 'DISPOSABLE', 'OTHER');

ALTER TYPE "measurement_unit_enum" ADD VALUE 'GRAM';

ALTER TABLE "item" ADD COLUMN     "category" "item_category_enum" NOT NULL;
