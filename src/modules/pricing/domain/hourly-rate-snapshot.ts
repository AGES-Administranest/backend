/**
 * When a calculated month is stored in the history (US22). Pure: no Nest, no
 * Prisma Client.
 *
 * - **Current month:** every calculation replaces the stored one. Expenses are
 *   still coming in, so the latest figure is the one worth keeping.
 * - **Past month:** stored only if the month has no snapshot yet. Opening an
 *   old month today uses today's goals; overwriting would replace what the
 *   user saw back then with a configuration that did not exist at the time.
 * - **Future month:** not stored. It is a projection, and it starts being
 *   recorded once it becomes the current month.
 *
 * The month is read in UTC, like the month filter of GET /pricing/hourly-rate.
 */

export type SnapshotWrite = 'REPLACE' | 'KEEP_EXISTING' | 'SKIP';

export interface YearMonth {
  year: number;
  month: number;
}

/** `year × 12 + month`: one number per month, so months compare as numbers. */
export function monthIndex({ year, month }: YearMonth): number {
  return year * 12 + month;
}

export function currentUtcMonth(now: Date): YearMonth {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

export function snapshotWriteFor(period: YearMonth, now: Date): SnapshotWrite {
  const difference = monthIndex(period) - monthIndex(currentUtcMonth(now));
  if (difference === 0) return 'REPLACE';
  return difference < 0 ? 'KEEP_EXISTING' : 'SKIP';
}

/**
 * `YYYY-MM`, the format of the history's `from` and `to`, with the year in
 * 2000–2100: the range GET /pricing/hourly-rate and the table CHECK accept.
 */
export const YEAR_MONTH_PATTERN = /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/;

/** Expects a string that already matched `YEAR_MONTH_PATTERN`. */
export function parseYearMonth(value: string): YearMonth {
  const [year, month] = value.split('-').map(Number);
  return { year, month };
}
