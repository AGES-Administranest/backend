import { Injectable } from '@nestjs/common';
import { PricingSettings } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

export type PricingGoals = {
  monthlyIncomeGoal: number;
  weeklyHours: number;
  safetyMarginPct: number;
};

/**
 * One row per user, keyed by the owner itself (ADR-11): there is no id that
 * could point at someone else's settings.
 */
@Injectable()
export class PricingSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: string): Promise<PricingSettings | null> {
    return runQuery(() =>
      this.prisma.pricingSettings.findUnique({ where: { userId } }),
    );
  }

  /**
   * Creates the row on the first save and overwrites the three goals after
   * that. Only the goals are written: the transport cost (US18) shares the row
   * and keeps whatever it had.
   */
  saveGoals(userId: string, goals: PricingGoals): Promise<PricingSettings> {
    const { monthlyIncomeGoal, weeklyHours, safetyMarginPct } = goals;
    const data = { monthlyIncomeGoal, weeklyHours, safetyMarginPct };

    return runQuery(() =>
      this.prisma.pricingSettings.upsert({
        where: { userId },
        create: { userId, ...data },
        update: data,
      }),
    );
  }
}
