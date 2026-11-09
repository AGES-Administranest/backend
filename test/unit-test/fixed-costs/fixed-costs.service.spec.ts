import { Prisma } from '@prisma/client';

import { QueryFixedCostsSummaryDto } from '../../../src/modules/fixed-costs/dto/query-fixed-costs-summary.dto';
import { FixedCostsService } from '../../../src/modules/fixed-costs/fixed-costs.service';

const dec = (value: string) => new Prisma.Decimal(value);

describe('FixedCostsService', () => {
  let entries: { sumExpensesByScope: jest.Mock; sumTripExpenses: jest.Mock };
  let equipment: { monthlyDepreciation: jest.Mock };
  let service: FixedCostsService;

  beforeEach(() => {
    // The professional figure from the statement includes the 300.00 of trips.
    entries = {
      sumExpensesByScope: jest.fn().mockResolvedValue({
        professional: dec('1550'),
        personal: dec('830.5'),
      }),
      sumTripExpenses: jest.fn().mockResolvedValue(dec('300')),
    };
    equipment = { monthlyDepreciation: jest.fn().mockResolvedValue(189.08) };
    service = new FixedCostsService(entries as never, equipment as never);
  });

  it('returns the four parts as 2-place strings and their sum as the total', async () => {
    const query = Object.assign(new QueryFixedCostsSummaryDto(), {
      month: 3,
      year: 2026,
    });

    await expect(service.getSummary('user-1', query)).resolves.toEqual({
      professionalExpenses: '1250.00',
      personalExpenses: '830.50',
      depreciation: '189.08',
      transport: '300.00',
      total: '2569.58',
    });
  });

  it('asks the expenses and the trips for the requested month and the depreciation for the user', async () => {
    const query = Object.assign(new QueryFixedCostsSummaryDto(), {
      month: 3,
      year: 2026,
    });

    await service.getSummary('user-1', query);

    expect(entries.sumExpensesByScope).toHaveBeenCalledWith('user-1', 2026, 3);
    expect(entries.sumTripExpenses).toHaveBeenCalledWith('user-1', 2026, 3);
    expect(equipment.monthlyDepreciation).toHaveBeenCalledWith(
      'user-1',
      2026,
      3,
      expect.any(Date),
    );
  });

  it('uses the current UTC month when month and year are absent', async () => {
    await service.getSummary('user-1', new QueryFixedCostsSummaryDto());

    const now = new Date();
    expect(entries.sumExpensesByScope).toHaveBeenCalledWith(
      'user-1',
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
    );
    expect(entries.sumTripExpenses).toHaveBeenCalledWith(
      'user-1',
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
    );
  });

  it('reports no transport for a month without trips', async () => {
    entries.sumExpensesByScope.mockResolvedValue({
      professional: dec('1250'),
      personal: dec('830.5'),
    });
    entries.sumTripExpenses.mockResolvedValue(dec('0'));

    const summary = await service.getSummary(
      'user-1',
      new QueryFixedCostsSummaryDto(),
    );

    expect(summary.transport).toBe('0.00');
    expect(summary.professionalExpenses).toBe('1250.00');
    expect(summary.total).toBe('2269.58');
  });

  it('reports the trips as transport and takes them out of the professional expenses', async () => {
    const costs = await service.getMonthlyCosts('user-1', 2026, 3);

    expect(costs.transport.toString()).toBe('300');
    expect(costs.professionalExpenses.toString()).toBe('1250');
    expect(costs.personalExpenses.toString()).toBe('830.5');
    expect(costs.depreciation.toString()).toBe('189.08');
  });

  it('reads the depreciation as of now for the current month', async () => {
    const now = new Date(Date.UTC(2026, 9, 19, 20, 42));

    await service.getMonthlyCosts('user-1', 2026, 10, now);

    expect(equipment.monthlyDepreciation).toHaveBeenCalledWith(
      'user-1',
      2026,
      10,
      now,
    );
  });

  it('returns zeros for an empty month', async () => {
    entries.sumExpensesByScope.mockResolvedValue({
      professional: dec('0'),
      personal: dec('0'),
    });
    entries.sumTripExpenses.mockResolvedValue(dec('0'));
    equipment.monthlyDepreciation.mockResolvedValue(0);

    await expect(
      service.getSummary('user-1', new QueryFixedCostsSummaryDto()),
    ).resolves.toEqual({
      professionalExpenses: '0.00',
      personalExpenses: '0.00',
      depreciation: '0.00',
      transport: '0.00',
      total: '0.00',
    });
  });
});
