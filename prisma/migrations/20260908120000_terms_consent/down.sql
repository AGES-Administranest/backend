-- Destroys the record of who accepted what: disposable environments only.
ALTER TABLE "user" DROP COLUMN "terms_version",
DROP COLUMN "terms_accepted_at",
DROP COLUMN "privacy_accepted_at";
