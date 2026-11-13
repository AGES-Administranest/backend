import { Prisma } from '@prisma/client';

import {
  EXPENSE_GROUPS,
  INCOME_ORIGINS,
  type PeriodBalance,
} from '../../../../src/modules/financial';
import { FinancialSectionBuilder } from '../../../../src/modules/reports/general-report/financial-section.builder';
import { ReportContext } from '../../../../src/modules/reports/general-report/report-context';

const d = (value: string | number) => new Prisma.Decimal(value);

function balance(
  income: Partial<Record<(typeof INCOME_ORIGINS)[number], number>>,
  expenses: Partial<Record<(typeof EXPENSE_GROUPS)[number], number>>,
  hasEntries = true,
): PeriodBalance {
  const incomeByOrigin = new Map(
    INCOME_ORIGINS.map(origin => [origin, d(income[origin] ?? 0)]),
  );
  const expensesByGroup = new Map(
    EXPENSE_GROUPS.map(group => [group, d(expenses[group] ?? 0)]),
  );
  const totalIncome = [...incomeByOrigin.values()].reduce(
    (a, b) => a.plus(b),
    d(0),
  );
  const totalExpenses = [...expensesByGroup.values()].reduce(
    (a, b) => a.plus(b),
    d(0),
  );
  return {
    totalIncome,
    totalExpenses,
    professionalExpenses: totalExpenses,
    personalExpenses: d(0),
    netBalance: totalIncome.minus(totalExpenses),
    expensesByGroup,
    incomeByOrigin,
    hasEntries,
  };
}

describe('FinancialSectionBuilder', () => {
  const context = (monthly: number[]) => {
    const monthlyDepreciation = jest.fn();
    monthly.forEach(value => monthlyDepreciation.mockResolvedValueOnce(value));
    return new ReportContext('user-1', '2026-10-15', '2026-11-14', {
      monthlyDepreciation,
    } as never);
  };

  it('summarizes each month with its prorated depreciation and adds them up', async () => {
    const summarizeRange = jest
      .fn()
      .mockResolvedValueOnce(
        balance(
          { APPOINTMENTS: 1000, SERVICE_INVOICES: 500 },
          { SUPPLIES: 200, DEPRECIATION: 85 },
        ),
      )
      .mockResolvedValueOnce(
        balance({ APPOINTMENTS: 800 }, { TRAVEL: 50, DEPRECIATION: 72.33 }),
      );
    const builder = new FinancialSectionBuilder({ summarizeRange } as never);

    const section = await builder.build(context([155, 155]));

    expect(summarizeRange).toHaveBeenNthCalledWith(
      1,
      'user-1',
      {
        from: new Date('2026-10-15T00:00:00Z'),
        to: new Date('2026-11-01T00:00:00Z'),
      },
      d('85.00'),
    );
    expect(summarizeRange).toHaveBeenNthCalledWith(
      2,
      'user-1',
      {
        from: new Date('2026-11-01T00:00:00Z'),
        to: new Date('2026-11-15T00:00:00Z'),
      },
      d('72.33'),
    );

    expect(section.type).toBe('FINANCIAL');
    expect(section.empty).toBe(false);
    expect(section.income).toEqual({
      items: [
        { origin: 'APPOINTMENTS', subtotal: '1800.00' },
        { origin: 'SERVICE_INVOICES', subtotal: '500.00' },
        { origin: 'OTHER', subtotal: '0.00' },
      ],
      total: '2300.00',
    });
    expect(section.expenses.items).toEqual(
      EXPENSE_GROUPS.map(category => ({
        category,
        subtotal:
          {
            SUPPLIES: '200.00',
            TRAVEL: '50.00',
            DEPRECIATION: '157.33',
          }[category as string] ?? '0.00',
      })),
    );
    expect(section.expenses.total).toBe('407.33');
    expect(section.netBalance).toBe('1892.67');
    expect(section.months).toEqual([
      {
        year: 2026,
        month: 10,
        from: '2026-10-15',
        to: '2026-10-31',
        totalIncome: '1500.00',
        totalExpenses: '285.00',
        netBalance: '1215.00',
      },
      {
        year: 2026,
        month: 11,
        from: '2026-11-01',
        to: '2026-11-14',
        totalIncome: '800.00',
        totalExpenses: '122.33',
        netBalance: '677.67',
      },
    ]);
  });

  it('is empty only without entries and without depreciation', async () => {
    const summarizeRange = jest.fn().mockResolvedValue(balance({}, {}, false));
    const builder = new FinancialSectionBuilder({ summarizeRange } as never);

    expect((await builder.build(context([0, 0]))).empty).toBe(true);
    expect((await builder.build(context([155, 0]))).empty).toBe(false);
  });
});
