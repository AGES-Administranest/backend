import { Injectable } from '@nestjs/common';
import { Prisma, Vehicle } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * Every read is scoped to the owner (ADR-11) and skips rows with deleted_at.
 * An inactive vehicle is still found by id: trips keep pointing at it.
 */
@Injectable()
export class VehiclesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(userId: string, active: boolean): Promise<Vehicle[]> {
    return runQuery(() =>
      this.prisma.vehicle.findMany({
        where: { userId, active, deletedAt: null },
        orderBy: [{ brand: 'asc' }, { model: 'asc' }],
      }),
    );
  }

  findById(id: string, userId: string): Promise<Vehicle | null> {
    return runQuery(() =>
      this.prisma.vehicle.findFirst({
        where: { id, userId, deletedAt: null },
      }),
    );
  }

  create(data: Prisma.VehicleUncheckedCreateInput): Promise<Vehicle> {
    return runQuery(() => this.prisma.vehicle.create({ data }));
  }

  /**
   * Returns null when the vehicle belongs to someone else or was deleted.
   * The ownership check and the write share a transaction, as in `client`.
   */
  update(
    id: string,
    userId: string,
    data: Prisma.VehicleUncheckedUpdateInput,
  ): Promise<Vehicle | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const owned = await tx.vehicle.findFirst({
          where: { id, userId, deletedAt: null },
          select: { id: true },
        });
        if (!owned) return null;

        return tx.vehicle.update({ where: { id }, data });
      }),
    );
  }

  /**
   * Sets active = false and leaves deleted_at alone. Idempotent: an already
   * inactive vehicle still matches, so a resent DELETE answers the same way.
   */
  deactivate(id: string, userId: string): Promise<Vehicle | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const { count } = await tx.vehicle.updateMany({
          where: { id, userId, deletedAt: null },
          data: { active: false },
        });
        if (count === 0) return null;

        return tx.vehicle.findUniqueOrThrow({ where: { id } });
      }),
    );
  }
}
