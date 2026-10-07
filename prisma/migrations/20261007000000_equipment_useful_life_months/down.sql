-- Manual reversal of the equipment useful-life migration.
-- Existing null values are assigned the previous default of 10 years.
ALTER TABLE "equipment"
  ADD COLUMN "useful_life_years" integer;

UPDATE "equipment"
SET "useful_life_years" = CASE
  WHEN "useful_life_months" IS NULL THEN 10
  ELSE CEILING("useful_life_months"::numeric / 12)
END;

ALTER TABLE "equipment"
  DROP COLUMN "useful_life_months";

ALTER TABLE "equipment"
  ALTER COLUMN "useful_life_years" SET NOT NULL;
