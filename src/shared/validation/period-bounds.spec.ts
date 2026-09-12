import { isDateOnly, toPeriodEnd, toPeriodStart } from './period-bounds';

describe('period bounds', () => {
  it('tells a plain date from a timestamp', () => {
    expect(isDateOnly('2026-09-30')).toBe(true);
    expect(isDateOnly('2026-09-30T10:00:00.000Z')).toBe(false);
  });

  it('reads a plain start date as the first instant of the day', () => {
    expect(toPeriodStart('2026-09-01').toISOString()).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });

  it('reads a plain end date as the last instant of the day', () => {
    expect(toPeriodEnd('2026-09-30').toISOString()).toBe(
      '2026-09-30T23:59:59.999Z',
    );
  });

  it('uses a full timestamp as it came, at either end', () => {
    const stamp = '2026-09-15T13:45:00.000Z';

    expect(toPeriodStart(stamp).toISOString()).toBe(stamp);
    expect(toPeriodEnd(stamp).toISOString()).toBe(stamp);
  });
});
