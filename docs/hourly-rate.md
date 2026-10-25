# Hourly rate — `GET /pricing/hourly-rate` (US20)

The value of the user's working hour for one month, with every part of the
formula, its amount and its share of the total. It is what the calculator shows
in highlight and in its breakdown.

The interactive version is in Swagger under the `pricing` tag
(`http://localhost:3000/docs`). This page is the contract in one place.

Authenticated (see ADR-02). Every value is scoped to the caller (ADR-11).

## The formula

```
margin      = margin % × (fixed costs + variable costs + owner's draw)
hourly rate = (fixed costs + variable costs + owner's draw + margin)
              ÷ productive hours per month
productive hours per month = weekly hours × 52 ÷ 12
```

`minimumHourlyRate` is the same division without the margin: below it, the
month's costs and the owner's draw are not covered.

## Where each part comes from

| `key` | Source |
|---|---|
| `FIXED_COSTS` | Personal expenses of the month + equipment depreciation (US15) + transport cost (US18) |
| `VARIABLE_COSTS` | Professional expenses of the month. Trips (US14) are already among them and are not added again |
| `OWNER_DRAW` | `monthlyIncomeGoal` from `GET /pricing-settings` (US19) |
| `SAFETY_MARGIN` | `safetyMarginPct` from `GET /pricing-settings`, applied to the three parts above |

The four cost sources are read by `FixedCostsService.getMonthlyCosts`, the same
method behind `GET /fixed-costs/summary`, so the two screens cannot disagree on
what a month cost:

- **Expenses** follow the statement rule: entries of the user, not deleted,
  with `accrual_date` inside the month, by `scope`.
- **Depreciation** is as of now for the current month and as of the last day of
  the month for any other month.
- **Transport** is `0.00` while it is not configured.

Personal expenses count as a fixed cost because the hour has to pay for the
month the owner lives, not only for the work. Splitting the professional
expenses by category (`expense-groups.ts`) was left for later: categories the
user creates fall into `OTHER`.

The weekly hours come from `GET /pricing-settings` too. They are the hours
**available**, idle time included, so the hour pays for the whole month.

## Request

| Query   | Type    | Notes                                         |
| ------- | ------- | --------------------------------------------- |
| `month` | integer | 1–12. Defaults to the current UTC month.      |
| `year`  | integer | 2000–2100. Defaults to the current UTC year.  |

The same filter as `GET /financial-entries` and `GET /fixed-costs/summary`.
The month is read in UTC for the same reason (see `fixed-costs.md`).

## 200 — calculated

Every amount, percentage and hour count is a decimal string with 2 places,
never a float, as in the other financial endpoints.

```json
{
  "month": 10,
  "year": 2026,
  "items": [
    { "key": "FIXED_COSTS", "label": "Fixed costs", "amount": "1399.08", "percentOfTotal": "10.97" },
    { "key": "VARIABLE_COSTS", "label": "Variable costs", "amount": "1225.00", "percentOfTotal": "9.61" },
    { "key": "OWNER_DRAW", "label": "Owner's draw", "amount": "8000.00", "percentOfTotal": "62.75" },
    { "key": "SAFETY_MARGIN", "label": "Safety margin", "amount": "2124.82", "percentOfTotal": "16.67" }
  ],
  "total": "12748.90",
  "productiveHours": "130.00",
  "hourlyRate": "98.07",
  "minimumHourlyRate": "81.72",
  "calculatedAt": "2026-10-19T20:42:00.000Z"
}
```

- `items` always has the four parts, in this order, even when an amount is
  `0.00`.
- `key` is the contract. `label` is text for developers and can change: the app
  shows its own text for each key, as it does with error codes.
- The `amount`s add up to `total` exactly.
- The `percentOfTotal`s add up to exactly `100.00`. Each share is rounded down
  and the hundredths left over go to the largest remainders, so a split like
  three thirds answers `33.34`, `33.33` and `33.33`.
- `hourlyRate` and `minimumHourlyRate` divide by the full productive hours.
  `productiveHours` is rounded only for display (40 h a week is `173.33`).
- `calculatedAt` is when this request ran. Nothing is stored: a change to an
  expense, an equipment or the goals shows up on the next request.

## 404 — goals not configured yet

```json
{
  "statusCode": 404,
  "code": "PRICING_SETTINGS_NOT_FOUND",
  "message": "Pricing settings are not configured yet",
  "path": "/pricing/hourly-rate",
  "timestamp": "2026-10-19T20:42:00.000Z"
}
```

The same code and status as `GET /pricing-settings`, and for the same reason:
the income goal, the weekly hours and the margin were never saved. A row with
only the transport cost does not count. **This is not a failure**: the app shows
the calculator's initial state, with the same handling it already has for
`GET /pricing-settings`.

A `409` was considered and left out. In this API `409` means a duplicate or an
action on a record in the wrong state (`APPOINTMENT_NOT_SCHEDULED`,
`INVOICE_UPLOAD_NOT_FINISHED`); missing settings are already answered with
`404` (`PRICING_SETTINGS_NOT_FOUND`, `TRANSPORT_COST_NOT_FOUND`).

## 400 — invalid month or year

`VALIDATION_ERROR`, as on every other route: a month outside 1–12, a year
outside 2000–2100, a value that is not an integer (`2026-10` included) or an
unknown query parameter.

## For other modules

The minimum price per procedure (US21) can use `HourlyRateService.calculate`,
exported by the `pricing` module, instead of repeating the formula. The pure
arithmetic lives in `src/modules/pricing/domain/hourly-rate.ts`.
