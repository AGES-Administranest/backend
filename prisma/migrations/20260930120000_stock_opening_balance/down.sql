DELETE FROM "stock_movement"
WHERE "source" = 'MANUAL_ADJUSTMENT' AND "notes" = 'Opening balance (backfill)';
