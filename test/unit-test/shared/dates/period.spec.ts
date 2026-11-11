import {
  periodFromIsoDates,
  startOfLocalDay,
} from '../../../../src/shared/dates/period';
import { DomainError } from '../../../../src/shared/errors/domain-error';

describe('periodFromIsoDates', () => {
  it('reads `@db.Date` columns at UTC midnight and includes both days', () => {
    const { days } = periodFromIsoDates('2026-10-01', '2026-10-31');

    expect(days.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(days.to.toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });

  it('reads instants at local midnight in Brasília (UTC-3)', () => {
    const { instants } = periodFromIsoDates('2026-10-01', '2026-10-31');

    expect(instants.from.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(instants.to.toISOString()).toBe('2026-11-01T03:00:00.000Z');
  });

  it('keeps an evening appointment on its local day', () => {
    // 21:00 on 31 October in Brasília is already 1 November in UTC.
    const evening = new Date('2026-11-01T00:00:00.000Z');
    const { instants, days } = periodFromIsoDates('2026-10-01', '2026-10-31');

    expect(evening >= instants.from && evening < instants.to).toBe(true);
    expect(evening >= days.from && evening < days.to).toBe(false);
  });

  it('accepts a single-day period', () => {
    const { days, instants } = periodFromIsoDates('2026-10-15', '2026-10-15');

    expect(days.to.getTime() - days.from.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(instants.to.getTime() - instants.from.getTime()).toBe(
      24 * 60 * 60 * 1000,
    );
  });

  it('rejects `from` after `to` with REPORT_PERIOD_INVALID', () => {
    let thrown: unknown;
    try {
      periodFromIsoDates('2026-10-31', '2026-10-01');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(DomainError);
    expect(thrown).toMatchObject({
      kind: 'INVALID_INPUT',
      code: 'REPORT_PERIOD_INVALID',
      details: { from: '2026-10-31', to: '2026-10-01' },
    });
  });
});

describe('startOfLocalDay', () => {
  it('is UTC midnight for the UTC zone', () => {
    expect(startOfLocalDay('2026-10-01', 'UTC').toISOString()).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });

  it('follows a zone that changes its offset (daylight saving time)', () => {
    // New York: UTC-5 until 8 March 2026, UTC-4 from that day on.
    expect(
      startOfLocalDay('2026-03-07', 'America/New_York').toISOString(),
    ).toBe('2026-03-07T05:00:00.000Z');
    expect(
      startOfLocalDay('2026-03-09', 'America/New_York').toISOString(),
    ).toBe('2026-03-09T04:00:00.000Z');
  });

  it('gives a 23-hour day when the clock moves forward', () => {
    const start = startOfLocalDay('2026-03-08', 'America/New_York');
    const next = startOfLocalDay('2026-03-09', 'America/New_York');

    expect((next.getTime() - start.getTime()) / (60 * 60 * 1000)).toBe(23);
  });
});
