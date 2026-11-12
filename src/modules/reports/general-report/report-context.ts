import { Prisma } from '@prisma/client';

import { fromIsoDate } from '../../../shared/dates/iso-date';
import { Period, periodFromIsoDates } from '../../../shared/dates/period';
import type { AppointmentPeriod } from '../../appointments';
import { EquipmentService } from '../../equipment';
import type { TripPeriod } from '../../trips';
import { monthSegments, MonthSegment, prorate } from '../domain/month-segments';
import { assertReportablePeriod } from '../domain/report-period';

/** The depreciation of one month of the period (US15, prorated). */
export interface SegmentDepreciation {
  segment: MonthSegment;
  /** Depreciation of the whole month. */
  monthly: Prisma.Decimal;
  /** The share of it that belongs to the period. */
  amount: Prisma.Decimal;
}

/**
 * What every section of one report shares: the user, the period in the shape
 * each kind of column needs, and the months it covers.
 *
 * The depreciation is computed once and shared, because the financial section
 * and the depreciation section must show the same amounts.
 */
export class ReportContext {
  readonly period: Period;
  readonly segments: MonthSegment[];
  private depreciationOnce?: Promise<SegmentDepreciation[]>;

  /**
   * @throws DomainError `REPORT_PERIOD_INVALID` when `from` is after `to`.
   * @throws DomainError `REPORT_PERIOD_TOO_LONG` past `MAX_REPORT_DAYS`.
   */
  constructor(
    readonly userId: string,
    readonly from: string,
    readonly to: string,
    private readonly equipment: EquipmentService,
  ) {
    this.period = periodFromIsoDates(from, to);
    assertReportablePeriod(this.period, { from, to });
    this.segments = monthSegments(from, to);
  }

  /** For `timestamptz` columns, as the client summary (US17) reads them. */
  get appointmentPeriod(): AppointmentPeriod {
    return { from: this.period.instants.from, before: this.period.instants.to };
  }

  /** A trip day is a calendar date; `to` is included, as in US17. */
  get tripPeriod(): TripPeriod {
    return { from: fromIsoDate(this.from), to: fromIsoDate(this.to) };
  }

  depreciation(): Promise<SegmentDepreciation[]> {
    this.depreciationOnce ??= Promise.all(
      this.segments.map(async segment => {
        const monthly = new Prisma.Decimal(
          await this.equipment.monthlyDepreciation(
            this.userId,
            segment.year,
            segment.month,
          ),
        );
        return { segment, monthly, amount: prorate(monthly, segment) };
      }),
    );
    return this.depreciationOnce;
  }
}
