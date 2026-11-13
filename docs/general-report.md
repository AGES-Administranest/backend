# General report — `GET /reports/general` (US29)

One document with the financial and operational picture of a period, made of
the sections the user selected. It feeds the preview (US27) and the PDF (US28);
neither of them computes anything of its own.

The interactive version is in Swagger under the `reports` tag
(`http://localhost:3000/docs`). This page is the contract in one place.

Authenticated (see ADR-02). Every value is scoped to the caller (ADR-11).

## Request

```
GET /reports/general?from=2026-10-15&to=2026-11-14&sections=FINANCIAL,TRIPS
```

| Parameter | Rule |
|---|---|
| `from`, `to` | `YYYY-MM-DD`, both included, at most 366 days. The same period as `GET /reports/availability` (US26), so the two read the same records |
| `sections` | Comma-separated, or the parameter repeated. Without it, every section. Present but empty: `400 REPORT_SECTIONS_EMPTY` |

| Error | When |
|---|---|
| `400 VALIDATION_ERROR` | A date is missing or not `YYYY-MM-DD`, or a section is unknown |
| `400 REPORT_PERIOD_INVALID` | `from` is after `to` |
| `400 REPORT_PERIOD_TOO_LONG` | The period is longer than 366 days. `details` carries `days` and `maxDays` |
| `400 REPORT_SECTIONS_EMPTY` | `sections` was sent with nothing in it |

## Response

```json
{
  "period": { "from": "2026-10-15", "to": "2026-11-14" },
  "sections": [{ "type": "FINANCIAL", "empty": false, "...": "..." }],
  "generatedAt": "2026-11-11T21:00:00.000Z"
}
```

- `sections` holds only the selected sections, always in the order of the
  document below, whatever order they were asked in. Their `type` values are
  the scope the header shows.
- A selected section without records is still sent, with `empty: true`, so the
  document can say so instead of dropping it. Only the user removes a section.
- Money and quantities are strings (`"1234.50"`), never floats.

## Sections

| `type` | What it shows | Where it comes from |
|---|---|---|
| `FINANCIAL` | Income by origin, expenses by group, net result, and the same three per month | `FinancialEntryService.summarizeRange` — the statement rule of `GET /financial-balance` |
| `APPOINTMENTS` | Completed appointments: date, patient, ASA, weight, location, procedure, amount; count and billed total | `AppointmentsService.findCompletedInPeriod` |
| `CLIENTS` | By client: appointments, billed total, trips and their cost | Grouped versions of the client summary reads (US17) |
| `STOCK` | What the procedures used, by item, and the purchases of the period | `StockMovementsService.consumptionInPeriod`, `StockEntryService.purchaseTotalsInPeriod` |
| `SUPPLIERS` | Confirmed purchases by supplier | `StockEntryService.purchaseTotalsBySupplierInPeriod` |
| `TRIPS` | Trip count, km and cost | `TripsService.totalsInPeriod` |
| `DEPRECIATION` | Depreciation of each month and of the period | `EquipmentService.monthlyDepreciation` (US15), prorated |
| `HOURLY_RATE` | The hour value of each month | History (US22) or `HourlyRateService.calculateWithoutStoring` (US20) |

### Financial

- **Income** by origin: `APPOINTMENTS` (procedures done), `SERVICE_INVOICES`
  (invoices issued), `OTHER` (posted by hand). Every origin is listed, zero
  included.
- **Expenses** by the six groups of `GET /financial-balance`: supplies, travel,
  fixed costs, depreciation, taxes and fees, other.
- **Months**: one item per calendar month the period touches, with income,
  expenses and net result. With more than one, the app shows the month-by-month
  comparison and the PDF draws it. The period total is the sum of the months,
  so the two always agree.
- For a whole month, the numbers are the ones `GET /financial-balance` gives.

### Periods that start or end mid-month

Decided on 11/11/2026. A period such as 15/10 to 14/11 is split into 15–31/10
and 01–14/11. Records are read by their own date, so nothing changes for them.
Depreciation, which only exists per month, is prorated by the **real days of the
month**:

```
amount = monthly depreciation × days of the period in the month ÷ days of the month
15/10 to 14/11 → 17/31 of October + 14/30 of November
```

A whole month is always 100%, whether it has 28, 30 or 31 days. The financial
section and the depreciation section use the same amounts (`ReportContext`
computes them once).

### Clients

Same filters as `GET /client/:id/summary` (US17), so a client's line matches its
card for the same period: completed appointments by `starts_at` in Brasília
time, trips by `occurred_on` with both days included. Records without a client
are grouped as **"Sem tomador"**. A client with trips and no appointment still
has a line.

### Stock and supplies

**Consumption** is what the procedures used: the movements of the appointments
the report counts, that is completed and not deleted. Deleting an appointment
reverses its supplies with the deletion date, which may fall outside the
period, so the supply and its reversal are left out together.
A supply that was corrected or removed leaves a `CORRECTION_REVERSAL` with the
same appointment, item and cost, which is subtracted, so a correction never
counts twice. Losses and manual adjustments are not consumption; they belong to
the stock summary (US12).

**Purchases** are the confirmed purchase invoices issued in the period, as
`GET /reports/availability` counts them. An invoice without a total counts but
adds nothing. The suppliers section groups the same invoices; those without a
supplier are grouped as **"Sem fornecedor"**.

### Hourly rate

One value per month of the period (decided on 11/11/2026).

| Month | Value |
|---|---|
| Past, with a stored value | The history (US22): what the hour was worth then. `source: HISTORY` |
| Past without one, current, or future | Calculated now (US20) with the current goals. `source: CALCULATED`. Not stored: the report only reads, and a past month calculated today must not enter the history as what the hour was worth then |

Without goals (US19, `PRICING_SETTINGS_NOT_FOUND`), nothing can be calculated:
those months come back with `hourlyRate: null`, the section has
`notice: "PRICING_SETTINGS_NOT_FOUND"`, and the app tells the user to fill in
the calculator.

## Not covered here

- The PDF itself (US28): see ADR-04 and the US28 task. It must reuse this
  service rather than recompute any section.
- Remembering the last selection of sections is the app's job.
