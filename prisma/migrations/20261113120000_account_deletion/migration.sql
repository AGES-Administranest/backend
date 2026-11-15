-- US25 (LGPD): audit of account deletions. No foreign key to "user" on
-- purpose: the user row is deleted in the same transaction that writes this
-- one. No personal data either: the former user id, a hash of the Cognito sub
-- and what was done.

-- CreateTable
CREATE TABLE "account_deletion" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "cognito_sub_hash" VARCHAR(64) NOT NULL,
    "retention_basis" TEXT NOT NULL,
    "deleted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "storage_purged_at" TIMESTAMPTZ(6),
    "identity_removed_at" TIMESTAMPTZ(6),

    CONSTRAINT "account_deletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "account_deletion_user_id_key" ON "account_deletion"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "account_deletion_cognito_sub_hash_key" ON "account_deletion"("cognito_sub_hash");
