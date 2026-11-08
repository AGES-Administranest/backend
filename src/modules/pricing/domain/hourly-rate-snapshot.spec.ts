import {
  parseYearMonth,
  snapshotWriteFor,
  YEAR_MONTH_PATTERN,
} from './hourly-rate-snapshot';

describe('snapshotWriteFor', () => {
  const now = new Date('2026-10-19T20:42:00.000Z');

  it.each([
    ['the current month', 2026, 10, 'REPLACE'],
    ['the month before', 2026, 9, 'KEEP_EXISTING'],
    ['the same month a year earlier', 2025, 10, 'KEEP_EXISTING'],
    ['a later month of an earlier year', 2025, 12, 'KEEP_EXISTING'],
    ['the month after', 2026, 11, 'SKIP'],
    ['an earlier month of a later year', 2027, 1, 'SKIP'],
  ])('answers %s (%i-%i) with %s', (_case, year, month, expected) => {
    expect(snapshotWriteFor({ year, month }, now)).toBe(expected);
  });

  it.each([
    // 21:30 on 31 December in Brasília is already January in UTC
    ['2026-01-01T00:30:00.000Z', { year: 2026, month: 1 }, 'REPLACE'],
    ['2026-01-01T00:30:00.000Z', { year: 2025, month: 12 }, 'KEEP_EXISTING'],
    ['2025-12-31T23:59:59.999Z', { year: 2025, month: 12 }, 'REPLACE'],
    ['2025-12-31T23:59:59.999Z', { year: 2026, month: 1 }, 'SKIP'],
  ])('reads the month in UTC at %s', (instant, period, expected) => {
    expect(snapshotWriteFor(period, new Date(instant))).toBe(expected);
  });
});

describe('YEAR_MONTH_PATTERN', () => {
  it.each(['2000-01', '2026-10', '2100-12'])('accepts %s', value => {
    expect(YEAR_MONTH_PATTERN.test(value)).toBe(true);
  });

  it.each([
    '1999-12',
    '2101-01',
    '2026-00',
    '2026-13',
    '2026-1',
    '2026/10',
    '2026-10-01',
    '202610',
    ' 2026-10',
  ])('refuses %p', value => {
    expect(YEAR_MONTH_PATTERN.test(value)).toBe(false);
  });
});

describe('parseYearMonth', () => {
  it('reads the year and the month as numbers', () => {
    expect(parseYearMonth('2026-03')).toEqual({ year: 2026, month: 3 });
  });
});
