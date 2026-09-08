-- Reverts the migration next to it. This erases the record of who accepted
-- what and when: only run it against a disposable environment.
ALTER TABLE "user" DROP COLUMN "terms_version",
DROP COLUMN "terms_accepted_at",
DROP COLUMN "privacy_accepted_at";
