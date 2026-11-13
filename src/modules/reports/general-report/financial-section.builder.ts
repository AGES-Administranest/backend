import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { money, sum, ZERO } from './format';
import { ReportContext } from './report-context';
import { periodFromIsoDates } from '../../../shared/dates/period';
import {
  EXPENSE_GROUPS,
  FinancialEntryService,
  INCOME_ORIGINS,
  type PeriodBalance,
} from '../../financial';
import { FinancialReportSection } from '../entities/general-report.entity';

/**
 * Financial section (US29): income by origin, expenses by group and the net
 * result, by the statement rule, plus the same three numbers month by month.
 *
 * Each month of the period is summarized on its own and the period is their
 * sum, so the months always add up to the total.
 */
@Injectable()
export class FinancialSectionBuilder {
  constructor(private readonly financial: FinancialEntryService) {}

  async build(context: ReportContext): Promise<FinancialReportSection> {
    const depreciation = await context.depreciation();
    const months = await Promise.all(
      depreciation.map(({ segment, amount }) =>
        this.financial.summarizeRange(
          context.userId,
          periodFromIsoDates(segment.from, segment.to).days,
          amount,
        ),
      ),
    );

    const total = (pick: (month: PeriodBalance) => Prisma.Decimal) =>
      sum(months.map(pick));
    const totalExpenses = total(month => month.totalExpenses);

    return {
      type: 'FINANCIAL',
      empty:
        months.every(month => !month.hasEntries) &&
        depreciation.every(month => month.amount.isZero()),
      income: {
        items: INCOME_ORIGINS.map(origin => ({
          origin,
          subtotal: money(
            total(month => month.incomeByOrigin.get(origin) ?? ZERO),
          ),
        })),
        total: money(total(month => month.totalIncome)),
      },
      expenses: {
        items: EXPENSE_GROUPS.map(category => ({
          category,
          subtotal: money(
            total(month => month.expensesByGroup.get(category) ?? ZERO),
          ),
        })),
        total: money(totalExpenses),
        professional: money(total(month => month.professionalExpenses)),
        personal: money(total(month => month.personalExpenses)),
      },
      netBalance: money(total(month => month.netBalance)),
      months: months.map((month, index) => ({
        year: depreciation[index].segment.year,
        month: depreciation[index].segment.month,
        from: depreciation[index].segment.from,
        to: depreciation[index].segment.to,
        totalIncome: money(month.totalIncome),
        totalExpenses: money(month.totalExpenses),
        netBalance: money(month.netBalance),
      })),
    };
  }
}
