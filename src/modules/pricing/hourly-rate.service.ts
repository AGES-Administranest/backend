import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { FixedCostsService } from '../fixed-costs';
import { PricingSettingsService } from '../pricing-settings';
import {
  calculateHourlyRate,
  formatHourlyRateValue,
  type HourlyRatePartKey,
} from './domain/hourly-rate';
import { QueryHourlyRateDto } from './dto/query-hourly-rate.dto';
import { HourlyRateResponse } from './entities/hourly-rate.entity';

/** For developers reading the response; the app shows its own text per key. */
const PART_LABELS: Record<HourlyRatePartKey, string> = {
  FIXED_COSTS: 'Fixed costs',
  VARIABLE_COSTS: 'Variable costs',
  OWNER_DRAW: "Owner's draw",
  SAFETY_MARGIN: 'Safety margin',
};

@Injectable()
export class HourlyRateService {
  constructor(
    private readonly pricingSettings: PricingSettingsService,
    private readonly fixedCosts: FixedCostsService,
  ) {}

  /**
   * The hour value for one month. Nothing is stored: every call reads the
   * month's costs and the current goals, so a change to either shows up on the
   * next request (US20 acceptance criterion 3).
   *
   * Answers 404 PRICING_SETTINGS_NOT_FOUND, like GET /pricing-settings, while
   * the US19 goals are not saved: the app already shows that as the
   * calculator's initial state.
   */
  async calculate(
    userId: string,
    query: QueryHourlyRateDto,
  ): Promise<HourlyRateResponse> {
    const now = new Date();
    const year = query.year ?? now.getUTCFullYear();
    const month = query.month ?? now.getUTCMonth() + 1;

    // Goals first: without them there is nothing to calculate, so the costs
    // are not read at all.
    const settings = await this.pricingSettings.find(userId);
    const costs = await this.fixedCosts.getMonthlyCosts(
      userId,
      year,
      month,
      now,
    );

    // Personal expenses count as a fixed cost: the hour has to pay for the
    // month the owner lives, not only for the work. Trips count as
    // transport, a fixed cost; the other professional expenses are the
    // variable part.
    const fixedCosts = costs.personalExpenses
      .plus(costs.depreciation)
      .plus(costs.transport);
    const result = calculateHourlyRate({
      fixedCosts,
      variableCosts: costs.professionalExpenses,
      ownerDraw: new Prisma.Decimal(settings.monthlyIncomeGoal),
      safetyMarginPct: new Prisma.Decimal(settings.safetyMarginPct),
      weeklyHours: new Prisma.Decimal(settings.weeklyHours),
    });

    return {
      month,
      year,
      items: result.parts.map(part => ({
        key: part.key,
        label: PART_LABELS[part.key],
        amount: formatHourlyRateValue(part.amount),
        percentOfTotal: formatHourlyRateValue(part.percentOfTotal),
      })),
      total: formatHourlyRateValue(result.total),
      productiveHours: formatHourlyRateValue(result.productiveHours),
      hourlyRate: formatHourlyRateValue(result.hourlyRate),
      minimumHourlyRate: formatHourlyRateValue(result.minimumHourlyRate),
      calculatedAt: now,
    };
  }
}
