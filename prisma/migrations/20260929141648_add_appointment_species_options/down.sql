-- Manual reversal of migration 20260929141648_add_appointment_species_options.
-- Prisma Migrate does not run this file automatically; see
-- prisma/migrations/README.md for the test procedure (up + down).
--
-- The reversal is LOSSY: appointments recorded as EQUINE, BOVINE, AVIAN or
-- EXOTIC did not exist as a value before this migration and collapse into
-- OTHER, same as any appointment that was already OTHER.

-- AlterEnum
BEGIN;
CREATE TYPE "species_enum_new" AS ENUM ('CANINE', 'FELINE', 'OTHER');
ALTER TABLE "appointment" ALTER COLUMN "species" TYPE "species_enum_new" USING (
  CASE "species"::text
    WHEN 'CANINE' THEN 'CANINE'
    WHEN 'FELINE' THEN 'FELINE'
    ELSE 'OTHER'
  END::"species_enum_new"
);
ALTER TYPE "species_enum" RENAME TO "species_enum_old";
ALTER TYPE "species_enum_new" RENAME TO "species_enum";
DROP TYPE "species_enum_old";
COMMIT;
