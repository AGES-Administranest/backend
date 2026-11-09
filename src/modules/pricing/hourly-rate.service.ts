import { Injectable, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { calculateHourlyRate } from './domain/hourly-rate';
import { snapshotWriteFor } from './domain/hourly-rate-snapshot';
import { QueryHourlyRateDto } from './dto/query-hourly-rate.dto';
import { HourlyRateResponse } from './entities/hourly-rate.entity';
import { HourlyRateSnapshotRepository } from './hourly-rate-snapshot.repository';
import { toHourlyRateResponse } from './hourly-rate.response';
import { FixedCostsService } from '../fixed-costs';
import { PricingSettingsService } from '../pricing-settings';

@Injectable()
export class HourlyRateService implements OnModuleInit {
  constructor(
    private readonly pricingSettings: PricingSettingsService,
    private readonly fixedCosts: FixedCostsService,
    private readonly snapshots: HourlyRateSnapshotRepository,
  ) {}

  /**
   * PUT /pricing-settings recalculates the current month, so the history
   * reflects new goals even if the calculator is not opened afterwards.
   */
  onModuleInit(): void {
    this.pricingSettings.onGoalsSaved(async userId => {
      await this.calculate(userId, new QueryHourlyRateDto());
    });
  }

  /**
   * The hour value for one month. Always calculated from the month's costs and
   * the current goals, so a change to either shows up on the next request
   * (US20 acceptance criterion 3).
   *
   * The result is then stored in the history by the US22 rule
   * (`snapshotWriteFor`): the current month is replaced on every call, a past
   * month is only stored if it has nothing yet, a future month is not stored.
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
    const goals = {
      monthlyIncomeGoal: new Prisma.Decimal(settings.monthlyIncomeGoal),
      weeklyHours: new Prisma.Decimal(settings.weeklyHours),
      safetyMarginPct: new Prisma.Decimal(settings.safetyMarginPct),
    };
    const result = calculateHourlyRate({
      fixedCosts,
      variableCosts: costs.professionalExpenses,
      ownerDraw: goals.monthlyIncomeGoal,
      safetyMarginPct: goals.safetyMarginPct,
      weeklyHours: goals.weeklyHours,
    });

    const write = snapshotWriteFor({ year, month }, now);
    if (write !== 'SKIP') {
      const [fixed, variable, ownerDraw, safetyMargin] = result.parts;
      await this.snapshots.save(
        {
          userId,
          year,
          month,
          hourlyRate: result.hourlyRate,
          fixedCosts: fixed.amount,
          variableCosts: variable.amount,
          ownerDraw: ownerDraw.amount,
          safetyMargin: safetyMargin.amount,
          ...goals,
          calculatedAt: now,
        },
        { replace: write === 'REPLACE' },
      );
    }

    return toHourlyRateResponse({ year, month }, result, now);
  }
}
