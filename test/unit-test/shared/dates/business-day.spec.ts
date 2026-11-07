import {
  startOfBusinessDay,
  startOfNextBusinessDay,
} from '../../../../src/shared/dates/business-day';

describe('business day bounds', () => {
  it('starts the day at midnight in São Paulo, not in UTC', () => {
    expect(startOfBusinessDay('2026-11-01').toISOString()).toBe(
      '2026-11-01T03:00:00.000Z',
    );
  });

  it('ends the day when the next one starts', () => {
    expect(startOfNextBusinessDay('2026-10-31').toISOString()).toBe(
      '2026-11-01T03:00:00.000Z',
    );
  });

  it('keeps a late appointment on its local day, even if UTC already turned', () => {
    const lateOnOctober31 = new Date('2026-10-31T22:00:00.000-03:00');

    expect(lateOnOctober31.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect(lateOnOctober31.getTime()).toBeLessThan(
      startOfNextBusinessDay('2026-10-31').getTime(),
    );
    expect(lateOnOctober31.getTime()).toBeLessThan(
      startOfBusinessDay('2026-11-01').getTime(),
    );
  });

  it('crosses the end of a year', () => {
    expect(startOfNextBusinessDay('2026-12-31').toISOString()).toBe(
      '2027-01-01T03:00:00.000Z',
    );
  });
});
