import { Prisma } from '@prisma/client';

import { FixedCostsService } from './fixed-costs.service';
import { EquipmentService } from '../equipment';
import { FinancialEntryService } from '../financial';

const decimal = (value: string) => new Prisma.Decimal(value);

describe('FixedCostsService.getMonthlyCosts', () => {
  it('reports the trips as transport and takes them out of the professional expenses', async () => {
    const entries = {
      sumExpensesByScope: jest.fn().mockResolvedValue({
        professional: decimal('500'),
        personal: decimal('300'),
      }),
      sumTripExpenses: jest.fn().mockResolvedValue(decimal('120')),
    };
    const equipment = { monthlyDepreciation: jest.fn().mockResolvedValue(80) };
    const service = new FixedCostsService(
      entries as unknown as FinancialEntryService,
      equipment as unknown as EquipmentService,
    );

    const costs = await service.getMonthlyCosts('user-1', 2026, 10);

    expect(costs.transport.toFixed(2)).toBe('120.00');
    expect(costs.professionalExpenses.toFixed(2)).toBe('380.00');
    expect(costs.personalExpenses.toFixed(2)).toBe('300.00');
    expect(costs.depreciation.toFixed(2)).toBe('80.00');
  });
});
