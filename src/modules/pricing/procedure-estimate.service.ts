import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ClientService } from '../client';
import { ItemService } from '../item';
import { TripsService } from '../trips';
import { formatHourlyRateValue } from './domain/hourly-rate';
import { estimateProcedure } from './domain/procedure-estimate';
import { ProcedureEstimateDto } from './dto/procedure-estimate.dto';
import { ProcedureEstimateResponse } from './entities/procedure-estimate.entity';
import { HourlyRateService } from './hourly-rate.service';
import { DomainError } from '../../shared/errors/domain-error';

@Injectable()
export class ProcedureEstimateService {
  constructor(
    private readonly hourlyRate: HourlyRateService,
    private readonly trips: TripsService,
    private readonly clients: ClientService,
    private readonly items: ItemService,
  ) {}

  /**
   * The minimum price of a procedure (US21), from the current month's hourly
   * rate (US20), the trip cost at the client (US14) and the supplies' unit
   * costs. Nothing is stored.
   *
   * Without the pricing goals it answers 404 PRICING_SETTINGS_NOT_FOUND, as
   * GET /pricing/hourly-rate does, before reading anything else, so the app
   * sends the user to the same setup screen.
   */
  async estimate(
    userId: string,
    dto: ProcedureEstimateDto,
  ): Promise<ProcedureEstimateResponse> {
    const rate = await this.hourlyRate.calculate(userId, {});

    const clientId = dto.clientId ?? null;
    if (clientId !== null) await this.assertClient(userId, clientId);

    const supplies = dto.supplies ?? [];
    const unitCosts = await this.unitCostsOf(
      userId,
      supplies.map(supply => supply.itemId),
    );

    const trip =
      clientId === null
        ? null
        : await this.trips.estimateCostPerDay(userId, clientId);

    const estimate = estimateProcedure({
      durationMinutes: dto.durationMinutes,
      hourlyRate: rate.hourlyRate,
      minimumHourlyRate: rate.minimumHourlyRate,
      tripCostPerDay: trip?.available ? trip.costPerDay : null,
      supplies: supplies.map(supply => ({
        itemId: supply.itemId,
        quantity: supply.quantity,
        unitCost: unitCosts.get(supply.itemId) ?? null,
      })),
    });

    return {
      minimumPrice: formatHourlyRateValue(estimate.minimumPrice),
      breakEvenPrice: formatHourlyRateValue(estimate.breakEvenPrice),
      hoursCost: formatHourlyRateValue(estimate.hoursCost),
      tripCost: formatHourlyRateValue(estimate.tripCost),
      suppliesCost: formatHourlyRateValue(estimate.suppliesCost),
      hourlyRateUsed: rate.hourlyRate,
      minimumHourlyRateUsed: rate.minimumHourlyRate,
      tripEstimateAvailable: trip?.available ?? false,
      tripEstimateDays: trip?.days ?? 0,
      suppliesWithoutCost: estimate.suppliesWithoutCost,
      durationMinutes: dto.durationMinutes,
      month: rate.month,
      year: rate.year,
    };
  }

  /**
   * The client is read through its own module (ADR-01). Someone else's, or a
   * deleted one, is a 404 there; here it is a reference in the body, so a 422
   * with the same code. An inactive client is accepted.
   */
  private async assertClient(userId: string, clientId: string): Promise<void> {
    try {
      await this.clients.findOne(clientId, userId);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'CLIENT_NOT_FOUND') {
        throw this.invalidReference('CLIENT_NOT_FOUND', { clientId });
      }
      throw error;
    }
  }

  /**
   * Each item's unit cost, read through the item module (ADR-01), which is
   * null when none is recorded. An item of another account, or a deleted one,
   * is refused: the same item may appear on several lines.
   */
  private async unitCostsOf(
    userId: string,
    itemIds: readonly string[],
  ): Promise<Map<string, Prisma.Decimal | null>> {
    const unique = [...new Set(itemIds)];
    if (unique.length === 0) return new Map();

    const costs = await this.items.findUnitCosts(userId, unique);
    const missing = unique.find(itemId => !costs.has(itemId));
    if (missing) {
      throw this.invalidReference('ITEM_NOT_FOUND', { itemId: missing });
    }
    return costs;
  }

  private invalidReference(
    code: 'CLIENT_NOT_FOUND' | 'ITEM_NOT_FOUND',
    details: Record<string, unknown>,
  ): DomainError {
    return new DomainError(
      'INVALID_REFERENCE',
      code,
      'The estimate references something it cannot use',
      details,
    );
  }
}
