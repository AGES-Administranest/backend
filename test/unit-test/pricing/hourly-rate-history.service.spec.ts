import { HourlyRateSnapshot, Prisma } from '@prisma/client';

import { QueryHourlyRateHistoryDto } from '../../../src/modules/pricing/dto/query-hourly-rate-history.dto';
import { HourlyRateHistoryService } from '../../../src/modules/pricing/hourly-rate-history.service';
import { DomainError } from '../../../src/shared/errors/domain-error';

const dec = (value: string) => new Prisma.Decimal(value);
const CALCULATED_AT = new Date('2026-10-19T20:42:00.000Z');

/** October in the US20 prototype, as the table stores it. */
const october = (
  overrides: Partial<HourlyRateSnapshot> = {},
): HourlyRateSnapshot => ({
  id: 'snapshot-1',
  userId: 'user-1',
  year: 2026,
  month: 10,
  hourlyRate: dec('98.07'),
  fixedCosts: dec('1399.08'),
  variableCosts: dec('1225'),
  ownerDraw: dec('8000'),
  safetyMargin: dec('2124.82'),
  monthlyIncomeGoal: dec('8000'),
  weeklyHours: dec('30'),
  safetyMarginPct: dec('20'),
  calculatedAt: CALCULATED_AT,
  ...overrides,
});

const query = (plain: Partial<QueryHourlyRateHistoryDto> = {}) =>
  Object.assign(new QueryHourlyRateHistoryDto(), plain);

describe('HourlyRateHistoryService', () => {
  let snapshots: { findInRange: jest.Mock; findMonth: jest.Mock };
  let service: HourlyRateHistoryService;

  beforeEach(() => {
    snapshots = {
      findInRange: jest.fn().mockResolvedValue([]),
      findMonth: jest.fn().mockResolvedValue(october()),
    };
    service = new HourlyRateHistoryService(snapshots as never);
  });

  describe('list', () => {
    it('answers each stored month with its hour value as a 2-place string', async () => {
      snapshots.findInRange.mockResolvedValue([
        {
          year: 2026,
          month: 10,
          hourlyRate: dec('98.07'),
          calculatedAt: CALCULATED_AT,
        },
        {
          year: 2026,
          month: 9,
          hourlyRate: dec('90.5'),
          calculatedAt: CALCULATED_AT,
        },
      ]);

      await expect(service.list('user-1', query())).resolves.toEqual([
        {
          year: 2026,
          month: 10,
          hourlyRate: '98.07',
          calculatedAt: CALCULATED_AT,
        },
        {
          year: 2026,
          month: 9,
          hourlyRate: '90.50',
          calculatedAt: CALCULATED_AT,
        },
      ]);
    });

    it('reads only the caller, within the months asked for', async () => {
      await service.list('user-1', query({ from: '2025-11', to: '2026-03' }));

      expect(snapshots.findInRange).toHaveBeenCalledWith(
        'user-1',
        { year: 2025, month: 11 },
        { year: 2026, month: 3 },
      );
    });

    it('leaves a missing bound open', async () => {
      await service.list('user-1', query({ to: '2026-03' }));

      expect(snapshots.findInRange).toHaveBeenCalledWith('user-1', undefined, {
        year: 2026,
        month: 3,
      });
    });

    it('accepts from equal to to: a single month', async () => {
      await service.list('user-1', query({ from: '2026-03', to: '2026-03' }));

      expect(snapshots.findInRange).toHaveBeenCalled();
    });

    it.each([
      ['2026-04', '2026-03'],
      ['2027-01', '2026-12'],
    ])('refuses from %s after to %s', async (from, to) => {
      const error = await service
        .list('user-1', query({ from, to }))
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        kind: 'INVALID_INPUT',
        code: 'VALIDATION_ERROR',
        details: { fields: ['from must not be after to'] },
      });
      expect(snapshots.findInRange).not.toHaveBeenCalled();
    });
  });

  describe('findMonth', () => {
    it('answers the stored month in the shape of GET /pricing/hourly-rate, plus its goals', async () => {
      await expect(
        service.findMonth('user-1', { year: 2026, month: 10 }),
      ).resolves.toEqual({
        month: 10,
        year: 2026,
        items: [
          {
            key: 'FIXED_COSTS',
            label: 'Fixed costs',
            amount: '1399.08',
            percentOfTotal: '10.97',
          },
          {
            key: 'VARIABLE_COSTS',
            label: 'Variable costs',
            amount: '1225.00',
            percentOfTotal: '9.61',
          },
          {
            key: 'OWNER_DRAW',
            label: "Owner's draw",
            amount: '8000.00',
            percentOfTotal: '62.75',
          },
          {
            key: 'SAFETY_MARGIN',
            label: 'Safety margin',
            amount: '2124.82',
            percentOfTotal: '16.67',
          },
        ],
        total: '12748.90',
        productiveHours: '130.00',
        hourlyRate: '98.07',
        minimumHourlyRate: '81.72',
        calculatedAt: CALCULATED_AT,
        parameters: {
          monthlyIncomeGoal: '8000.00',
          weeklyHours: '30.00',
          safetyMarginPct: '20.00',
        },
      });
      expect(snapshots.findMonth).toHaveBeenCalledWith('user-1', {
        year: 2026,
        month: 10,
      });
    });

    it('answers the stored parts, not a recalculation with the stored goals', async () => {
      // A margin amount that 20% of the base would not give: the row wins.
      snapshots.findMonth.mockResolvedValue(
        october({ safetyMargin: dec('1000'), hourlyRate: dec('89.42') }),
      );

      const month = await service.findMonth('user-1', {
        year: 2026,
        month: 10,
      });

      expect(month.items[3].amount).toBe('1000.00');
      expect(month.total).toBe('11624.08');
      expect(month.hourlyRate).toBe('89.42');
    });

    it('answers 404 HOURLY_RATE_SNAPSHOT_NOT_FOUND for a month without a snapshot', async () => {
      snapshots.findMonth.mockResolvedValue(null);

      const error = await service
        .findMonth('user-1', { year: 2026, month: 3 })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        kind: 'NOT_FOUND',
        code: 'HOURLY_RATE_SNAPSHOT_NOT_FOUND',
      });
    });
  });
});
