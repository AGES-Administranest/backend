/**
 * The app's calendar days are São Paulo days. Brazil dropped daylight saving
 * in 2019, so a fixed offset is enough and no timezone database is needed.
 */
const BUSINESS_UTC_OFFSET = '-03:00';
const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** The instant a `YYYY-MM-DD` day begins. */
export function startOfBusinessDay(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000${BUSINESS_UTC_OFFSET}`);
}

/** The instant a `YYYY-MM-DD` day is over: the exclusive end of a period. */
export function startOfNextBusinessDay(isoDate: string): Date {
  return new Date(startOfBusinessDay(isoDate).getTime() + DAY_IN_MS);
}
