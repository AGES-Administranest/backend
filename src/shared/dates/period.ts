import { fromIsoDate, toIsoDate } from './iso-date';
import { DomainError } from '../errors/domain-error';

/**
 * The time zone a "day" belongs to for the user: Brasília. The same zone the
 * pricing module reads its months in (`PRICING_TIME_ZONE`).
 */
export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';

/** A span of time, `from` included and `to` excluded. */
export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * A period of whole days, as the two kinds of column need it.
 *
 * Half-open on purpose: a "day" is `[00:00, 00:00 next day)`, so no record
 * sits on the boundary of two periods. The two pairs exist because the same
 * calendar day starts at a different instant depending on the column:
 *
 * - `days` is for `@db.Date` columns, read and written at UTC midnight.
 * - `instants` is for `timestamptz` columns that hold the moment something
 *   happened on the device. An appointment at 21:00 on 31 October in Brasília
 *   is 00:00Z on 1 November, and it still belongs to October.
 *
 * A column that holds an instant but is written as UTC midnight (the financial
 * entry's `accrualDate`) uses `days`, to match the statement.
 */
export interface Period {
  days: DateRange;
  instants: DateRange;
}

/**
 * The period from `from` to `to`, both days included.
 *
 * It is the one rule for what a period is, so the availability check and the
 * reports it announces count the same records.
 *
 * @throws DomainError `REPORT_PERIOD_INVALID` when `from` is after `to`.
 */
export function periodFromIsoDates(
  from: string,
  to: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): Period {
  const firstDay = fromIsoDate(from);
  const lastDay = fromIsoDate(to);

  if (firstDay.getTime() > lastDay.getTime()) {
    throw new DomainError(
      'INVALID_INPUT',
      'REPORT_PERIOD_INVALID',
      '`from` must not be after `to`',
      { from, to },
    );
  }

  const dayAfter = new Date(lastDay.getTime() + DAY_IN_MS);

  return {
    days: { from: firstDay, to: dayAfter },
    instants: {
      from: startOfLocalDay(from, timeZone),
      to: startOfLocalDay(toIsoDate(dayAfter), timeZone),
    },
  };
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

/** The instant a calendar day starts in `timeZone` (`YYYY-MM-DD`). */
export function startOfLocalDay(isoDate: string, timeZone: string): Date {
  const utcMidnight = fromIsoDate(isoDate).getTime();

  // The offset is read at the guess itself, because the zone may change its
  // offset between UTC midnight and local midnight (daylight saving time).
  const first = utcMidnight - offsetMs(timeZone, new Date(utcMidnight));
  const second = utcMidnight - offsetMs(timeZone, new Date(first));

  return new Date(second);
}

/** How far the local clock is ahead of UTC at `at`, in milliseconds. */
function offsetMs(timeZone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find(item => item.type === type)?.value);

  const localAsUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );

  return localAsUtc - Math.floor(at.getTime() / 1000) * 1000;
}
