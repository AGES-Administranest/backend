# Pricing settings — `/pricing-settings` (US19)

The income goal, the weekly hours and the safety margin the billable-hour
calculator starts from. One set per user: the routes take no id, the token says
whose settings these are (ADR-11).

The interactive version, with every field and limit, is in Swagger under the
`pricing-settings` tag (`http://localhost:3000/docs`). This page is the contract
in one place, with the real responses and what the app is expected to do with
each one.

| Method | Route | What it does |
|---|---|---|
| `GET` | `/pricing-settings` | Reads the saved goals, or `404` while there are none |
| `PUT` | `/pricing-settings` | Creates or overwrites the three goals |
| `GET` | `/pricing-settings/transport` | Reads the monthly transport cost, or `404` while there is none (US18) |
| `PATCH` | `/pricing-settings/transport` | Creates or overwrites the monthly transport cost (US18) |

All of them need `Authorization: Bearer <IdToken>`. Without it the answer is
`401 UNAUTHENTICATED`, as on every other route.

## The fields

| Field | Type | Rule |
|---|---|---|
| `monthlyIncomeGoal` | number | `> 0`. Owner draw plus desired profit, one amount in R$. |
| `weeklyHours` | number | `> 0` and `<= 168`. Hours **available**, idle time included, not only billed hours. |
| `safetyMarginPct` | number | `0` to `100`, inclusive. |

All three are JSON numbers, with up to 2 decimal places, in requests and
responses alike. A numeric string (`"40"`) is refused.

The transport cost (US18) lives in the same table but is **not** part of these
routes: it is not returned, not accepted, and a `PUT` never changes it. It has
its own routes, described in [Transport cost](#transport-cost--pricing-settingstransport-us18).

## `GET /pricing-settings`

### 200 — configured

```json
{
  "monthlyIncomeGoal": 8000,
  "weeklyHours": 37.5,
  "safetyMarginPct": 10,
  "updatedAt": "2026-10-12T19:40:18.201Z"
}
```

`updatedAt` is the last change to the row, which includes a change to the
transport cost.

### 404 — not configured yet

```json
{
  "statusCode": 404,
  "code": "PRICING_SETTINGS_NOT_FOUND",
  "message": "Pricing settings are not configured yet",
  "path": "/pricing-settings",
  "timestamp": "2026-10-12T19:40:18.148Z"
}
```

**This is not a failure.** It is the calculator's initial state: the app shows
the screen that asks for the three goals before any hour value. The settings
count as configured only when all three goals are saved, so this `404` also
comes back when the row exists with only the transport cost (US18).

## `PUT /pricing-settings`

The three fields are required together; there is no partial update. The first
call creates the settings, every later call overwrites them. Resending the same
body stores the same values (only `updatedAt` moves), so a retry after a dropped
connection is safe.

```json
{ "monthlyIncomeGoal": 8000, "weeklyHours": 37.5, "safetyMarginPct": 10 }
```

### 200 — saved

The same body as the `GET` answers, with the values just saved. The app can use
it directly instead of reading the settings again.

### 400 — invalid payload

Nothing is saved. `details.fields` lists every rule that failed, so several
fields can come back at once:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Invalid request",
  "details": {
    "fields": [
      "weeklyHours must be a positive number",
      "safetyMarginPct must not be greater than 100"
    ]
  },
  "path": "/pricing-settings",
  "timestamp": "2026-10-12T19:40:18.170Z"
}
```

What triggers it:

- a missing field, `null`, or a value that is not a JSON number;
- `monthlyIncomeGoal` or `weeklyHours` equal to or below zero (zero weekly
  hours would divide the hour value by zero);
- `weeklyHours` over 168;
- `safetyMarginPct` below 0 or over 100;
- more than 2 decimal places;
- any field beyond the three, `transportCostMonthly` included.

The messages in `details.fields` are for developers and can change. The app
validates the same rules on its own form and shows its own texts; this `400` is
the backstop.

## Transport cost — `/pricing-settings/transport` (US18)

The monthly transport cost, in R$. It shares the `pricing_settings` row with the
goals above, but the two are saved independently: neither route touches the
other's columns, and either one can create the row first.

### The field

| Field | Type | Rule |
|---|---|---|
| `transportCostMonthly` | number | `>= 0`, up to 2 decimal places, at most `999999999999.99`. **Zero is valid**: a professional who does not drive. |

A JSON number in requests and responses alike. A numeric string (`"450"`) is
refused.

### `GET /pricing-settings/transport`

#### 200 — saved

```json
{ "transportCostMonthly": 450, "updatedAt": "2026-10-19T16:40:18.201Z" }
```

`updatedAt` is the last change to the row, which includes a change to the goals.

#### 404 — not saved yet

```json
{
  "statusCode": 404,
  "code": "TRANSPORT_COST_NOT_FOUND",
  "message": "Transport cost is not configured yet",
  "path": "/pricing-settings/transport",
  "timestamp": "2026-10-19T16:40:18.148Z"
}
```

**This is not a failure.** It is the card's initial state: show the field empty.
It also comes back when the row exists with only the goals. A saved cost of `0`
is a `200` with `0`, never a `404`.

### `PATCH /pricing-settings/transport`

```json
{ "transportCostMonthly": 450 }
```

The first call creates the row, every later call overwrites the cost. It answers
`200` either way, and resending the same body stores the same value (only
`updatedAt` moves). The goals (US19) are not changed: on a new row they stay
empty, so `GET /pricing-settings` keeps answering `404` until they are saved.

#### 200 — saved

The same body as the `GET` answers, with the value just saved.

#### 400 — invalid payload

Nothing is saved. Same shape as the `400` of the goals route:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Invalid request",
  "details": { "fields": ["transportCostMonthly must not be less than 0"] },
  "path": "/pricing-settings/transport",
  "timestamp": "2026-10-19T16:40:18.170Z"
}
```

What triggers it:

- a missing field, `null`, or a value that is not a JSON number;
- a negative value;
- more than 2 decimal places;
- a value above `999999999999.99`;
- any field beyond `transportCostMonthly`, the three goals and `userId` included.

The messages in `details.fields` are for developers and can change. The app
validates the same rules on its own field and shows its own texts; this `400` is
the backstop.

## For other modules

The hour calculation (US20) and the minimum price per procedure (US21) need the
goals without turning their absence into a `404`. They get them from
`PricingSettingsService.findConfigured(userId)`, exported by the
`pricing-settings` module, which returns the same object as the `GET` or `null`
while the settings are not configured.

## Where the rules are enforced

Twice: by the DTO, which answers the `400` above, and by `CHECK` constraints on
the `pricing_settings` table, so no other write path can store a value the
calculation cannot use. The constraints are described in
[`data-dictionary.md`](data-dictionary.md#pricing--pricing_settings).
