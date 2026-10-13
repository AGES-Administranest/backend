import { Prisma } from '@prisma/client';

import { QueryFixedCostsSummaryDto } from '../../../src/modules/fixed-costs/dto/query-fixed-costs-summary.dto';
import { FixedCostsService } from '../../../src/modules/fixed-costs/fixed-costs.service';

const dec = (value: string) => new Prisma.Decimal(value);

describe('FixedCostsService', () => {
  let entries: { sumExpensesByScope: jest.Mock };
  let depreciation: { getMonthlyDepreciation: jest.Mock };
  let repository: { findTransportMonthly: jest.Mock };
  let service: FixedCostsService;

  beforeEach(() => {
    entries = {
      sumExpensesByScope: jest.fn().mockResolvedValue({
        professional: dec('1250'),
        personal: dec('830.5'),
      }),
    };
    depreciation = {
      getMonthlyDepreciation: jest.fn().mockResolvedValue(dec('189.08')),
    };
    repository = {
      findTransportMonthly: jest.fn().mockResolvedValue(dec('300')),
    };
    service = new FixedCostsService(
      entries as never,
      depreciation as never,
      repository as never,
    );
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

  it('asks every source for the same user and month', async () => {
    const query = Object.assign(new QueryFixedCostsSummaryDto(), {
      month: 3,
      year: 2026,
    });

    await service.getSummary('user-1', query);

    expect(entries.sumExpensesByScope).toHaveBeenCalledWith('user-1', 2026, 3);
    expect(depreciation.getMonthlyDepreciation).toHaveBeenCalledWith(
      'user-1',
      3,
      2026,
    );
    expect(repository.findTransportMonthly).toHaveBeenCalledWith('user-1');
  });

  it('uses the current UTC month when month and year are absent', async () => {
    await service.getSummary('user-1', new QueryFixedCostsSummaryDto());

    const now = new Date();
    expect(entries.sumExpensesByScope).toHaveBeenCalledWith(
      'user-1',
      now.getUTCFullYear(),
      now.getUTCMonth() + 1,
    );
  });

  it('treats a missing pricing_settings as no transport cost', async () => {
    repository.findTransportMonthly.mockResolvedValue(null);

    const summary = await service.getSummary(
      'user-1',
      new QueryFixedCostsSummaryDto(),
    );

    expect(summary.transport).toBe('0.00');
    expect(summary.total).toBe('2269.58');
  });

  it('returns zeros for an empty month', async () => {
    entries.sumExpensesByScope.mockResolvedValue({
      professional: dec('0'),
      personal: dec('0'),
    });
    depreciation.getMonthlyDepreciation.mockResolvedValue(dec('0'));
    repository.findTransportMonthly.mockResolvedValue(null);

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
