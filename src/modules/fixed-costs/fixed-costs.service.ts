import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { QueryFixedCostsSummaryDto } from './dto/query-fixed-costs-summary.dto';
import { FixedCostsSummaryResponse } from './entities/fixed-costs-summary.entity';
import { FixedCostsRepository } from './fixed-costs.repository';
import { FinancialEntryService, MonthlyDepreciation } from '../financial';

const money = (value: Prisma.Decimal): string =>
  value.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);

@Injectable()
export class FixedCostsService {
  constructor(
    private readonly entries: FinancialEntryService,
    private readonly depreciation: MonthlyDepreciation,
    private readonly repository: FixedCostsRepository,
  ) {}

  async getSummary(
    userId: string,
    query: QueryFixedCostsSummaryDto,
  ): Promise<FixedCostsSummaryResponse> {
    // Resolved once so the three sources always look at the same month. The
    // current month is read in UTC, like the statement, so the cards match it.
    const now = new Date();
    const year = query.year ?? now.getUTCFullYear();
    const month = query.month ?? now.getUTCMonth() + 1;

    const [expenses, depreciation, transport] = await Promise.all([
      this.entries.sumExpensesByScope(userId, year, month),
      this.depreciation.getMonthlyDepreciation(userId, month, year),
      this.repository.findTransportMonthly(userId),
    ]);
    const transportCost = transport ?? new Prisma.Decimal(0);
    const total = expenses.professional
      .plus(expenses.personal)
      .plus(depreciation)
      .plus(transportCost);

    return {
      professionalExpenses: money(expenses.professional),
      personalExpenses: money(expenses.personal),
      depreciation: money(depreciation),
      transport: money(transportCost),
      total: money(total),
    };
  }
}
