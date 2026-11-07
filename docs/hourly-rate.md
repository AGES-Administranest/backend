# Hourly rate — `GET /pricing/hourly-rate` (US20) and its history (US22)

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
- `calculatedAt` is when this request ran. The response is always calculated
  from the current costs and goals, so a change to an expense, an equipment or
  the goals shows up on the next request. The result is then stored in the
  month's history by the rule in [History](#history).

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

## History

`GET /pricing/hourly-rate` always calculates with the **current** goals, so on
its own a change to the income goal or the weekly hours would rewrite every past
month. The history keeps the hour value of each month as it was calculated, in
`hourly_rate_snapshot` (see [`data-dictionary.md`](data-dictionary.md)).

### When a month is stored

| Trigger | Month | What happens |
|---|---|---|
| `GET /pricing/hourly-rate` | Current month (UTC) | The stored month is **replaced** on every call. Expenses are still coming in, so the latest figure is the one worth keeping. |
| `GET /pricing/hourly-rate` | Past month | Stored **only if the month has no snapshot yet**. Opening an old month today uses today's goals; overwriting would replace what the user saw back then with a configuration that did not exist at the time. |
| `GET /pricing/hourly-rate` | Future month | **Not stored.** It is a projection; it starts being recorded once it becomes the current month. |
| `PUT /pricing-settings` | Current month (UTC) | Recalculated and **replaced**, so the history reflects new goals even if the calculator is not opened afterwards. |

A `404 PRICING_SETTINGS_NOT_FOUND` stores nothing: without goals there is no
hour value. Each write is a single statement on the unique key (`user_id`,
`year`, `month`): for the current month an upsert (`INSERT ... ON CONFLICT DO
UPDATE`), for a past month an insert that skips an existing row (`INSERT ... ON
CONFLICT DO NOTHING`). Two requests racing on the same new month therefore
cannot both insert it, and a past month is never overwritten. (An upsert with an
empty update is avoided on purpose: Prisma runs it as a read followed by an
insert, so the losing request failed with a unique violation.)

The rule lives in `snapshotWriteFor`
(`src/modules/pricing/domain/hourly-rate-snapshot.ts`). For a past month the
calculator and the history can answer different values on purpose: the
calculator shows that month with today's goals, the history what was stored
first.

### `GET /pricing/hourly-rate/history`

| Query  | Type      | Notes |
| ------ | --------- | ----- |
| `from` | `YYYY-MM` | First month listed, inclusive. Optional: without it, the oldest one. |
| `to`   | `YYYY-MM` | Last month listed, inclusive. Optional: without it, the latest one. |

Years are 2000–2100, as in the month filter of `GET /pricing/hourly-rate`. One
item per month that has a snapshot, **from the latest month back**. A month
without one is left out, never answered as `0.00`. An account with no snapshot
answers `[]`.

#### 200

```json
[
  {
    "year": 2026,
    "month": 11,
    "hourlyRate": "63.46",
    "calculatedAt": "2026-11-02T16:43:32.177Z"
  },
  {
    "year": 2026,
    "month": 3,
    "hourlyRate": "85.15",
    "calculatedAt": "2026-11-02T16:43:32.158Z"
  }
]
```

#### 400 — invalid range

`VALIDATION_ERROR` for a bound that is not `YYYY-MM` (`2026-4`), a year outside
2000–2100, `from` after `to`, or an unknown query parameter:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Invalid request",
  "details": {
    "fields": ["from must not be after to"]
  },
  "path": "/pricing/hourly-rate/history?from=2026-04&to=2026-03",
  "timestamp": "2026-11-02T16:43:32.198Z"
}
```

### `GET /pricing/hourly-rate/history/:year/:month`

The stored month in **the same shape as `GET /pricing/hourly-rate`**, plus
`parameters`: the goals it was calculated with. Nothing is recalculated: the
four amounts and the hour value come from the row, and the total, productive
hours, minimum hour value and shares are derived from them by the same domain
code as the live calculation (`composeHourlyRate`). `calculatedAt` is when the
stored calculation ran. Every value is a decimal string with 2 places.

#### 200

The month of March after the goals changed from 8000 / 30 h / 20 % to
10000 / 40 h / 10 %: the history still answers what was stored first.

```json
{
  "month": 3,
  "year": 2026,
  "items": [
    { "key": "FIXED_COSTS", "label": "Fixed costs", "amount": "0.00", "percentOfTotal": "0.00" },
    { "key": "VARIABLE_COSTS", "label": "Variable costs", "amount": "1225.00", "percentOfTotal": "11.06" },
    { "key": "OWNER_DRAW", "label": "Owner's draw", "amount": "8000.00", "percentOfTotal": "72.27" },
    { "key": "SAFETY_MARGIN", "label": "Safety margin", "amount": "1845.00", "percentOfTotal": "16.67" }
  ],
  "total": "11070.00",
  "productiveHours": "130.00",
  "hourlyRate": "85.15",
  "minimumHourlyRate": "70.96",
  "calculatedAt": "2026-11-02T16:43:32.158Z",
  "parameters": {
    "monthlyIncomeGoal": "8000.00",
    "weeklyHours": "30.00",
    "safetyMarginPct": "20.00"
  }
}
```

#### 404 — month without a snapshot

```json
{
  "statusCode": 404,
  "code": "HOURLY_RATE_SNAPSHOT_NOT_FOUND",
  "message": "This month has no stored hourly rate",
  "details": { "year": 2026, "month": 2 },
  "path": "/pricing/hourly-rate/history/2026/2",
  "timestamp": "2026-11-02T16:43:32.196Z"
}
```

The month was never calculated, is a future month, or belongs to another
account: the three are not told apart (ADR-11). **Not a failure** for the app,
which shows the month as empty in the history.

#### 400 — invalid month

`VALIDATION_ERROR` when `year` is not an integer in 2000–2100 or `month` not an
integer in 1–12 (`/history/2026/13`).

## For other modules

The minimum price per procedure (US21) can use `HourlyRateService.calculate`,
exported by the `pricing` module, instead of repeating the formula. The pure
arithmetic lives in `src/modules/pricing/domain/hourly-rate.ts`.
