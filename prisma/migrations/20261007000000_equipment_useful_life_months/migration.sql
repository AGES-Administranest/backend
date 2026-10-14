-- The existing useful_life_years values are converted to months before the
-- column is renamed. Null values remain null so the backend can apply the
-- 120-month default when the field is omitted.
ALTER TABLE "equipment"
  ADD COLUMN "useful_life_months" integer;

UPDATE "equipment"
SET "useful_life_months" = "useful_life_years" * 12
WHERE "useful_life_years" IS NOT NULL;

ALTER TABLE "equipment"
  DROP COLUMN "useful_life_years";
