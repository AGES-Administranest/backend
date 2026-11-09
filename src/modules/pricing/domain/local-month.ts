/**
 * The calendar month a moment falls in, in a given time zone. No Nest, no
 * Prisma Client.
 *
 * The month in UTC turns three hours early for Brasília: from 21:00 on the
 * last day of a month, UTC is already in the next one, which has almost no
 * expenses recorded yet.
 */
export interface CalendarMonth {
  year: number;
  /** 1 to 12. */
  month: number;
}

export function monthIn(timeZone: string, at: Date): CalendarMonth {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(at);
  const part = (type: 'year' | 'month') =>
    Number(parts.find(item => item.type === type)?.value);

  return { year: part('year'), month: part('month') };
}
