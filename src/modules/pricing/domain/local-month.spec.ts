import { monthIn } from './local-month';

const SAO_PAULO = 'America/Sao_Paulo';

describe('monthIn', () => {
  it.each([
    // Brasília is UTC-3 all year (no daylight saving time since 2019).
    ['2026-11-18T12:00:00.000Z', 2026, 11],
    ['2026-11-30T23:59:59.000Z', 2026, 11],
    // 21:00 on 30 November in Brasília: already December in UTC.
    ['2026-12-01T00:00:00.000Z', 2026, 11],
    ['2026-12-01T02:59:59.999Z', 2026, 11],
    ['2026-12-01T03:00:00.000Z', 2026, 12],
    // The year turns three hours late too.
    ['2027-01-01T01:00:00.000Z', 2026, 12],
    ['2027-01-01T03:00:00.000Z', 2027, 1],
  ])('places %s in %i-%i in Brasília', (at, year, month) => {
    expect(monthIn(SAO_PAULO, new Date(at))).toEqual({ year, month });
  });

  it('follows the time zone it is given', () => {
    const at = new Date('2026-12-01T01:00:00.000Z');

    expect(monthIn('UTC', at)).toEqual({ year: 2026, month: 12 });
    expect(monthIn(SAO_PAULO, at)).toEqual({ year: 2026, month: 11 });
  });
});
