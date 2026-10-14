import { Injectable } from '@nestjs/common';
import { PricingSettings } from '@prisma/client';

import { SavePricingSettingsDto } from './dto/save-pricing-settings.dto';
import { PricingSettingsEntity } from './entities/pricing-settings.entity';
import { PricingSettingsRepository } from './pricing-settings.repository';
import { DomainError } from '../../shared/errors/domain-error';

@Injectable()
export class PricingSettingsService {
  constructor(private readonly repository: PricingSettingsRepository) {}

  /**
   * The saved goals, or null while they are not configured — no row yet, or a
   * row that only has the transport cost (US18). For the modules that need
   * the goals without turning their absence into a 404 (US20, US21).
   */
  async findConfigured(userId: string): Promise<PricingSettingsEntity | null> {
    const row = await this.repository.findByUserId(userId);
    return row ? this.toEntity(row) : null;
  }

  async find(userId: string): Promise<PricingSettingsEntity> {
    const settings = await this.findConfigured(userId);
    if (!settings) throw this.notFound();
    return settings;
  }

  async save(
    userId: string,
    dto: SavePricingSettingsDto,
  ): Promise<PricingSettingsEntity> {
    const row = await this.repository.saveGoals(userId, dto);
    const settings = this.toEntity(row);
    // Unreachable: the three goals were just written. Kept so a broken write
    // fails loudly instead of answering 200 with nulls.
    if (!settings) {
      throw new Error('Pricing settings were saved without their goals');
    }
    return settings;
  }

  /** Null unless all three goals are filled in (the US19 business rule). */
  private toEntity(row: PricingSettings): PricingSettingsEntity | null {
    const { monthlyIncomeGoal, weeklyHours, safetyMarginPct } = row;
    if (
      monthlyIncomeGoal === null ||
      weeklyHours === null ||
      safetyMarginPct === null
    ) {
      return null;
    }

    return {
      monthlyIncomeGoal: monthlyIncomeGoal.toNumber(),
      weeklyHours: weeklyHours.toNumber(),
      safetyMarginPct: safetyMarginPct.toNumber(),
      updatedAt: row.updatedAt,
    };
  }

  private notFound(): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'PRICING_SETTINGS_NOT_FOUND',
      'Pricing settings are not configured yet',
    );
  }
}
