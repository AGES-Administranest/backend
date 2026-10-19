import { EntryNature, EntryScope, Prisma } from '@prisma/client';

import { FinancialEntryRepository } from '../../../src/modules/financial/financial-entry.repository';
import { FinancialEntryService } from '../../../src/modules/financial/financial-entry.service';

describe('FinancialEntryRepository.sumByScope', () => {
  it('uses the statement rule: owner, not deleted, accrual month', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const repository = new FinancialEntryRepository({
      financialEntry: { groupBy },
    } as never);
    const from = new Date('2026-03-01T00:00:00Z');
    const to = new Date('2026-04-01T00:00:00Z');

    await repository.sumByScope('user-1', {
      from,
      to,
      nature: EntryNature.EXPENSE,
    });

    expect(groupBy).toHaveBeenCalledWith({
      by: ['scope'],
      where: {
        userId: 'user-1',
        deletedAt: null,
        accrualDate: { gte: from, lt: to },
        nature: EntryNature.EXPENSE,
      },
      _sum: { amount: true },
    });
  });

  it('groups the statement by nature, scope and category', async () => {
    const groupBy = jest.fn().mockResolvedValue([]);
    const repository = new FinancialEntryRepository({
      financialEntry: { groupBy },
    } as never);
    const from = new Date('2026-03-01T00:00:00Z');
    const to = new Date('2026-04-01T00:00:00Z');

    await repository.sumByNatureScopeCategory('user-1', { from, to });

    expect(groupBy).toHaveBeenCalledWith({
      by: ['nature', 'scope', 'categoryId'],
      where: {
        userId: 'user-1',
        deletedAt: null,
        accrualDate: { gte: from, lt: to },
      },
      _sum: { amount: true },
    });
  });

  it('maps a null grouped sum to zero', async () => {
    const repository = new FinancialEntryRepository({
      financialEntry: {
        groupBy: jest.fn().mockResolvedValue([
          {
            nature: EntryNature.EXPENSE,
            scope: EntryScope.PERSONAL,
            categoryId: 'cat-1',
            _sum: { amount: null },
          },
        ]),
      },
    } as never);

    const [row] = await repository.sumByNatureScopeCategory('user-1', {
      from: new Date(),
      to: new Date(),
    });

    expect(row.total.toFixed(2)).toBe('0.00');
  });

  it('maps a null sum to zero', async () => {
    const repository = new FinancialEntryRepository({
      financialEntry: {
        groupBy: jest
          .fn()
          .mockResolvedValue([
            { scope: EntryScope.PERSONAL, _sum: { amount: null } },
          ]),
      },
    } as never);

    const [row] = await repository.sumByScope('user-1', {
      from: new Date(),
      to: new Date(),
    });

    expect(row.total.toFixed(2)).toBe('0.00');
  });
});

describe('FinancialEntryService.sumExpensesByScope', () => {
  const build = (rows: { scope: EntryScope; total: Prisma.Decimal }[]) => {
    const repository = { sumByScope: jest.fn().mockResolvedValue(rows) };
    return {
      repository,
      service: new FinancialEntryService(repository as never, {} as never),
    };
  };

  it('splits the expenses by scope and asks only for EXPENSE of that UTC month', async () => {
    const { repository, service } = build([
      { scope: EntryScope.PROFESSIONAL, total: new Prisma.Decimal('120.50') },
      { scope: EntryScope.PERSONAL, total: new Prisma.Decimal('80') },
    ]);

    const result = await service.sumExpensesByScope('user-1', 2026, 3);

    expect(result.professional.toFixed(2)).toBe('120.50');
    expect(result.personal.toFixed(2)).toBe('80.00');
    expect(repository.sumByScope).toHaveBeenCalledWith('user-1', {
      from: new Date('2026-03-01T00:00:00Z'),
      to: new Date('2026-04-01T00:00:00Z'),
      nature: EntryNature.EXPENSE,
    });
  });

  it('returns zero for a scope with no entries', async () => {
    const { service } = build([]);

    const result = await service.sumExpensesByScope('user-1', 2026, 3);

    expect(result.professional.toFixed(2)).toBe('0.00');
    expect(result.personal.toFixed(2)).toBe('0.00');
  });
});

