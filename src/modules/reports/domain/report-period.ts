import type { Period } from '../../../shared/dates/period';
import { DomainError } from '../../../shared/errors/domain-error';

/**
 * The longest period a general report covers: a year, leap day included. It
 * fits the "current year" shortcut (US26) and the yearly tax report, and keeps
 * a report at no more than 13 months of queries.
 */
export const MAX_REPORT_DAYS = 366;

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** @throws DomainError `REPORT_PERIOD_TOO_LONG` past `MAX_REPORT_DAYS`. */
export function assertReportablePeriod(
  period: Period,
  dates: { from: string; to: string },
): void {
  const days = Math.round(
    (period.days.to.getTime() - period.days.from.getTime()) / DAY_IN_MS,
  );
  if (days > MAX_REPORT_DAYS) {
    throw new DomainError(
      'INVALID_INPUT',
      'REPORT_PERIOD_TOO_LONG',
      `A report covers at most ${MAX_REPORT_DAYS} days`,
      { ...dates, days, maxDays: MAX_REPORT_DAYS },
    );
  }
}
