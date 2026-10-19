-- A stable ID lets down.sql remove only the row created by this migration.
INSERT INTO "financial_category" (
    "id",
    "user_id",
    "name",
    "nature",
    "default_scope",
    "active",
    "updated_at"
)
SELECT
    'f2c9e0a1-6b74-4f52-9d8a-1c3e7b5a9026'::UUID,
    NULL,
    'Professional fees',
    'INCOME'::"entry_nature_enum",
    'PROFESSIONAL'::"entry_scope_enum",
    true,
    CURRENT_TIMESTAMP
WHERE NOT EXISTS (
    SELECT 1
    FROM "financial_category"
    WHERE "user_id" IS NULL
      AND "name" = 'Professional fees'
);