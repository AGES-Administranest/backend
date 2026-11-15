import { Injectable } from '@nestjs/common';
import { HourlyRateSnapshot, Prisma } from '@prisma/client';

import type { YearMonth } from './domain/hourly-rate-snapshot';
import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

export type HourlyRateSnapshotData = Omit<HourlyRateSnapshot, 'id'>;

/**
 * What the history list reads of each month: the stored hour value, plus the
 * parts and weekly hours its productive hours and minimum are derived from.
 */
export type HourlyRateHistoryRow = Pick<
  HourlyRateSnapshot,
  | 'year'
  | 'month'
  | 'hourlyRate'
  | 'fixedCosts'
  | 'variableCosts'
  | 'ownerDraw'
  | 'safetyMargin'
  | 'weeklyHours'
  | 'calculatedAt'
>;

/** Every read and write is keyed by the owner from the token (ADR-11). */
@Injectable()
export class HourlyRateSnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts the month's row, or replaces it when `replace` is true. With
   * `replace` false an existing row is left untouched.
   *
   * Both paths are a single statement on the unique key, so requests racing on
   * a month that has no row yet cannot both insert it:
   * - replace: an upsert with values to update, which Prisma runs as
   *   `INSERT ... ON CONFLICT DO UPDATE`;
   * - keep: `createMany` with `skipDuplicates`, i.e.
   *   `INSERT ... ON CONFLICT DO NOTHING`. An upsert with an empty `update` is
   *   not used here: Prisma does not run it natively but as a read followed by
   *   an insert, and the loser of the race failed with a unique violation (500).
   */
  async save(
    snapshot: HourlyRateSnapshotData,
    { replace }: { replace: boolean },
  ): Promise<void> {
    if (!replace) {
      await runQuery(() =>
        this.prisma.hourlyRateSnapshot.createMany({
          data: [snapshot],
          skipDuplicates: true,
        }),
      );
      return;
    }

    const { userId, year, month, ...values } = snapshot;
    await runQuery(() =>
      this.prisma.hourlyRateSnapshot.upsert({
        where: { userId_year_month: { userId, year, month } },
        create: snapshot,
        update: values,
      }),
    );
  }

  findMonth(
    userId: string,
    { year, month }: YearMonth,
  ): Promise<HourlyRateSnapshot | null> {
    return runQuery(() =>
      this.prisma.hourlyRateSnapshot.findUnique({
        where: { userId_year_month: { userId, year, month } },
      }),
    );
  }

  /** From the latest month back. A missing bound leaves that side open. */
  findInRange(
    userId: string,
    from?: YearMonth,
    to?: YearMonth,
  ): Promise<HourlyRateHistoryRow[]> {
    const bounds: Prisma.HourlyRateSnapshotWhereInput[] = [];
    if (from) {
      bounds.push({
        OR: [
          { year: { gt: from.year } },
          { year: from.year, month: { gte: from.month } },
        ],
      });
    }
    if (to) {
      bounds.push({
        OR: [
          { year: { lt: to.year } },
          { year: to.year, month: { lte: to.month } },
        ],
      });
    }

    return runQuery(() =>
      this.prisma.hourlyRateSnapshot.findMany({
        where: { userId, AND: bounds },
        select: {
          year: true,
          month: true,
          hourlyRate: true,
          fixedCosts: true,
          variableCosts: true,
          ownerDraw: true,
          safetyMargin: true,
          weeklyHours: true,
          calculatedAt: true,
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      }),
    );
  }
}
