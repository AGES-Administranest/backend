import { Prisma } from '@prisma/client';

import { QueryHourlyRateDto } from '../../../src/modules/pricing/dto/query-hourly-rate.dto';
import { HourlyRateService } from '../../../src/modules/pricing/hourly-rate.service';
import { DomainError } from '../../../src/shared/errors/domain-error';

const dec = (value: string) => new Prisma.Decimal(value);
const query = (plain: Partial<QueryHourlyRateDto> = {}) =>
  Object.assign(new QueryHourlyRateDto(), plain);

describe('HourlyRateService', () => {
  let pricingSettings: { find: jest.Mock };
  let fixedCosts: { getMonthlyCosts: jest.Mock };
  let snapshots: { save: jest.Mock };
  let service: HourlyRateService;

  beforeEach(() => {
    pricingSettings = {
      find: jest.fn().mockResolvedValue({
        monthlyIncomeGoal: 8000,
        weeklyHours: 30,
        safetyMarginPct: 20,
        updatedAt: new Date('2026-10-12T19:40:18.201Z'),
      }),
    };
    // October in the US20 prototype
    fixedCosts = {
      getMonthlyCosts: jest.fn().mockResolvedValue({
        professionalExpenses: dec('1225'),
        personalExpenses: dec('860'),
        depreciation: dec('189.08'),
        transport: dec('350'),
      }),
    };
    snapshots = { save: jest.fn().mockResolvedValue({}) };
    service = new HourlyRateService(
      pricingSettings as never,
      fixedCosts as never,
      snapshots as never,
    );
  });

  it('returns the hour value and each part as 2-place strings', async () => {
    const { calculatedAt, ...result } = await service.calculate(
      'user-1',
      query({ month: 10, year: 2026 }),
    );

    expect(calculatedAt).toBeInstanceOf(Date);
    expect(result).toEqual({
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
    });
  });

  it('counts personal expenses, depreciation and transport as fixed costs', async () => {
    const { items } = await service.calculate('user-1', query());

    // 860 + 189.08 + 350; professional expenses stay apart as variable
    expect(items[0]).toMatchObject({ key: 'FIXED_COSTS', amount: '1399.08' });
    expect(items[1]).toMatchObject({
      key: 'VARIABLE_COSTS',
      amount: '1225.00',
    });
  });

  it('reads the costs of the requested month for the user', async () => {
    await service.calculate('user-1', query({ month: 3, year: 2026 }));

    expect(pricingSettings.find).toHaveBeenCalledWith('user-1');
    expect(fixedCosts.getMonthlyCosts).toHaveBeenCalledWith(
      'user-1',
      2026,
      3,
      expect.any(Date),
    );
  });

  it('uses the current UTC month when month and year are absent', async () => {
    const before = new Date();
    const result = await service.calculate('user-1', query());

    expect(result.month).toBe(before.getUTCMonth() + 1);
    expect(result.year).toBe(before.getUTCFullYear());
    expect(fixedCosts.getMonthlyCosts).toHaveBeenCalledWith(
      'user-1',
      before.getUTCFullYear(),
      before.getUTCMonth() + 1,
      result.calculatedAt,
    );
  });

  it('stamps calculatedAt with the time of the request', async () => {
    const before = Date.now();
    const { calculatedAt } = await service.calculate('user-1', query());

    expect(calculatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(calculatedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('answers the US19 404 and reads no costs while the goals are not saved', async () => {
    const notConfigured = new DomainError(
      'NOT_FOUND',
      'PRICING_SETTINGS_NOT_FOUND',
      'Pricing settings are not configured yet',
    );
    pricingSettings.find.mockRejectedValue(notConfigured);

    await expect(service.calculate('user-1', query())).rejects.toBe(
      notConfigured,
    );
    expect(fixedCosts.getMonthlyCosts).not.toHaveBeenCalled();
    expect(snapshots.save).not.toHaveBeenCalled();
  });

  it('still answers the hour value, from the goals alone, in a month without costs', async () => {
    fixedCosts.getMonthlyCosts.mockResolvedValue({
      professionalExpenses: dec('0'),
      personalExpenses: dec('0'),
      depreciation: dec('0'),
      transport: dec('0'),
    });

    const result = await service.calculate('user-1', query());

    expect(result.items.map(item => item.amount)).toEqual([
      '0.00',
      '0.00',
      '8000.00',
      '1600.00',
    ]);
    // 9600 ÷ 130
    expect(result.hourlyRate).toBe('73.85');
    expect(result.minimumHourlyRate).toBe('61.54');
  });

  it('makes the percentages add up to 100.00', async () => {
    pricingSettings.find.mockResolvedValue({
      monthlyIncomeGoal: 7333.33,
      weeklyHours: 37.5,
      safetyMarginPct: 12.5,
      updatedAt: new Date(),
    });

    const { items } = await service.calculate('user-1', query());
    const hundredths = items.reduce(
      (total, item) => total + Math.round(Number(item.percentOfTotal) * 100),
      0,
    );

    expect(hundredths).toBe(10_000);
  });

  describe('calculateWithoutStoring', () => {
    it.each([
      ['the current month', {}],
      ['a past month', { month: 9, year: 2025 }],
    ])(
      'answers %s like calculate, and stores nothing',
      async (_case, plain) => {
        const stored = await service.calculate('user-1', query(plain));
        snapshots.save.mockClear();

        const { calculatedAt, ...result } =
          await service.calculateWithoutStoring('user-1', query(plain));

        const expected: Partial<typeof stored> = { ...stored };
        delete expected.calculatedAt;
        expect(result).toEqual(expected);
        expect(calculatedAt).toBeInstanceOf(Date);
        expect(snapshots.save).not.toHaveBeenCalled();
      },
    );

    it('answers the US19 404 while the goals are not saved', async () => {
      pricingSettings.find.mockRejectedValue(
        new DomainError('NOT_FOUND', 'PRICING_SETTINGS_NOT_FOUND', 'no goals'),
      );

      await expect(
        service.calculateWithoutStoring('user-1', query()),
      ).rejects.toMatchObject({ code: 'PRICING_SETTINGS_NOT_FOUND' });
      expect(fixedCosts.getMonthlyCosts).not.toHaveBeenCalled();
      expect(snapshots.save).not.toHaveBeenCalled();
    });
  });

  describe('history snapshot (US22)', () => {
    const NOW = new Date('2026-10-19T20:42:00.000Z');

    beforeEach(() => {
      jest.useFakeTimers({ now: NOW });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('stores what it answered, with the goals it used', async () => {
      const response = await service.calculate(
        'user-1',
        query({ month: 10, year: 2026 }),
      );

      expect(snapshots.save).toHaveBeenCalledTimes(1);
      const [snapshot] = snapshots.save.mock.calls[0] as [
        Record<string, unknown>,
      ];
      const asStrings = Object.fromEntries(
        Object.entries(snapshot).map(([key, value]) => [
          key,
          value instanceof Prisma.Decimal ? value.toFixed(2) : value,
        ]),
      );
      expect(asStrings).toEqual({
        userId: 'user-1',
        year: 2026,
        month: 10,
        hourlyRate: response.hourlyRate,
        fixedCosts: '1399.08',
        variableCosts: '1225.00',
        ownerDraw: '8000.00',
        safetyMargin: '2124.82',
        monthlyIncomeGoal: '8000.00',
        weeklyHours: '30.00',
        safetyMarginPct: '20.00',
        calculatedAt: response.calculatedAt,
      });
      expect(response.calculatedAt).toEqual(NOW);
    });

    it.each([
      ['the current month', {}],
      ['the current month, named', { month: 10, year: 2026 }],
    ])('replaces the stored snapshot for %s', async (_case, plain) => {
      await service.calculate('user-1', query(plain));

      expect(snapshots.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', year: 2026, month: 10 }),
        { replace: true },
      );
    });

    it.each([
      ['the month before', { month: 9, year: 2026 }],
      ['December of the year before', { month: 12, year: 2025 }],
    ])(
      'stores %s only if it has no snapshot yet',
      async (_case, plain: { month: number; year: number }) => {
        await service.calculate('user-1', query(plain));

        expect(snapshots.save).toHaveBeenCalledWith(
          expect.objectContaining({ year: plain.year, month: plain.month }),
          { replace: false },
        );
      },
    );

    it.each([
      ['the month after', { month: 11, year: 2026 }],
      ['a month of the next year', { month: 1, year: 2027 }],
    ])('does not store %s', async (_case, plain) => {
      const result = await service.calculate('user-1', query(plain));

      expect(result.hourlyRate).toBe('98.07');
      expect(snapshots.save).not.toHaveBeenCalled();
    });

    it('records the current month when the goals are saved', async () => {
      let listener: ((userId: string) => Promise<void>) | undefined;
      const settings = {
        ...pricingSettings,
        onGoalsSaved: jest.fn((registered: typeof listener) => {
          listener = registered;
        }),
      };
      service = new HourlyRateService(
        settings as never,
        fixedCosts as never,
        snapshots as never,
      );

      service.onModuleInit();
      await listener?.('user-1');

      expect(settings.onGoalsSaved).toHaveBeenCalledTimes(1);
      expect(fixedCosts.getMonthlyCosts).toHaveBeenCalledWith(
        'user-1',
        2026,
        10,
        NOW,
      );
      expect(snapshots.save).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', year: 2026, month: 10 }),
        { replace: true },
      );
    });
  });
});
