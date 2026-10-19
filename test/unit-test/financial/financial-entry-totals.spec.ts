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
