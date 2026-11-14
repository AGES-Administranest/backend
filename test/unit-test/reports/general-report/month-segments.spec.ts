import { Prisma } from '@prisma/client';

import {
  monthSegments,
  prorate,
} from '../../../../src/modules/reports/domain/month-segments';

describe('monthSegments', () => {
  it('splits a period that crosses a month into its two parts', () => {
    expect(monthSegments('2026-10-15', '2026-11-14')).toEqual([
      {
        year: 2026,
        month: 10,
        from: '2026-10-15',
        to: '2026-10-31',
        days: 17,
        daysInMonth: 31,
      },
      {
        year: 2026,
        month: 11,
        from: '2026-11-01',
        to: '2026-11-14',
        days: 14,
        daysInMonth: 30,
      },
    ]);
  });

  it('keeps a whole month whole', () => {
    expect(monthSegments('2026-02-01', '2026-02-28')).toEqual([
      expect.objectContaining({ month: 2, days: 28, daysInMonth: 28 }),
    ]);
  });

  it('knows February of a leap year', () => {
    expect(monthSegments('2028-02-10', '2028-02-29')[0]).toMatchObject({
      days: 20,
      daysInMonth: 29,
    });
  });

  it('covers a single day', () => {
    expect(monthSegments('2026-10-31', '2026-10-31')).toEqual([
      expect.objectContaining({
        from: '2026-10-31',
        to: '2026-10-31',
        days: 1,
      }),
    ]);
  });

  it('crosses the year', () => {
    expect(
      monthSegments('2026-12-20', '2027-02-05').map(s => [s.year, s.month]),
    ).toEqual([
      [2026, 12],
      [2027, 1],
      [2027, 2],
    ]);
  });
});

describe('prorate', () => {
  const monthly = new Prisma.Decimal('155.00');

  it('takes the share of the real days of the month', () => {
    // 155 × 17 / 31 = 85
    expect(prorate(monthly, { days: 17, daysInMonth: 31 }).toFixed(2)).toBe(
      '85.00',
    );
    // 155 × 14 / 30 = 72.333… → 72.33
    expect(prorate(monthly, { days: 14, daysInMonth: 30 }).toFixed(2)).toBe(
      '72.33',
    );
  });

  it('gives 100% for a whole month of any length', () => {
    for (const daysInMonth of [28, 29, 30, 31]) {
      expect(
        prorate(monthly, { days: daysInMonth, daysInMonth }).toFixed(2),
      ).toBe('155.00');
    }
  });

  it('rounds half up to cents', () => {
    // 0.05 × 1 / 2 = 0.025 → 0.03
    expect(
      prorate(new Prisma.Decimal('0.05'), { days: 1, daysInMonth: 2 }).toFixed(
        2,
      ),
    ).toBe('0.03');
  });
});
