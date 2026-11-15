import { ReportContext } from '../../../../src/modules/reports/general-report/report-context';

describe('ReportContext', () => {
  it('reads appointment instants in Brasília and trip days as dates', () => {
    const context = new ReportContext('user-1', '2026-10-15', '2026-11-14', {
      monthlyDepreciation: jest.fn(),
    } as never);

    expect(context.appointmentPeriod).toEqual({
      from: new Date('2026-10-15T03:00:00.000Z'),
      before: new Date('2026-11-15T03:00:00.000Z'),
    });
    expect(context.tripPeriod).toEqual({
      from: new Date('2026-10-15T00:00:00.000Z'),
      to: new Date('2026-11-14T00:00:00.000Z'),
    });
  });

  it('prorates each month by its real days and computes it only once', async () => {
    const monthlyDepreciation = jest
      .fn()
      .mockResolvedValueOnce(155)
      .mockResolvedValueOnce(90);
    const context = new ReportContext('user-1', '2026-10-15', '2026-11-14', {
      monthlyDepreciation,
    } as never);

    const first = await context.depreciation();
    const second = await context.depreciation();

    expect(second).toBe(first);
    expect(monthlyDepreciation).toHaveBeenCalledTimes(2);
    expect(monthlyDepreciation).toHaveBeenNthCalledWith(1, 'user-1', 2026, 10);
    expect(monthlyDepreciation).toHaveBeenNthCalledWith(2, 'user-1', 2026, 11);
    expect(first.map(month => month.amount.toFixed(2))).toEqual([
      '85.00', // 155 × 17/31
      '42.00', // 90 × 14/30
    ]);
  });
});
