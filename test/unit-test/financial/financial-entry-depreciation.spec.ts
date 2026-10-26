import { EntryNature, EntryScope, Prisma } from '@prisma/client';

import { EquipmentService } from '../../../src/modules/equipment';
import { FinancialCategoryRepository } from '../../../src/modules/financial/financial-category.repository';
import { FinancialEntryRepository } from '../../../src/modules/financial/financial-entry.repository';
import { FinancialEntryService } from '../../../src/modules/financial/financial-entry.service';

const decimal = (value: string) => new Prisma.Decimal(value);

/** 12000 - 0 over 120 months = 100.00 a month. */
const equipment = (overrides: Record<string, unknown> = {}) => ({
  purchaseValue: decimal('12000'),
  salvageValue: decimal('0'),
  acquisitionDate: new Date('2026-01-01T00:00:00.000Z'),
  usefulLifeMonths: 120,
  ...overrides,
});

function setup(
  items: ReturnType<typeof equipment>[],
  rows: {
    nature: EntryNature;
    scope: EntryScope;
    categoryId: string;
    total: Prisma.Decimal;
  }[] = [],
) {
  const repository = {
    sumByNatureScopeCategory: jest.fn().mockResolvedValue(rows),
    create: jest.fn(),
    updateById: jest.fn(),
  };
  const categories = {
    findNames: jest
      .fn()
      .mockResolvedValue([{ id: 'cat-fixed', name: 'Fixed costs' }]),
  };
  const equipmentService = new EquipmentService({
    findMany: jest.fn().mockResolvedValue(items),
  } as unknown as ConstructorParameters<typeof EquipmentService>[0]);
  const service = new FinancialEntryService(
    repository as unknown as FinancialEntryRepository,
    categories as unknown as FinancialCategoryRepository,
    equipmentService,
  );
  return { service, repository };
}

const depreciationOf = (balance: Awaited<ReturnType<typeof run>>) =>
  balance.expensesByCategory.items.find(i => i.category === 'DEPRECIATION')
    ?.subtotal;

const run = (service: FinancialEntryService, month = 3, year = 2027) =>
  service.getBalance('user-1', { month, year });

describe('FinancialEntryService.getBalance depreciation', () => {
  it('counts depreciation as a professional expense in a month with no entries', async () => {
    const { service, repository } = setup([equipment()]);

    const balance = await run(service);

    expect(balance.totalIncome).toBe('0.00');
    expect(balance.professionalExpenses).toBe('100.00');
    expect(balance.personalExpenses).toBe('0.00');
    expect(balance.totalExpenses).toBe('100.00');
    expect(balance.netBalance).toBe('-100.00');
    expect(depreciationOf(balance)).toBe('100.00');
    expect(balance.expensesByCategory.total).toBe(balance.totalExpenses);
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  it('adds depreciation to the month entries and keeps the groups summing to the total', async () => {
    const { service } = setup(
      [equipment()],
      [
        {
          nature: EntryNature.INCOME,
          scope: EntryScope.PROFESSIONAL,
          categoryId: 'cat-income',
          total: decimal('1000'),
        },
        {
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PERSONAL,
          categoryId: 'cat-fixed',
          total: decimal('250.50'),
        },
      ],
    );

    const balance = await run(service);

    expect(balance.totalExpenses).toBe('350.50');
    expect(balance.professionalExpenses).toBe('100.00');
    expect(balance.personalExpenses).toBe('250.50');
    expect(balance.netBalance).toBe('649.50');
    const sum = balance.expensesByCategory.items.reduce(
      (acc, item) => acc.plus(item.subtotal),
      decimal('0'),
    );
    expect(sum.toFixed(2)).toBe(balance.expensesByCategory.total);
    expect(balance.expensesByCategory.total).toBe(balance.totalExpenses);
  });

  it('does not depreciate equipment bought after the month', async () => {
    const { service } = setup([
      equipment({ acquisitionDate: new Date('2027-06-01T00:00:00.000Z') }),
    ]);

    expect(depreciationOf(await run(service))).toBe('0.00');
  });

  it('does not depreciate equipment past its useful life', async () => {
    const { service } = setup([
      equipment({
        acquisitionDate: new Date('2020-01-01T00:00:00.000Z'),
        usefulLifeMonths: 12,
      }),
    ]);

    expect(depreciationOf(await run(service))).toBe('0.00');
  });
});
