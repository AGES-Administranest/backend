/**
 * How a date given as input is read when it bounds a period.
 *
 * The app may send either a full ISO 8601 timestamp or a plain `YYYY-MM-DD`.
 * A plain date has no time, so as a bound it has to mean the whole day: the
 * start is its first instant, the end its last. Without this, `endDate=
 * 2026-09-30` would be midnight at the *start* of the 30th and the entire day
 * would fall out of the period. Both the DTO validation and the services
 * read dates through here, so they never disagree.
 */

/** `YYYY-MM-DD`, with no time part. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateOnly(value: string): boolean {
  return DATE_ONLY.test(value);
}

/** A date-only start is the first instant of that day (UTC); a timestamp is used as is. */
export function toPeriodStart(value: string): Date {
  return new Date(value);
}

/** A date-only end is the last instant of that day (UTC); a timestamp is used as is. */
export function toPeriodEnd(value: string): Date {
  return isDateOnly(value)
    ? new Date(`${value}T23:59:59.999Z`)
    : new Date(value);
}
