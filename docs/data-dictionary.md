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
  It points at the corrected record through `reversed_movement_id`; `notes` only
  repeats that for humans.

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
| `CORRECTION_REVERSAL` | Reversal of an incorrect entry | `reversed_movement_id` (unique: a movement is reversed at most once) |

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

## Finance — `financial_category`

The categories of the cash book (`financial_entry.category_id`). Two kinds share
the table, told apart by `user_id`:

| Kind | `user_id` | Created by | `isDefault` in the API |
|---|---|---|---|
| Default | `NULL` | Migrations only | `true` |
| User category | The owner | `POST /financial-categories` | `false` |

`GET /financial-categories` returns the active defaults plus the caller's own
categories, with `isDefault` and never the owner. Defaults are stored with
English names (`Supplies`, `Other`…) that work as keys: the app translates them.

### Same name

The stored `name` is tidied: trimmed, with repeated spaces collapsed into one.
Two names are **the same category** when they match ignoring case, accents and
extra spaces, within the same `nature` (`categoryNameKey` in
`src/modules/financial/domain/category-name.ts`, the same rule as the app's
search).

- The service compares a new name with the user's categories **and** the
  defaults of that nature. A match answers `409 FINANCIAL_CATEGORY_DUPLICATED`
  with `details.id`, and the app selects that category instead.
- The same name in the other nature is allowed, and two accounts can each have
  a category with the same name.
- The comparison uses the stored English names of the defaults. A user category
  "Outros" next to the default "Other" is accepted by the server; the app's
  category field matches the translated label first, so it never sends one.

The database backs this with two unique indexes, exact on `name`:

| Index | Covers |
|---|---|
| `financial_category_user_id_nature_name_key` | One account never stores the same name twice in a nature. |
| `financial_category_default_nature_name_key` (`WHERE user_id IS NULL`, raw SQL in `20261005211500_financial_entry_integrity`) | The defaults. Postgres treats `NULL`s as distinct, so the first index does not stop two identical defaults. |

When two requests with exactly the same name race each other, the loser hits
the first index (or the primary key, for the same id); the service reads again
and answers as above, or returns the category when both were the same request
sent twice. A race between two spellings that differ only by case or
accent is not caught by the database. A normalized column with its own unique
index would close it; for one person typing on one phone it is not worth the
migration yet.

A user name against a default name can only be checked in the service. A
migration that adds a new default has to deal with users who already own a
category with that name.

### Identity, owner and lifecycle

- **`id`** is generated by the app (ADR-09). Resending the same id with the same
  name, nature and default scope returns the category already created; any
  other use of the id (another payload, a default, another account's category)
  answers `409 FINANCIAL_CATEGORY_ID_CONFLICT`, without saying whose it is.
- **Owner:** always the caller's token (ADR-11). The foreign key to `user` is
  `ON DELETE RESTRICT`, like every other relation to `user`
  (`20261014210209_financial_category_owner_restrict`). With `SET NULL`,
  Prisma's default for an optional relation, a deleted user's categories would
  have become defaults for everyone. Cleanup goes entries → categories → users.
- **`default_scope`** only suggests the scope of a new entry. The app sends the
  scope selected in the form when it creates a category.
- **`active`:** inactive categories are not listed, and a new or edited entry
  cannot point at one (`400 FINANCIAL_CATEGORY_INVALID`). No route archives a
  category yet.

## Purchasing — `purchase_order`

Purchase order to a supplier. When received (`status = RECEIVED`, `received_at`
filled in) it generates the corresponding stock inbounds
(`stock_movement.source = ORDER_IMPORT`). It is different from `purchase_invoice`,
which is the fiscal document digitized via OCR.

`status` (`purchase_order_status_enum`): `DRAFT` → `PLACED` → `RECEIVED`, or
`CANCELLED` from `DRAFT`/`PLACED`.

## Pricing — `pricing_settings`

One row per user (`user_id` is the primary key), holding what the billable-hour
calculator needs and does not calculate on its own: the US19 goals and the US18
transport cost. The goals are read and written through `GET` / `PUT
/pricing-settings` — see [`pricing-settings.md`](pricing-settings.md).

| Column | Story | Rule (CHECK) |
|---|---|---|
| `monthly_income_goal` | US19 | `> 0`. Owner draw plus desired profit, one amount in R$. |
| `weekly_hours` | US19 | `> 0` and `<= 168`. Hours available, idle time included, not only billed hours. The hour value divides by it. |
| `safety_margin_pct` | US19 | Between `0` and `100`, inclusive. |
| `transport_cost_monthly` | US18 | `>= 0`. Zero is a valid cost: a professional who does not drive. |

### When the settings count as configured

Only when the three US19 goals are filled in. `pricing_settings_goals_together`
makes them all filled in or all `NULL`, so there is no half-configured row. A row
with only `transport_cost_monthly` is **not configured**: `GET /pricing-settings`
answers `404 PRICING_SETTINGS_NOT_FOUND`, and the app shows the calculator's
initial state, asking for the goals before any hour value.

Every column is nullable so that either story can create the row first. A CHECK
on a `NULL` value passes, so each range rule only applies once the column is
filled in.
