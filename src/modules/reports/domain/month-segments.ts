import { Prisma } from '@prisma/client';

import { fromIsoDate, toIsoDate } from '../../../shared/dates/iso-date';

/** The part of a period that falls in one calendar month. */
export interface MonthSegment {
  year: number;
  /** 1 to 12. */
  month: number;
  /** First day of the period in this month, `YYYY-MM-DD`, included. */
  from: string;
  /** Last day of the period in this month, `YYYY-MM-DD`, included. */
  to: string;
  /** How many days of the period fall in this month. */
  days: number;
  /** How many days the month has: 28 to 31. */
  daysInMonth: number;
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/**
 * Splits a period into its months. 15/10 to 14/11 is 15–31/10 and 01–14/11.
 * Expects `from` not after `to`, which `periodFromIsoDates` already checked.
 */
export function monthSegments(from: string, to: string): MonthSegment[] {
  const lastDay = fromIsoDate(to);
  const segments: MonthSegment[] = [];

  for (let cursor = fromIsoDate(from); cursor.getTime() <= lastDay.getTime();) {
    const year = cursor.getUTCFullYear();
    const monthIndex = cursor.getUTCMonth();
    // day 0 of the next month = last day of this one
    const monthEnd = new Date(Date.UTC(year, monthIndex + 1, 0));
    const segmentEnd = monthEnd < lastDay ? monthEnd : lastDay;

    segments.push({
      year,
      month: monthIndex + 1,
      from: toIsoDate(cursor),
      to: toIsoDate(segmentEnd),
      days:
        Math.round((segmentEnd.getTime() - cursor.getTime()) / DAY_IN_MS) + 1,
      daysInMonth: monthEnd.getUTCDate(),
    });
    cursor = new Date(Date.UTC(year, monthIndex + 1, 1));
  }

  return segments;
}

/**
 * The share of a monthly amount that belongs to the segment, by the real days
 * of the month (decided on 11/11/2026): 17 days of October are 17/31 of it,
 * and a whole month is always 100%. Rounded to cents, half up.
 */
export function prorate(
  monthlyAmount: Prisma.Decimal,
  segment: Pick<MonthSegment, 'days' | 'daysInMonth'>,
): Prisma.Decimal {
  return monthlyAmount
    .times(segment.days)
    .dividedBy(segment.daysInMonth)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}
