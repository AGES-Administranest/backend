-- Supports the offline-sync delta pull: WHERE user_id = $1 AND created_at > $2
-- ORDER BY created_at. Every existing index on stock_movement is on
-- occurred_at (when it happened on the device), so this query had nothing to
-- lean on and degraded into a scan as the ledger grew.
CREATE INDEX "stock_movement_user_id_created_at_idx"
  ON "stock_movement" ("user_id", "created_at");
