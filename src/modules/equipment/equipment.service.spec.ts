import { Prisma } from '@prisma/client';

import { EquipmentService } from './equipment.service';

const { Decimal } = Prisma;

describe('EquipmentService depreciation', () => {
  it('accumulates one full month of straight-line depreciation', async () => {
    const today = new Date();
    const acquisitionDate = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1),
    );
    const repository = {
      findById: jest.fn().mockResolvedValue({
        id: 'equipment-1',
        userId: 'user-1',
        supplierId: null,
        name: 'Diagnostic device',
        purchaseValue: new Decimal(1200),
        salvageValue: new Decimal(0),
        acquisitionDate,
        usefulLifeMonths: 12,
        notes: null,
        active: true,
        createdAt: today,
        updatedAt: today,
        deletedAt: null,
      }),
    };
    const service = new EquipmentService(repository as never);

    const result = await service.findOne('equipment-1', 'user-1');

    expect(result.monthlyDepreciation).toBe(100);
    expect(result.accumulatedDepreciation).toBe(100);
    expect(result.currentBookValue).toBe(1100);
    expect(result.currentValue).toBe(1100);
    expect(result.usefulLifeUsedPct).toBeCloseTo(100 / 12);
    expect(result.endOfLife).toBe(false);
  });
});
