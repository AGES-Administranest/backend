-- Manual reversal of the user profile fields migration.
ALTER TABLE "user" DROP COLUMN "state",
DROP COLUMN "sex",
DROP COLUMN "city";

DROP TYPE "sex_enum";
