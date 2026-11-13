import { Prisma } from '@prisma/client';

import { CostsSectionBuilder } from '../../../../src/modules/reports/general-report/costs-section.builder';
import { ReportContext } from '../../../../src/modules/reports/general-report/report-context';
import { DomainError } from '../../../../src/shared/errors/domain-error';

const d = (value: string | number) => new Prisma.Decimal(value);

const settingsNotFound = () =>
  new DomainError(
    'NOT_FOUND',
    'PRICING_SETTINGS_NOT_FOUND',
    'Pricing settings not found',
  );

describe('CostsSectionBuilder', () => {
  const build = () => {
    const trips = { totalsInPeriod: jest.fn() };
    const hourlyRate = { calculateWithoutStoring: jest.fn() };
    const hourlyRateHistory = { list: jest.fn().mockResolvedValue([]) };
    const builder = new CostsSectionBuilder(
      trips as never,
      hourlyRate as never,
      hourlyRateHistory as never,
    );
    return { builder, trips, hourlyRate, hourlyRateHistory };
  };

  const contextFor = (from: string, to: string, monthly: number[] = []) => {
    const monthlyDepreciation = jest.fn();
    monthly.forEach(value => monthlyDepreciation.mockResolvedValueOnce(value));
    return new ReportContext('user-1', from, to, {
      monthlyDepreciation,
    } as never);
  };

  describe('tripsSection', () => {
    it('adds up the trips of the period', async () => {
      const { builder, trips } = build();
      trips.totalsInPeriod.mockResolvedValue({
        count: 9,
        distanceKm: d('312.4'),
        cost: d('210'),
      });
      const context = contextFor('2026-10-01', '2026-10-31');

      expect(await builder.tripsSection(context)).toEqual({
        type: 'TRIPS',
        empty: false,
        count: 9,
        distanceKm: '312.40',
        cost: '210.00',
      });
      expect(trips.totalsInPeriod).toHaveBeenCalledWith(
        'user-1',
        context.tripPeriod,
      );
    });

    it('is empty without trips', async () => {
      const { builder, trips } = build();
      trips.totalsInPeriod.mockResolvedValue({
        count: 0,
        distanceKm: d(0),
        cost: d(0),
      });
      expect(
        (await builder.tripsSection(contextFor('2026-10-01', '2026-10-31')))
          .empty,
      ).toBe(true);
    });
  });

  describe('depreciationSection', () => {
    it('shows each month prorated by its real days', async () => {
      const { builder } = build();
      const section = await builder.depreciationSection(
        contextFor('2026-10-15', '2026-11-14', [155, 90]),
      );

      expect(section).toEqual({
        type: 'DEPRECIATION',
        empty: false,
        months: [
          {
            year: 2026,
            month: 10,
            days: 17,
            daysInMonth: 31,
            monthlyDepreciation: '155.00',
            amount: '85.00',
          },
          {
            year: 2026,
            month: 11,
            days: 14,
            daysInMonth: 30,
            monthlyDepreciation: '90.00',
            amount: '42.00',
          },
        ],
        total: '127.00',
      });
    });

    it('is empty when nothing depreciates', async () => {
      const { builder } = build();
      const section = await builder.depreciationSection(
        contextFor('2026-10-01', '2026-10-31', [0]),
      );
      expect(section).toMatchObject({ empty: true, total: '0.00' });
    });
  });

  describe('hourlyRateSection', () => {
    beforeEach(() => {
      jest.useFakeTimers({ now: new Date('2026-11-11T15:00:00Z') });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it('reads past months from the history and calculates the current one', async () => {
      const { builder, hourlyRate, hourlyRateHistory } = build();
      hourlyRateHistory.list.mockResolvedValue([
        { year: 2026, month: 9, hourlyRate: '180.00' },
        { year: 2026, month: 11, hourlyRate: '150.00' },
      ]);
      hourlyRate.calculateWithoutStoring
        .mockResolvedValueOnce({ hourlyRate: '182.40' }) // October, never stored
        .mockResolvedValueOnce({ hourlyRate: '190.00' }); // November, current

      const section = await builder.hourlyRateSection(
        contextFor('2026-09-10', '2026-11-05'),
      );

      expect(hourlyRateHistory.list).toHaveBeenCalledWith('user-1', {
        from: '2026-09',
        to: '2026-11',
      });
      expect(hourlyRate.calculateWithoutStoring.mock.calls).toEqual([
        ['user-1', { year: 2026, month: 10 }],
        ['user-1', { year: 2026, month: 11 }],
      ]);
      expect(section).toEqual({
        type: 'HOURLY_RATE',
        empty: false,
        months: [
          { year: 2026, month: 9, hourlyRate: '180.00', source: 'HISTORY' },
          { year: 2026, month: 10, hourlyRate: '182.40', source: 'CALCULATED' },
          { year: 2026, month: 11, hourlyRate: '190.00', source: 'CALCULATED' },
        ],
        notice: null,
      });
    });

    it('says why the months are empty when the goals were never saved', async () => {
      const { builder, hourlyRate } = build();
      hourlyRate.calculateWithoutStoring.mockRejectedValue(settingsNotFound());

      const section = await builder.hourlyRateSection(
        contextFor('2026-09-01', '2026-10-31'),
      );

      // After the first refusal, the other months are not even tried.
      expect(hourlyRate.calculateWithoutStoring).toHaveBeenCalledTimes(1);
      expect(section).toEqual({
        type: 'HOURLY_RATE',
        empty: true,
        months: [
          { year: 2026, month: 9, hourlyRate: null, source: null },
          { year: 2026, month: 10, hourlyRate: null, source: null },
        ],
        notice: 'PRICING_SETTINGS_NOT_FOUND',
      });
    });

    it('falls back to the stored current month when the goals are gone', async () => {
      const { builder, hourlyRate, hourlyRateHistory } = build();
      hourlyRateHistory.list.mockResolvedValue([
        { year: 2026, month: 11, hourlyRate: '150.00' },
      ]);
      hourlyRate.calculateWithoutStoring.mockRejectedValue(settingsNotFound());

      const section = await builder.hourlyRateSection(
        contextFor('2026-11-01', '2026-11-30'),
      );

      expect(section).toMatchObject({
        empty: false,
        months: [
          { year: 2026, month: 11, hourlyRate: '150.00', source: 'HISTORY' },
        ],
        notice: 'PRICING_SETTINGS_NOT_FOUND',
      });
    });

    it('lets any other error through', async () => {
      const { builder, hourlyRate } = build();
      hourlyRate.calculateWithoutStoring.mockRejectedValue(
        new Error('database down'),
      );

      await expect(
        builder.hourlyRateSection(contextFor('2026-10-01', '2026-10-31')),
      ).rejects.toThrow('database down');
    });
  });
});
