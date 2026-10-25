import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { QueryFixedCostsSummaryDto } from './dto/query-fixed-costs-summary.dto';
import { FixedCostsSummaryResponse } from './entities/fixed-costs-summary.entity';
import { FixedCostsRepository } from './fixed-costs.repository';
import { EquipmentService } from '../equipment';
import { FinancialEntryService } from '../financial';

const money = (value: Prisma.Decimal): string =>
  value.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);

/** The month's cost sources, unrounded except where the source already is. */
export interface MonthlyCosts {
  professionalExpenses: Prisma.Decimal;
  personalExpenses: Prisma.Decimal;
  depreciation: Prisma.Decimal;
  transport: Prisma.Decimal;
}

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
    // The current month is read in UTC, like the statement, so the cards
    // match it.
    const now = new Date();
    const year = query.year ?? now.getUTCFullYear();
    const month = query.month ?? now.getUTCMonth() + 1;

    const costs = await this.getMonthlyCosts(userId, year, month, now);
    const total = costs.professionalExpenses
      .plus(costs.personalExpenses)
      .plus(costs.depreciation)
      .plus(costs.transport);

    return {
      professionalExpenses: money(costs.professionalExpenses),
      personalExpenses: money(costs.personalExpenses),
      depreciation: money(costs.depreciation),
      transport: money(costs.transport),
      total: money(total),
    };
  }

  /**
   * The four cost sources of one month. The fixed-costs summary and the
   * hourly rate (US20) both read them here, so the two screens cannot
   * disagree on what a month cost.
   */
  async getMonthlyCosts(
    userId: string,
    year: number,
    month: number,
    now = new Date(),
  ): Promise<MonthlyCosts> {
    // For the current month the depreciation is as of now; for any other
    // month, as of its last day.
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

    return {
      professionalExpenses: expenses.professional,
      personalExpenses: expenses.personal,
      depreciation: new Prisma.Decimal(equipmentSummary.monthlyTotal),
      transport: transport ?? new Prisma.Decimal(0),
    };
  }
}
