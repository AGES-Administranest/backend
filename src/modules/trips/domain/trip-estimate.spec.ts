import { Prisma } from '@prisma/client';

import { averageDailyCost } from './trip-estimate';

const days = (...totals: string[]) =>
  totals.map(total => new Prisma.Decimal(total));

describe('averageDailyCost', () => {
  it.each([
    [['65.8'], '65.8'],
    [['65.8', '32.9'], '49.35'],
    [['10', '20', '30'], '20'],
    // 100 / 3 at full precision: the caller rounds once, on the way out.
    [['100', '0', '0'], '33.333333333333333333'],
  ])('averages the daily totals %j as %s', (totals, expected) => {
    const estimate = averageDailyCost(days(...totals));

    expect(estimate.available).toBe(true);
    expect(estimate.days).toBe(totals.length);
    expect(estimate.costPerDay.toString()).toBe(expected);
  });

  it('counts a day whose trips cost nothing', () => {
    expect(averageDailyCost(days('40', '0')).costPerDay.toString()).toBe('20');
  });

  it('is not available without days to learn from', () => {
    const estimate = averageDailyCost([]);

    expect(estimate).toMatchObject({ available: false, days: 0 });
    expect(estimate.costPerDay.toString()).toBe('0');
  });
});