describe('FinancialEntryService.getBalance', () => {
  const dec = (value: string) => new Prisma.Decimal(value);
  const emptyGroups = [
    { category: 'SUPPLIES', subtotal: '0.00' },
    { category: 'TRAVEL', subtotal: '0.00' },
    { category: 'FIXED_COSTS', subtotal: '0.00' },
    { category: 'TAXES_AND_FEES', subtotal: '0.00' },
    { category: 'OTHER', subtotal: '0.00' },
  ];

  const build = (
    rows: {
      nature: EntryNature;
      scope: EntryScope;
      categoryId: string;
      total: Prisma.Decimal;
    }[],
    names: { id: string; name: string }[] = [],
  ) => {
    const repository = {
      sumByNatureScopeCategory: jest.fn().mockResolvedValue(rows),
    };
    const categories = { findNames: jest.fn().mockResolvedValue(names) };
    return {
      repository,
      categories,
      service: new FinancialEntryService(
        repository as never,
        categories as never,
      ),
    };
  };

  it('uses the current UTC month when month and year are absent', async () => {
    const { repository, service } = build([]);
    await service.getBalance('user-1', {});

    const now = new Date();
    expect(repository.sumByNatureScopeCategory).toHaveBeenCalledWith('user-1', {
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      to: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
    });
  });

  it('returns zeros for an empty month and does not look up categories', async () => {
    const { categories, service } = build([]);

    await expect(
      service.getBalance('user-1', { month: 3, year: 2026 }),
    ).resolves.toEqual({
      totalIncome: '0.00',
      totalExpenses: '0.00',
      professionalExpenses: '0.00',
      personalExpenses: '0.00',
      netBalance: '0.00',
      expensesByCategory: emptyGroups,
    });
    expect(categories.findNames).not.toHaveBeenCalled();
  });

  it('splits income, expenses by scope and maps categories into the US04 groups', async () => {
    const { categories, repository, service } = build(
      [
        {
          nature: EntryNature.INCOME,
          scope: EntryScope.PROFESSIONAL,
          categoryId: 'fees',
          total: dec('1000.00'),
        },
        {
          nature: EntryNature.INCOME,
          scope: EntryScope.PERSONAL,
          categoryId: 'other-in',
          total: dec('50.25'),
        },
        {
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PROFESSIONAL,
          categoryId: 'supplies',
          total: dec('100.10'),
        },
        {
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PROFESSIONAL,
          categoryId: 'travel',
          total: dec('40.00'),
        },
        {
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PERSONAL,
          categoryId: 'taxes',
          total: dec('20.00'),
        },
        {
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PROFESSIONAL,
          categoryId: 'fixed',
          total: dec('30.00'),
        },
        {
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PERSONAL,
          categoryId: 'custom',
          total: dec('5.15'),
        },
        {
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PROFESSIONAL,
          categoryId: 'other-out',
          total: dec('4.00'),
        },
      ],
      [
        { id: 'supplies', name: 'Supplies' },
        { id: 'travel', name: 'Travel' },
        { id: 'taxes', name: 'Taxes and fees' },
        { id: 'fixed', name: 'Fixed costs' },
        { id: 'custom', name: 'Custom' },
        { id: 'other-out', name: 'Other' },
      ],
    );

    await expect(
      service.getBalance('user-1', { month: 3, year: 2026 }),
    ).resolves.toEqual({
      totalIncome: '1050.25',
      totalExpenses: '199.25',
      professionalExpenses: '174.10',
      personalExpenses: '25.15',
      netBalance: '851.00',
      expensesByCategory: [
        { category: 'SUPPLIES', subtotal: '100.10' },
        { category: 'TRAVEL', subtotal: '40.00' },
        { category: 'FIXED_COSTS', subtotal: '30.00' },
        { category: 'TAXES_AND_FEES', subtotal: '20.00' },
        { category: 'OTHER', subtotal: '9.15' },
      ],
    });
    expect(repository.sumByNatureScopeCategory).toHaveBeenCalledWith('user-1', {
      from: new Date('2026-03-01T00:00:00Z'),
      to: new Date('2026-04-01T00:00:00Z'),
    });
    expect(categories.findNames).toHaveBeenCalledWith([
      'supplies',
      'travel',
      'taxes',
      'fixed',
      'custom',
      'other-out',
    ]);
  });

  it('adds two categories that map to the same group', async () => {
    const { service } = build(
      [
        {
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PROFESSIONAL,
          categoryId: 'a',
          total: dec('10.01'),
        },
        {
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PROFESSIONAL,
          categoryId: 'b',
          total: dec('0.02'),
        },
      ],
      [
        { id: 'a', name: 'Supplies' },
        { id: 'b', name: 'Supplies' },
      ],
    );

    const result = await service.getBalance('user-1', {
      month: 3,
      year: 2026,
    });
    expect(result.expensesByCategory[0]).toEqual({
      category: 'SUPPLIES',
      subtotal: '10.03',
    });
  });

  it('returns a negative net balance when expenses exceed income', async () => {
    const { service } = build(
      [
        {
          nature: EntryNature.INCOME,
          scope: EntryScope.PROFESSIONAL,
          categoryId: 'fees',
          total: dec('10.00'),
        },
        {
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PROFESSIONAL,
          categoryId: 'supplies',
          total: dec('25.50'),
        },
      ],
      [{ id: 'supplies', name: 'Supplies' }],
    );

    const result = await service.getBalance('user-1', {
      month: 3,
      year: 2026,
    });
    expect(result.netBalance).toBe('-15.50');
  });
});
