import { Prisma } from '@prisma/client';

import {
  DepreciableEquipment,
  MonthlyDepreciation,
  monthlyDepreciation,
} from '../../../src/modules/financial/monthly-depreciation';
import { MonthlyDepreciationRepository } from '../../../src/modules/financial/monthly-depreciation.repository';

const equipment = (
  overrides: Partial<DepreciableEquipment> = {},
): DepreciableEquipment => ({
  purchaseValue: new Prisma.Decimal('6000.00'),
  salvageValue: new Prisma.Decimal('0.00'),
  acquisitionDate: new Date('2026-03-15'),
  usefulLifeYears: 5,
  ...overrides,
});

describe('monthlyDepreciation', () => {
  it('returns 0 when the user has no equipment', () => {
    expect(monthlyDepreciation([], 10, 2026).toFixed(2)).toBe('0.00');
  });

  it('depreciates (purchase - salvage) / (years * 12) inside the useful life', () => {
    const item = equipment({ salvageValue: new Prisma.Decimal('600.00') });
    // (6000 - 600) / 60 = 90
    expect(monthlyDepreciation([item], 10, 2026).toFixed(2)).toBe('90.00');
  });

  it('contributes 0 before the month of the acquisition', () => {
    expect(monthlyDepreciation([equipment()], 2, 2026).toFixed(2)).toBe('0.00');
  });

  it('starts in the month of the acquisition, whatever the day', () => {
    const item = equipment({ acquisitionDate: new Date('2026-03-31') });
    expect(monthlyDepreciation([item], 3, 2026).toFixed(2)).toBe('100.00');
  });

  it('stops after exactly years * 12 months', () => {
    const item = equipment(); // starts 2026-03, 60 months: last one is 2031-02
    expect(monthlyDepreciation([item], 2, 2031).toFixed(2)).toBe('100.00');
    expect(monthlyDepreciation([item], 3, 2031).toFixed(2)).toBe('0.00');
  });

  it('rounds only the total, once, to 2 places', () => {
    // each quota is 100 / 3 = 33.333...; two of them are 66.666... -> 66.67
    const item = equipment({
      purchaseValue: new Prisma.Decimal('100.00'),
      usefulLifeYears: 1,
    });
    const third = new Prisma.Decimal('100').dividedBy(12);
    expect(third.toDecimalPlaces(2).mul(2).toFixed(2)).toBe('16.66');
    expect(monthlyDepreciation([item, item], 3, 2026).toFixed(2)).toBe('16.67');
  });

  it('matches the Figma example: 5 equipment costing R$ 189,08 a month', () => {
    const bought = new Date('2025-01-15');
    const item = (depreciable: string) =>
      equipment({
        purchaseValue: new Prisma.Decimal(depreciable),
        acquisitionDate: bought,
      });
    const all = [
      item('3000.00'),
      item('2500.00'),
      item('2800.00'),
      item('1944.80'),
      item('1100.00'),
    ];
    expect(monthlyDepreciation(all, 10, 2026).toFixed(2)).toBe('189.08');
  });
});

describe('MonthlyDepreciation.getMonthlyDepreciation', () => {
  it('depreciates the equipment the repository returns for the user', async () => {
    const findDepreciable = jest.fn().mockResolvedValue([equipment()]);
    const service = new MonthlyDepreciation({ findDepreciable } as never);

    const result = await service.getMonthlyDepreciation('user-1', 10, 2026);

    expect(result.toFixed(2)).toBe('100.00');
    expect(findDepreciable).toHaveBeenCalledWith('user-1');
  });
});

describe('MonthlyDepreciationRepository.findDepreciable', () => {
  it('reads only the active, non-deleted equipment of the user', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repository = new MonthlyDepreciationRepository({
      equipment: { findMany },
    } as never);

    await repository.findDepreciable('user-1');

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user-1', active: true, deletedAt: null },
      }),
    );
  });
});
