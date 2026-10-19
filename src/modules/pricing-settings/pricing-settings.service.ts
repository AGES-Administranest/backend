import { Injectable } from '@nestjs/common';
import { PricingSettings } from '@prisma/client';

import { SavePricingSettingsDto } from './dto/save-pricing-settings.dto';
import { SaveTransportCostDto } from './dto/save-transport-cost.dto';
import { PricingSettingsEntity } from './entities/pricing-settings.entity';
import { TransportCostEntity } from './entities/transport-cost.entity';
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

  async findTransportCost(userId: string): Promise<TransportCostEntity> {
    const row = await this.repository.findByUserId(userId);
    const transportCost = row ? this.toTransportCostEntity(row) : null;
    if (!transportCost) throw this.transportCostNotFound();
    return transportCost;
  }

  async saveTransportCost(
    userId: string,
    dto: SaveTransportCostDto,
  ): Promise<TransportCostEntity> {
    const row = await this.repository.saveTransportCost(
      userId,
      dto.transportCostMonthly,
    );
    const transportCost = this.toTransportCostEntity(row);
    // Unreachable: the transport cost was just written. Kept so a broken write
    // fails loudly instead of answering 200 with null.
    if (!transportCost) {
      throw new Error('Transport cost was saved without its value');
    }
    return transportCost;
  }

  /** Null while the transport cost is empty, which is not the same as zero. */
  private toTransportCostEntity(
    row: PricingSettings,
  ): TransportCostEntity | null {
    if (row.transportCostMonthly === null) return null;

    return {
      transportCostMonthly: row.transportCostMonthly.toNumber(),
      updatedAt: row.updatedAt,
    };
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

  private transportCostNotFound(): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'TRANSPORT_COST_NOT_FOUND',
      'Transport cost is not configured yet',
    );
  }
}
