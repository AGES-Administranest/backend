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
    v."id"::UUID,
    NULL,
    v."name",
    v."nature"::"entry_nature_enum",
    v."default_scope"::"entry_scope_enum",
    true,
    CURRENT_TIMESTAMP
FROM (
    VALUES
        ('7c2e1a90-4b3d-4f6a-8c15-0d9e2f4a6b81', 'Supplies', 'EXPENSE', 'PROFESSIONAL'),
        ('3e8d5c21-9a47-4b6e-b1f0-6c8a2d4e7f93', 'Travel', 'EXPENSE', 'PROFESSIONAL'),
        ('9f1a6b32-0c58-4d7e-a2e1-7b3c5d8f0a14', 'Taxes and fees', 'EXPENSE', 'PROFESSIONAL'),
        ('2b4c6d80-1e59-4a7f-9c30-8d5e1f7a2b46', 'Fixed costs', 'EXPENSE', 'PROFESSIONAL'),
        ('5d7e9f01-2a6b-4c8d-ae41-0b6c8d2e4f57', 'Other', 'EXPENSE', 'PROFESSIONAL'),
        ('8a0c2e46-3b7d-4e9f-b152-1c7d9e3f5a68', 'Other', 'INCOME', 'PERSONAL')
) AS v("id", "name", "nature", "default_scope")
WHERE NOT EXISTS (
    SELECT 1
    FROM "financial_category" AS existing
    WHERE existing."user_id" IS NULL
      AND existing."nature" = v."nature"::"entry_nature_enum"
      AND existing."name" = v."name"
);
