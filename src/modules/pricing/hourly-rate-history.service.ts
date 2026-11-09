import { Injectable } from '@nestjs/common';
import { HourlyRateSnapshot } from '@prisma/client';

import { composeHourlyRate, formatHourlyRateValue } from './domain/hourly-rate';
import {
  monthIndex,
  parseYearMonth,
  type YearMonth,
} from './domain/hourly-rate-snapshot';
import { QueryHourlyRateHistoryDto } from './dto/query-hourly-rate-history.dto';
import {
  HourlyRateHistoryItemResponse,
  HourlyRateHistoryMonthResponse,
} from './entities/hourly-rate-history.entity';
import { HourlyRateSnapshotRepository } from './hourly-rate-snapshot.repository';
import { toHourlyRateResponse } from './hourly-rate.response';
import { DomainError } from '../../shared/errors/domain-error';

/**
 * Reads the stored months (US22). Nothing is recalculated here: a month
 * answers what was stored for it, whatever the goals are today.
 */
@Injectable()
export class HourlyRateHistoryService {
  constructor(private readonly snapshots: HourlyRateSnapshotRepository) {}

  async list(
    userId: string,
    query: QueryHourlyRateHistoryDto,
  ): Promise<HourlyRateHistoryItemResponse[]> {
    const from = query.from ? parseYearMonth(query.from) : undefined;
    const to = query.to ? parseYearMonth(query.to) : undefined;
    if (from && to && monthIndex(from) > monthIndex(to)) {
      // Same details as a ValidationPipe failure, so the app reads one shape.
      throw new DomainError(
        'INVALID_INPUT',
        'VALIDATION_ERROR',
        'Invalid request',
        {
          fields: ['from must not be after to'],
        },
      );
    }

    const rows = await this.snapshots.findInRange(userId, from, to);
    return rows.map(row => ({
      year: row.year,
      month: row.month,
      hourlyRate: formatHourlyRateValue(row.hourlyRate),
      calculatedAt: row.calculatedAt,
    }));
  }

  /**
   * A month of another account answers the same 404 as a month never
   * calculated, so the route cannot tell whether someone else has it (ADR-11).
   */
  async findMonth(
    userId: string,
    period: YearMonth,
  ): Promise<HourlyRateHistoryMonthResponse> {
    const row = await this.snapshots.findMonth(userId, period);
    if (!row) {
      throw new DomainError(
        'NOT_FOUND',
        'HOURLY_RATE_SNAPSHOT_NOT_FOUND',
        'This month has no stored hourly rate',
        { year: period.year, month: period.month },
      );
    }
    return this.toMonthResponse(row);
  }

  private toMonthResponse(
    row: HourlyRateSnapshot,
  ): HourlyRateHistoryMonthResponse {
    const result = composeHourlyRate(row, row.weeklyHours);

    return {
      ...toHourlyRateResponse(row, result, row.calculatedAt),
      // The stored value is the one the list shows; composing it again gives
      // the same cents, and reading it keeps the two routes equal by design.
      hourlyRate: formatHourlyRateValue(row.hourlyRate),
      parameters: {
        monthlyIncomeGoal: formatHourlyRateValue(row.monthlyIncomeGoal),
        weeklyHours: formatHourlyRateValue(row.weeklyHours),
        safetyMarginPct: formatHourlyRateValue(row.safetyMarginPct),
      },
    };
  }
}
