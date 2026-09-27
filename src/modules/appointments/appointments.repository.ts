import { Injectable } from '@nestjs/common';
import {
  Appointment,
  Item,
  ItemLot,
  Prisma,
  StockMovement,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { balanceRequiresAdjustment } from '../stock-movements';

export type ItemWithLots = Item & { lots: ItemLot[] };

export interface ItemUsage {
  itemId: string;
  lotId: string | null;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

export interface RecordedItemUsage {
  movement: StockMovement;
  /** `item.currentQuantity` right after this movement was applied */
  itemBalance: Prisma.Decimal;
}

@Injectable()
export class AppointmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string, userId: string): Promise<Appointment | null> {
    return runQuery(() =>
      this.prisma.appointment.findFirst({
        where: { id, userId, deletedAt: null },
      }),
    );
  }

  /**
   * The row that overlaps `[startsAt, endsAt)`, if any — the query behind
   * `checkConflict`. Only `SCHEDULED`, non-deleted appointments of the same
   * user count; `excludeId` leaves the appointment being edited out of its
   * own check.
   */
  findConflicting(
    userId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
  ): Promise<Appointment | null> {
    return runQuery(() =>
      this.prisma.appointment.findFirst({
        where: {
          userId,
          status: 'SCHEDULED',
          deletedAt: null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        orderBy: { startsAt: 'asc' },
      }),
    );
  }

  create(data: Prisma.AppointmentUncheckedCreateInput): Promise<Appointment> {
    return runQuery(() => this.prisma.appointment.create({ data }));
  }

  update(
    id: string,
    userId: string,
    data: Prisma.AppointmentUncheckedUpdateInput,
  ): Promise<Appointment | null> {
    return runQuery(async () => {
      const owned = await this.prisma.appointment.findFirst({
        where: { id, userId, deletedAt: null },
        select: { id: true },
      });
      if (!owned) return null;
      return this.prisma.appointment.update({ where: { id }, data });
    });
  }

  findItemsWithLots(
    itemIds: readonly string[],
    userId: string,
  ): Promise<ItemWithLots[]> {
    return runQuery(() =>
      this.prisma.item.findMany({
        where: { id: { in: [...itemIds] }, userId, deletedAt: null },
        include: { lots: true },
      }),
    );
  }

  /**
   * Appends one OUTBOUND/APPOINTMENT movement per usage and decrements the
   * `currentQuantity` caches of the item and of the lot it was drawn from, all
   * in one transaction: either every movement lands with its caches, or none.
   *
   * The decrement is an atomic `decrement`, never a read-then-write, so two
   * concurrent registrations on the same item cannot lose each other's
   * consumption (ADR-10). The balance is allowed to go negative; when it does,
   * `needsAdjustment` is switched on (see `docs/data-dictionary.md`).
   *
   * Only inserts into `stock_movement` — an existing movement is never edited.
   */
  recordItemUsage(
    userId: string,
    appointmentId: string,
    occurredAt: Date,
    usages: readonly ItemUsage[],
  ): Promise<RecordedItemUsage[]> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const recorded: RecordedItemUsage[] = [];
        for (const usage of usages) {
          const movement = await tx.stockMovement.create({
            data: {
              userId,
              itemId: usage.itemId,
              lotId: usage.lotId,
              appointmentId,
              type: StockMovementType.OUTBOUND,
              source: StockMovementSource.APPOINTMENT,
              quantity: usage.quantity,
              unitCost: usage.unitCost,
              occurredAt,
            },
          });

          if (usage.lotId) {
            await tx.itemLot.update({
              where: { id: usage.lotId },
              data: { currentQuantity: { decrement: usage.quantity } },
            });
          }

          const item = await tx.item.update({
            where: { id: usage.itemId },
            data: { currentQuantity: { decrement: usage.quantity } },
          });
          if (
            balanceRequiresAdjustment(item.currentQuantity) &&
            !item.needsAdjustment
          ) {
            await tx.item.update({
              where: { id: item.id },
              data: { needsAdjustment: true },
            });
          }

          recorded.push({ movement, itemBalance: item.currentQuantity });
        }
        return recorded;
      }),
    );
  }
}
