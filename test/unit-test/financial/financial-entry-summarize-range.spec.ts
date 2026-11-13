import { EntryNature, EntryScope, EntrySource, Prisma } from '@prisma/client';

import { FinancialEntryService } from '../../../src/modules/financial/financial-entry.service';

const d = (value: string | number) => new Prisma.Decimal(value);

describe('FinancialEntryService.summarizeRange (US29)', () => {
  const range = {
    from: new Date('2026-10-15T00:00:00Z'),
    to: new Date('2026-11-01T00:00:00Z'),
  };

  const build = (
    rows: unknown[],
    incomeRows: { source: EntrySource; total: Prisma.Decimal }[],
  ) => {
    const repository = {
      sumByNatureScopeCategory: jest.fn().mockResolvedValue(rows),
      sumIncomeBySource: jest.fn().mockResolvedValue(incomeRows),
    };
    const categories = {
      findNames: jest
        .fn()
        .mockResolvedValue([{ id: 'cat-s', name: 'Supplies' }]),
    };
    const equipment = { monthlyDepreciation: jest.fn() };
    const service = new FinancialEntryService(
      repository as never,
      categories as never,
      equipment as never,
    );
    return { service, repository, equipment };
  };

  it('splits the income by origin and uses the depreciation it is given', async () => {
    const { service, repository, equipment } = build(
      [
        {
          nature: EntryNature.INCOME,
          scope: EntryScope.PROFESSIONAL,
          categoryId: 'cat-i',
          total: d('1700'),
        },
        {
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PROFESSIONAL,
          categoryId: 'cat-s',
          total: d('200'),
        },
      ],
      [
        { source: EntrySource.APPOINTMENT, total: d('1000') },
        { source: EntrySource.SERVICE_INVOICE, total: d('500') },
        { source: EntrySource.MANUAL, total: d('200') },
      ],
    );

    const result = await service.summarizeRange('user-1', range, d('85'));

    expect(repository.sumByNatureScopeCategory).toHaveBeenCalledWith(
      'user-1',
      range,
    );
    expect(repository.sumIncomeBySource).toHaveBeenCalledWith('user-1', range);
    // The span is not a whole month: the caller prorates, the service does not.
    expect(equipment.monthlyDepreciation).not.toHaveBeenCalled();
    expect(
      Object.fromEntries(
        [...result.incomeByOrigin].map(([origin, total]) => [
          origin,
          total.toFixed(2),
        ]),
      ),
    ).toEqual({
      APPOINTMENTS: '1000.00',
      SERVICE_INVOICES: '500.00',
      OTHER: '200.00',
    });
    expect(result.expensesByGroup.get('SUPPLIES')?.toFixed(2)).toBe('200.00');
    expect(result.expensesByGroup.get('DEPRECIATION')?.toFixed(2)).toBe(
      '85.00',
    );
    expect(result.totalExpenses.toFixed(2)).toBe('285.00');
    expect(result.netBalance.toFixed(2)).toBe('1415.00');
    expect(result.hasEntries).toBe(true);
  });

  it('says when the span has no entry at all', async () => {
    const { service } = build([], []);
    const result = await service.summarizeRange('user-1', range, d(0));

    expect(result.hasEntries).toBe(false);
    expect(result.totalIncome.toFixed(2)).toBe('0.00');
    expect([...result.incomeByOrigin.keys()]).toEqual([
      'APPOINTMENTS',
      'SERVICE_INVOICES',
      'OTHER',
    ]);
  });
});
