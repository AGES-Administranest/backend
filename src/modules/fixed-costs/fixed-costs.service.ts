import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { QueryFixedCostsSummaryDto } from './dto/query-fixed-costs-summary.dto';
import { FixedCostsSummaryResponse } from './entities/fixed-costs-summary.entity';
import { FixedCostsRepository } from './fixed-costs.repository';
import { EquipmentService } from '../equipment';
import { FinancialEntryService } from '../financial';

const money = (value: Prisma.Decimal): string =>
  value.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);

@Injectable()
export class FixedCostsService {
  constructor(
    private readonly entries: FinancialEntryService,
    private readonly equipment: EquipmentService,
    private readonly repository: FixedCostsRepository,
  ) {}

  async getSummary(
    userId: string,
    query: QueryFixedCostsSummaryDto,
  ): Promise<FixedCostsSummaryResponse> {
    // Expenses and depreciation both follow the requested month (UTC, like
    // the statement, so the cards match it). For the current month the
    // depreciation is as of now; for any other month, as of its last day.
    const now = new Date();
    const year = query.year ?? now.getUTCFullYear();
    const month = query.month ?? now.getUTCMonth() + 1;
    const isCurrentMonth =
      year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
    // day 0 of the next month = last day of the requested month
    const asOf = isCurrentMonth
      ? now
      : new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    const [expenses, equipmentSummary, transport] = await Promise.all([
      this.entries.sumExpensesByScope(userId, year, month),
      this.equipment.summary(userId, asOf),
      this.repository.findTransportMonthly(userId),
    ]);
    const depreciation = new Prisma.Decimal(equipmentSummary.monthlyTotal);
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
