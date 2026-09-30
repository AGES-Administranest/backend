import { applyDecorators } from '@nestjs/common';
import { IsISO8601, Matches } from 'class-validator';

/** `@db.Date` columns travel as `YYYY-MM-DD`, read and written at UTC midnight. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fromIsoDate(isoDate: string): Date {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00.000Z`);
}

/**
 * A calendar date that exists, written exactly as `YYYY-MM-DD`: what
 * `fromIsoDate` can read. `@IsDateString()` is not enough — it also takes
 * `20270531` or `2027-W05`, which `fromIsoDate` turns into an invalid date,
 * and `2027-02-30`, which it quietly turns into 2 March.
 */
export function IsIsoDate(): PropertyDecorator {
  return applyDecorators(
    Matches(/^\d{4}-\d{2}-\d{2}$/, {
      message: '$property must be a date written as YYYY-MM-DD',
    }),
    IsISO8601({ strict: true }),
  );
}
