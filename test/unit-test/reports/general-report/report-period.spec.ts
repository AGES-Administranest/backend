import {
  assertReportablePeriod,
  MAX_REPORT_DAYS,
} from '../../../../src/modules/reports/domain/report-period';
import { ReportContext } from '../../../../src/modules/reports/general-report/report-context';
import { periodFromIsoDates } from '../../../../src/shared/dates/period';
import { DomainError } from '../../../../src/shared/errors/domain-error';

const check = (from: string, to: string) => () =>
  assertReportablePeriod(periodFromIsoDates(from, to), { from, to });

describe('report period limit', () => {
  it('is a year, leap day included', () => {
    expect(MAX_REPORT_DAYS).toBe(366);
  });

  it.each([
    ['a single day', '2026-10-15', '2026-10-15'],
    ['a whole year', '2026-01-01', '2026-12-31'],
    ['a leap year', '2028-01-01', '2028-12-31'],
    ['366 days across two years', '2026-07-01', '2027-07-01'],
  ])('accepts %s', (_case, from, to) => {
    expect(check(from, to)).not.toThrow();
  });

  it('refuses one day more, telling the app the limit', () => {
    let error: unknown;
    try {
      check('2026-01-01', '2027-01-02')();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({
      kind: 'INVALID_INPUT',
      code: 'REPORT_PERIOD_TOO_LONG',
      details: {
        from: '2026-01-01',
        to: '2027-01-02',
        days: 367,
        maxDays: 366,
      },
    });
  });

  it('is checked before the report reads anything', () => {
    const equipment = { monthlyDepreciation: jest.fn() };

    let error: unknown;
    try {
      new ReportContext(
        'user-1',
        '2020-01-01',
        '2026-12-31',
        equipment as never,
      );
    } catch (caught) {
      error = caught;
    }

    expect(error).toMatchObject({ code: 'REPORT_PERIOD_TOO_LONG' });
    expect(equipment.monthlyDepreciation).not.toHaveBeenCalled();
  });
});
