import { Injectable } from '@nestjs/common';
import { Prisma, Trip } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

type Db = Prisma.TransactionClient | PrismaService;

export interface TripPeriod {
  from?: Date;
  to?: Date;
}

export interface TripPage {
  trips: Trip[];
  total: number;
  totalKm: Prisma.Decimal;
  totalCost: Prisma.Decimal;
}

/** Latest day first; within a day, in the order the trips were recorded. */
const TRIP_ORDER: Prisma.TripOrderByWithRelationInput[] = [
  { occurredOn: 'desc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];

/**
 * Every read is scoped to the owner (ADR-11) and skips rows with deleted_at,
 * except `findAnyById`, which looks for a device-generated id across accounts.
 *
 * The service runs a write and the reads it depends on in one transaction
 * (`transaction`), passing the client to each method, so the vehicle, the
 * appointment and the client it checks cannot change before the trip is saved.
 */
@Injectable()
export class TripsRepository {
  constructor(private readonly prisma: PrismaService) {}

  transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return runQuery(() => this.prisma.$transaction(fn));
  }

  /** One page plus the totals of the whole period, from the same filter. */
  async findPage(
    userId: string,
    period: TripPeriod,
    skip: number,
    take: number,
  ): Promise<TripPage> {
    const where = this.periodWhere(userId, period);

    const [trips, total, sums] = await runQuery(() =>
      this.prisma.$transaction([
        this.prisma.trip.findMany({ where, orderBy: TRIP_ORDER, skip, take }),
        this.prisma.trip.count({ where }),
        this.prisma.trip.aggregate({
          where,
          _sum: { distanceKm: true, cost: true },
        }),
      ]),
    );

    return {
      trips,
      total,
      // A RIDE without a distance is NULL, which SUM skips.
      totalKm: sums._sum.distanceKm ?? new Prisma.Decimal(0),
      totalCost: sums._sum.cost ?? new Prisma.Decimal(0),
    };
  }

  findById(id: string, userId: string, db: Db = this.prisma) {
    return runQuery(() =>
      db.trip.findFirst({ where: { id, userId, deletedAt: null } }),
    );
  }

  /**
   * A device-generated id is unique across accounts and survives deletion
   * (ADR-09), so a resent create must find it whoever owns it.
   */
  findAnyById(id: string, db: Db = this.prisma) {
    return runQuery(() => db.trip.findUnique({ where: { id } }));
  }

  /** The owner's vehicle, inactive included; null when missing or deleted. */
  findVehicle(id: string, userId: string, db: Db = this.prisma) {
    return runQuery(() =>
      db.vehicle.findFirst({
        where: { id, userId, deletedAt: null },
        select: { active: true, fuelPrice: true, avgConsumptionKmL: true },
      }),
    );
  }

  /** The owner's appointment, in any status; null when missing or deleted. */
  findAppointment(id: string, userId: string, db: Db = this.prisma) {
    return runQuery(() =>
      db.appointment.findFirst({
        where: { id, userId, deletedAt: null },
        select: { clientId: true },
      }),
    );
  }

  /** Whether the client is the owner's, inactive included, and not deleted. */
  async clientExists(
    id: string,
    userId: string,
    db: Db = this.prisma,
  ): Promise<boolean> {
    const client = await runQuery(() =>
      db.client.findFirst({
        where: { id, userId, deletedAt: null },
        select: { id: true },
      }),
    );
    return client !== null;
  }

  create(data: Prisma.TripUncheckedCreateInput, db: Db = this.prisma) {
    return runQuery(() => db.trip.create({ data }));
  }

  update(id: string, data: Prisma.TripUncheckedUpdateInput, db: Db) {
    return runQuery(() => db.trip.update({ where: { id }, data }));
  }

  /** Returns null when the trip belongs to someone else or is already deleted. */
  async softDelete(
    id: string,
    userId: string,
    db: Db = this.prisma,
  ): Promise<Trip | null> {
    const { count } = await runQuery(() =>
      db.trip.updateMany({
        where: { id, userId, deletedAt: null },
        data: { deletedAt: new Date() },
      }),
    );
    if (count === 0) return null;

    return runQuery(() => db.trip.findUniqueOrThrow({ where: { id } }));
  }

  private periodWhere(
    userId: string,
    period: TripPeriod,
  ): Prisma.TripWhereInput {
    return {
      userId,
      deletedAt: null,
      ...(period.from || period.to
        ? {
            occurredOn: {
              ...(period.from ? { gte: period.from } : {}),
              ...(period.to ? { lte: period.to } : {}),
            },
          }
        : {}),
    };
  }
}
