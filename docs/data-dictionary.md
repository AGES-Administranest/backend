# Data dictionary

Supplement to the doc-comments (`///`) in `prisma/schema.prisma`. This is where
conventions that span more than one column or table live.

## Stock — `stock_movement`

`stock_movement` is the stock ledger: **append-only**, one row per event.
`item.current_quantity` and `item_lot.current_quantity` are caches of the sum of
those rows.

### Sign convention

| Rule | Value |
|---|---|
| `quantity` | **Always positive.** Never `0`, never negative. `NUMERIC(14,3)`. |
| Direction | Comes **exclusively** from `type`. |
| `type = INBOUND` | Adds to `current_quantity`. |
| `type = OUTBOUND` | Subtracts from `current_quantity`. |

The balance is always computed as:

```sql
SUM(CASE type WHEN 'INBOUND' THEN quantity ELSE -quantity END)
```

This holds for **every** source, without exception:

- **Adjustment that increases stock** (e.g. a count found more than the system
  had): `type = INBOUND`, `source = MANUAL_ADJUSTMENT`.
- **Adjustment that decreases stock** (loss, breakage, expiration):
  `type = OUTBOUND`, `source = MANUAL_ADJUSTMENT`, `adjustment_reason` filled in.
- **Reversal** (`source = CORRECTION_REVERSAL`): `type` is the **opposite** of the
  record being corrected, same `quantity`. A reversal of an inbound is an outbound.

There is no `adjustment_in` / `adjustment_out` and no sign column: `type` already
carries the direction for any movement. `adjustment_reason` only answers the
*why*, never the direction.

### Source (`source`) × link columns

| `source` | Meaning | Expected link column |
|---|---|---|
| `MANUAL_PURCHASE` | Manually entered inbound, no invoice | `supplier_id` (optional) |
| `ORDER_IMPORT` | Inbound generated when receiving a purchase order | `purchase_order_id` |
| `APPOINTMENT` | Material consumed during an appointment | `appointment_id` |
| `MANUAL_ADJUSTMENT` | Manual balance reconciliation | `adjustment_reason` |
| `CORRECTION_REVERSAL` | Reversal of an incorrect entry | — (references the original via `notes`) |

Inbound coming from invoice OCR uses `purchase_invoice_line_id` (source recorded
according to the flow that created it).

### `adjustment_reason` (`adjustment_reason_enum`)

`LOSS` · `EXPIRATION` · `BREAKAGE` · `OTHER`. Filled in **only** when
`source = MANUAL_ADJUSTMENT`. `NULL` for any other source. Application rule —
not expressible in Prisma, validate in the service.

### Correction: `deleted_at` vs `CORRECTION_REVERSAL`

See the doc-comment of the `StockMovement` model. Summary: `deleted_at` (soft
delete) only for an error caught before any effect; `CORRECTION_REVERSAL` for an
error that already affected a balance or was already seen. Never both on the same
record.

### `item.needs_adjustment`

Persisted boolean, `default false`. **US10** flag: turns on when a movement
(typically a `CORRECTION_REVERSAL`) leaves `current_quantity < 0`; turns off when
the user records the adjustment that reconciles the balance. It is persisted
because it is workflow state — the item stays "to be adjusted" even if another
inbound later brings the negative back to zero.

## Purchasing — `purchase_order`

Purchase order to a supplier. When received (`status = RECEIVED`, `received_at`
filled in) it generates the corresponding stock inbounds
(`stock_movement.source = ORDER_IMPORT`). It is different from `purchase_invoice`,
which is the fiscal document digitized via OCR.

`status` (`purchase_order_status_enum`): `DRAFT` → `PLACED` → `RECEIVED`, or
`CANCELLED` from `DRAFT`/`PLACED`.
