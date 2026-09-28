import { Injectable } from '@nestjs/common';
import {
  Appointment,
  AppointmentStatus,
  EntryNature,
  EntryScope,
  EntrySource,
  FinancialEntry,
  Item,
  ItemLot,
  Prisma,
  StockMovement,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import {
  InvalidReferenceError,
  UniqueConstraintError,
  runQuery,
} from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { balanceRequiresAdjustment, reversalType } from '../stock-movements';

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

  findByClientGeneratedId(
    clientGeneratedId: string,
    userId: string,
  ): Promise<Appointment | null> {
    return runQuery(() =>
      this.prisma.appointment.findFirst({
        where: { clientGeneratedId, userId, deletedAt: null },
      }),
    );
  }

  findMany(
    where: Prisma.AppointmentWhereInput,
    skip: number,
    take: number,
  ): Promise<Appointment[]> {
    return runQuery(() =>
      this.prisma.appointment.findMany({
        where,
        orderBy: { startsAt: 'asc' },
        skip,
        take,
      }),
    );
  }

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
          status: AppointmentStatus.SCHEDULED,
          deletedAt: null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        orderBy: { startsAt: 'asc' },
      }),
    );
  }
  create(
    data: Prisma.AppointmentUncheckedCreateInput,
    userId: string,
  ): Promise<{ appointment: Appointment; created: boolean }> {
    return runQuery(async () => {
      try {
        return await this.prisma.$transaction(async tx => {
          if (data.clientGeneratedId) {
            const existing = await tx.appointment.findFirst({
              where: {
                clientGeneratedId: data.clientGeneratedId,
                userId,
                deletedAt: null,
              },
            });
            if (existing) return { appointment: existing, created: false };
          }

          await this.ensureClientBelongsToUser(tx, data.clientId, userId);
          const appointment = await tx.appointment.create({ data });

          if (
            appointment.status === AppointmentStatus.COMPLETED &&
            appointment.amount !== null
          ) {
            await this.upsertFinancialEntry(
              tx,
              appointment,
              userId,
              appointment.amount,
            );
          }

          return { appointment, created: true };
        });
      } catch (error) {
        if (error instanceof UniqueConstraintError && data.clientGeneratedId) {
          const existing = await this.prisma.appointment.findFirst({
            where: {
              clientGeneratedId: data.clientGeneratedId,
              userId,
              deletedAt: null,
            },
          });
          if (existing) return { appointment: existing, created: false };
        }
        throw error;
      }
    });
  }

  update(
    id: string,
    userId: string,
    data: Prisma.AppointmentUncheckedUpdateInput,
  ): Promise<Appointment | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const owned = await tx.appointment.findFirst({
          where: { id, userId, deletedAt: null },
          include: { financialEntry: true },
        });
        if (!owned) return null;

        await this.ensureClientBelongsToUser(tx, data.clientId, userId);
        const appointment = await tx.appointment.update({
          where: { id },
          data,
        });

        if (appointment.status === AppointmentStatus.COMPLETED) {
          if (appointment.amount !== null) {
            await this.upsertFinancialEntry(
              tx,
              appointment,
              userId,
              appointment.amount,
              owned.financialEntry?.id,
            );
          }
        } else if (
          owned.financialEntry &&
          owned.financialEntry.deletedAt === null
        ) {
          await tx.financialEntry.update({
            where: { id: owned.financialEntry.id },
            data: { deletedAt: new Date() },
          });
        }

        return appointment;
      }),
    );
  }

  /**
   * SCHEDULED → COMPLETED plus the revenue it earns, in one transaction.
   *
   * Returns null when this user has no SCHEDULED appointment with this id:
   * it does not exist, was deleted, or was already completed or canceled.
   * The service tells those apart.
   *
   * The status check lives in the UPDATE's WHERE on purpose. A concurrent
   * /complete or /cancel waits on the row lock, re-evaluates the WHERE once
   * the first one commits, and updates nothing, so the appointment can never
   * end up canceled with its revenue already posted.
   */
  complete(
    id: string,
    userId: string,
    amount: Prisma.Decimal | number,
    data: Omit<Prisma.AppointmentUncheckedUpdateManyInput, 'status' | 'amount'>,
  ): Promise<{
    appointment: Appointment;
    financialEntry: FinancialEntry;
  } | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const { count } = await tx.appointment.updateMany({
          where: {
            id,
            userId,
            status: AppointmentStatus.SCHEDULED,
            deletedAt: null,
          },
          data: { ...data, amount, status: AppointmentStatus.COMPLETED },
        });
        if (count === 0) return null;

        const { financialEntry: previousEntry, ...appointment } =
          await tx.appointment.findUniqueOrThrow({
            where: { id },
            include: { financialEntry: { select: { id: true } } },
          });

        // An entry soft-deleted by an earlier edit still holds the unique
        // appointment_id, so it is revived instead of inserting a second one.
        await this.upsertFinancialEntry(
          tx,
          appointment,
          userId,
          new Prisma.Decimal(amount),
          previousEntry?.id,
        );

        const financialEntry = await tx.financialEntry.findUniqueOrThrow({
          where: { appointmentId: id },
        });
        return { appointment, financialEntry };
      }),
    );
  }

  delete(id: string, userId: string): Promise<Appointment | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const appointment = await tx.appointment.findFirst({
          where: { id, userId, deletedAt: null },
        });
        if (!appointment) return null;

        const deletedAt = new Date();
        const financialEntry = await tx.financialEntry.findUnique({
          where: { appointmentId: id },
        });
        if (financialEntry && financialEntry.deletedAt === null) {
          await tx.financialEntry.update({
            where: { id: financialEntry.id },
            data: { deletedAt },
          });
        }

        const movements = await tx.stockMovement.findMany({
          where: { appointmentId: id, deletedAt: null },
        });
        for (const movement of movements) {
          await tx.stockMovement.create({
            data: {
              userId,
              itemId: movement.itemId,
              lotId: movement.lotId,
              type: reversalType(movement.type),
              source: StockMovementSource.CORRECTION_REVERSAL,
              quantity: movement.quantity,
              unitCost: movement.unitCost,
              occurredAt: deletedAt,
              appointmentId: id,
              notes: `Reversal of stock movement ${movement.id}`,
            },
          });
          await tx.item.update({
            where: { id: movement.itemId },
            data: {
              currentQuantity:
                movement.type === StockMovementType.INBOUND
                  ? { decrement: movement.quantity }
                  : { increment: movement.quantity },
            },
          });
          if (movement.lotId) {
            await tx.itemLot.update({
              where: { id: movement.lotId },
              data: {
                currentQuantity:
                  movement.type === StockMovementType.INBOUND
                    ? { decrement: movement.quantity }
                    : { increment: movement.quantity },
              },
            });
          }
        }

        return tx.appointment.update({
          where: { id },
          data: { deletedAt },
        });
      }),
    );
  }

  private async ensureClientBelongsToUser(
    tx: Prisma.TransactionClient,
    clientId: unknown,
    userId: string,
  ): Promise<void> {
    if (typeof clientId !== 'string') return;

    const client = await tx.client.findFirst({
      where: { id: clientId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!client) throw new InvalidReferenceError('clientId');
  }

  private async upsertFinancialEntry(
    tx: Prisma.TransactionClient,
    appointment: Appointment,
    userId: string,
    amount: Prisma.Decimal,
    financialEntryId?: string,
  ): Promise<void> {
    const category = await tx.financialCategory.findFirst({
      where: {
        userId: null,
        name: 'Professional fees',
        nature: EntryNature.INCOME,
        active: true,
      },
      select: { id: true },
    });

    if (!category) throw new Error('Professional fees category is not seeded');

    const data = {
      nature: EntryNature.INCOME,
      scope: EntryScope.PROFESSIONAL,
      categoryId: category.id,
      description: appointment.procedureName ?? 'Procedimento',
      amount,
      accrualDate: appointment.startsAt,
      source: EntrySource.APPOINTMENT,
      appointmentId: appointment.id,
      deletedAt: null,
    };

    if (financialEntryId) {
      await tx.financialEntry.update({ where: { id: financialEntryId }, data });
      return;
    }

    await tx.financialEntry.create({ data: { ...data, userId } });
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
