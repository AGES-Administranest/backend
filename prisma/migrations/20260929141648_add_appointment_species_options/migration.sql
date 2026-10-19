-- Widens species_enum beyond canine/feline/other: an anesthesiologist also
-- sees equine, bovine, avian and exotic/wildlife patients, and "other" alone
-- didn't let anyone say which. No existing rows are affected.

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "species_enum" ADD VALUE 'EQUINE';
ALTER TYPE "species_enum" ADD VALUE 'BOVINE';
ALTER TYPE "species_enum" ADD VALUE 'AVIAN';
ALTER TYPE "species_enum" ADD VALUE 'EXOTIC';
