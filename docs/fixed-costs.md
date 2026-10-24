# Fixed costs summary (US18)

`GET /fixed-costs/summary` returns the user's fixed costs for one month: the
numbers behind the Finance screen and the input US20 uses for the hourly rate.

Authenticated (see ADR-02). Every value is scoped to the caller (ADR-11).

## Request

| Query   | Type    | Notes                                        |
| ------- | ------- | -------------------------------------------- |
| `month` | integer | 1–12. Defaults to the current UTC month.     |
| `year`  | integer | 2000–2100. Defaults to the current UTC year. |

An invalid value answers `400 VALIDATION_ERROR`; a missing or bad token answers
`401`.

## Response

Every value is a decimal string with 2 places, never a float.

```json
{
  "professionalExpenses": "1250.00",
  "personalExpenses": "830.50",
  "depreciation": "189.08",
  "transport": "300.00",
  "total": "2569.58"
}
```

`total` is the sum of the four other values.

## Where each value comes from

- **`professionalExpenses` / `personalExpenses`** — sum of the `EXPENSE` entries
  of the month, by `scope`. It uses the same rule as the statement
  (`GET /financial-entries`): entries of the user, not deleted, with
  `accrual_date` inside the month. The statement does not filter by status, so
  neither does this sum, which is what makes it match the Prof. and Personal
  cards. Depreciation is not an entry and is not included here.
- **`transport`** — `pricing_settings.transport_cost_monthly` of the user.
  `0.00` when there is no row or the column is null.
- **`depreciation`** — monthly depreciation of the user's equipment, from
  `EquipmentService.summary` (US15). It follows the requested month: for the
  current month it counts up to now, for any other month up to its last day.
  Equipment bought after that date is not counted.

## Month boundaries

The month is read in **UTC**, exactly like the statement (`accrualMonth`). The
original task asked for `America/Sao_Paulo`; that was not applied on purpose,
because the two would then disagree for entries between 21:00 and 24:00 (São
Paulo) on the last day of a month. If the statement moves to São Paulo time,
this endpoint follows it for free.

## Depreciation

Depreciation is calculated by `EquipmentService.summary` in the equipment
module (US15), using the shared `calculateDepreciation` domain function. The
fixed costs endpoint reuses it instead of implementing a separate calculation,
which keeps depreciation consistent with the equipment summary and

## For other modules

`FixedCostsService.getMonthlyCosts(userId, year, month)`, exported by the
`fixed-costs` module, returns the four sources above as unformatted `Decimal`s.
The hourly rate (US20, [`hourly-rate.md`](hourly-rate.md)) reads them there, so
both screens agree on what a month cost.
