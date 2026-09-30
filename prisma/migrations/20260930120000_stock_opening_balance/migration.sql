-- The ledger now recomputes item.current_quantity from stock_movement on every
-- write (ADR-10). Balances typed on item create or edit have no movement behind
-- them and would be wiped by the next one, so each difference between the
-- cached balance and the ledger becomes one movement, dated when the item was
-- created so it opens the history.
INSERT INTO "stock_movement" (
  "id", "user_id", "item_id", "type", "source", "adjustment_reason",
  "quantity", "unit_cost", "occurred_at", "notes"
)
SELECT
  gen_random_uuid(),
  i."user_id",
  i."id",
  (CASE WHEN d."diff" > 0 THEN 'INBOUND' ELSE 'OUTBOUND' END)::"stock_movement_type_enum",
  'MANUAL_ADJUSTMENT'::"stock_movement_source_enum",
  'OTHER'::"adjustment_reason_enum",
  abs(d."diff"),
  coalesce(i."default_unit_cost", 0),
  i."created_at",
  'Opening balance (backfill)'
FROM "item" i
JOIN LATERAL (
  SELECT i."current_quantity" - coalesce(sum(
    CASE WHEN m."type" = 'INBOUND' THEN m."quantity" ELSE -m."quantity" END
  ), 0) AS "diff"
  FROM "stock_movement" m
  WHERE m."item_id" = i."id" AND m."deleted_at" IS NULL
) d ON true
WHERE d."diff" <> 0;
