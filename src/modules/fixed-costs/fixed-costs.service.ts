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
    // Expenses use the requested month (UTC, like the statement, so the cards
    // match it). Depreciation comes from EquipmentService.summary (US15) and is
    // always the current month's, whatever month was requested.
    const now = new Date();
    const year = query.year ?? now.getUTCFullYear();
    const month = query.month ?? now.getUTCMonth() + 1;

    const [expenses, equipmentSummary, transport] = await Promise.all([
      this.entries.sumExpensesByScope(userId, year, month),
      this.equipment.summary(userId),
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
