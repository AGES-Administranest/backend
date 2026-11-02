import { Injectable } from '@nestjs/common';
import { HourlyRateSnapshot, Prisma } from '@prisma/client';

import type { YearMonth } from './domain/hourly-rate-snapshot';
import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

export type HourlyRateSnapshotData = Omit<HourlyRateSnapshot, 'id'>;

export type HourlyRateHistoryRow = Pick<
  HourlyRateSnapshot,
  'year' | 'month' | 'hourlyRate' | 'calculatedAt'
>;

/** Every read and write is keyed by the owner from the token (ADR-11). */
@Injectable()
export class HourlyRateSnapshotRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserts the month's row, or replaces it when `replace` is true. With
   * `replace` false an existing row is left untouched: an upsert with an empty
   * update, so two requests racing on a new month cannot both insert it.
   */
  save(
    snapshot: HourlyRateSnapshotData,
    { replace }: { replace: boolean },
  ): Promise<HourlyRateSnapshot> {
    const { userId, year, month, ...values } = snapshot;

    return runQuery(() =>
      this.prisma.hourlyRateSnapshot.upsert({
        where: { userId_year_month: { userId, year, month } },
        create: snapshot,
        update: replace ? values : {},
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
          calculatedAt: true,
        },
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
      }),
    );
  }
}
