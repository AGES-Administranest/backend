-- AlterTable
ALTER TABLE "user" ADD COLUMN     "privacy_accepted_at" TIMESTAMPTZ(6),
ADD COLUMN     "terms_accepted_at" TIMESTAMPTZ(6),
ADD COLUMN     "terms_version" TEXT;
