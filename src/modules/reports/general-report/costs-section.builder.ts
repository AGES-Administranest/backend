import { Injectable } from '@nestjs/common';

import { money, sum } from './format';
import { ReportContext } from './report-context';
import { DomainError } from '../../../shared/errors/domain-error';
import {
  currentUtcMonth,
  HourlyRateHistoryService,
  HourlyRateService,
  monthIndex,
  QueryHourlyRateDto,
  QueryHourlyRateHistoryDto,
} from '../../pricing';
import { TripsService } from '../../trips';
import {
  DepreciationReportSection,
  HourlyRateMonth,
  HourlyRateReportSection,
  TripsReportSection,
} from '../entities/general-report.entity';

const yearMonth = ({ year, month }: { year: number; month: number }) =>
  `${year}-${String(month).padStart(2, '0')}`;

/** Trips, Depreciation and Hourly rate sections (US29). */
@Injectable()
export class CostsSectionBuilder {
  constructor(
    private readonly trips: TripsService,
    private readonly hourlyRate: HourlyRateService,
    private readonly hourlyRateHistory: HourlyRateHistoryService,
  ) {}

  async tripsSection(context: ReportContext): Promise<TripsReportSection> {
    const totals = await this.trips.totalsInPeriod(
      context.userId,
      context.tripPeriod,
    );
    return {
      type: 'TRIPS',
      empty: totals.count === 0,
      count: totals.count,
      distanceKm: totals.distanceKm.toFixed(2),
      cost: money(totals.cost),
    };
  }

  /** The depreciation of each month (US15), by the share of its days. */
  async depreciationSection(
    context: ReportContext,
  ): Promise<DepreciationReportSection> {
    const months = await context.depreciation();
    const total = sum(months.map(month => month.amount));
    return {
      type: 'DEPRECIATION',
      empty: total.isZero(),
      months: months.map(({ segment, monthly, amount }) => ({
        year: segment.year,
        month: segment.month,
        days: segment.days,
        daysInMonth: segment.daysInMonth,
        monthlyDepreciation: money(monthly),
        amount: money(amount),
      })),
      total: money(total),
    };
  }

  /**
   * One hour value per month of the period.
   *
   * A past month answers what the history stored for it (US22), so the report
   * shows what the hour was worth then. The current month, a future one, or a
   * past month never stored is calculated now (US20) and NOT stored: reading a
   * report must not write a past month into the history with today's goals.
   * Without goals (US19) nothing can be calculated: those months come back
   * empty and the section says why.
   */
  async hourlyRateSection(
    context: ReportContext,
  ): Promise<HourlyRateReportSection> {
    const first = context.segments[0];
    const last = context.segments[context.segments.length - 1];
    const stored = await this.hourlyRateHistory.list(
      context.userId,
      Object.assign(new QueryHourlyRateHistoryDto(), {
        from: yearMonth(first),
        to: yearMonth(last),
      }),
    );
    const storedByMonth = new Map(
      stored.map(row => [yearMonth(row), row.hourlyRate]),
    );
    const currentMonth = monthIndex(currentUtcMonth(new Date()));

    const months: HourlyRateMonth[] = [];
    let settingsMissing = false;
    // One at a time: each calculation reads the month's costs, and a year of
    // them at once would flood a small database.
    for (const { year, month } of context.segments) {
      const storedRate = storedByMonth.get(yearMonth({ year, month }));
      if (
        storedRate !== undefined &&
        monthIndex({ year, month }) < currentMonth
      ) {
        months.push({ year, month, hourlyRate: storedRate, source: 'HISTORY' });
        continue;
      }
      if (settingsMissing) {
        months.push({ year, month, hourlyRate: null, source: null });
        continue;
      }
      try {
        const result = await this.hourlyRate.calculateWithoutStoring(
          context.userId,
          Object.assign(new QueryHourlyRateDto(), { year, month }),
        );
        months.push({
          year,
          month,
          hourlyRate: result.hourlyRate,
          source: 'CALCULATED',
        });
      } catch (error) {
        if (
          !(error instanceof DomainError) ||
          error.code !== 'PRICING_SETTINGS_NOT_FOUND'
        ) {
          throw error;
        }
        settingsMissing = true;
        months.push(
          storedRate === undefined
            ? { year, month, hourlyRate: null, source: null }
            : { year, month, hourlyRate: storedRate, source: 'HISTORY' },
        );
      }
    }

    return {
      type: 'HOURLY_RATE',
      empty: months.every(month => month.hourlyRate === null),
      months,
      notice: settingsMissing ? 'PRICING_SETTINGS_NOT_FOUND' : null,
    };
  }
}
