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
  MeasurementUnit,
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
import { balanceRequiresAdjustment, reversalOf } from '../stock-movements';

export type ItemWithLots = Item & { lots: ItemLot[] };

export interface ItemUsage {
  clientGeneratedId: string | null;
  itemId: string;
  lotId: string | null;
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

/** A movement with what editing or removing it as a supply needs to know. */
export type SupplyMovement = StockMovement & {
  /** the reversal that already undid it, if any */
  reversal: StockMovement | null;
  /** the movement that replaced it when it was edited (null on a removal) */
  replacement: StockMovement | null;
  item: { currentQuantity: Prisma.Decimal };
};

/** A supply still in effect, with the item fields the app shows beside it. */
export type ActiveSupply = StockMovement & {
  item: { name: string; unit: MeasurementUnit };
};

export interface CorrectedItemUsage {
  reversal: StockMovement;
  /** the movement that replaces the reversed one; null on a removal */
  movement: StockMovement | null;
  /** `item.currentQuantity` right after the correction */
  itemBalance: Prisma.Decimal;
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

  cancel(
    id: string,
    userId: string,
    notes: string,
  ): Promise<Appointment | null> {
    return runQuery(async () => {
      const { count } = await this.prisma.appointment.updateMany({
        where: {
          id,
          userId,
          status: AppointmentStatus.SCHEDULED,
          deletedAt: null,
        },
        data: { status: AppointmentStatus.CANCELED, notes },
      });
      if (count === 0) return null;

      return this.prisma.appointment.findFirst({
        where: { id, userId, deletedAt: null },
      });
    });
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

        // Only the supplies still in effect. Reversing every linked row would
        // also reverse the reversals written by an earlier edit or removal,
        // and the unique reversed_movement_id would refuse a second reversal
        // of an already reversed supply.
        const supplies = await tx.stockMovement.findMany({
          where: {
            appointmentId: id,
            source: StockMovementSource.APPOINTMENT,
            type: StockMovementType.OUTBOUND,
            deletedAt: null,
            reversal: { is: null },
          },
        });
        for (const supply of supplies) {
          const reversal = await tx.stockMovement.create({
            data: { userId, ...reversalOf(supply, deletedAt) },
          });
          await this.applyToCaches(tx, reversal);
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

  /** Movements of this user already recorded under any of these keys. */
  findMovementsByClientGeneratedIds(
    clientGeneratedIds: readonly string[],
    userId: string,
  ): Promise<StockMovement[]> {
    return runQuery(() =>
      this.prisma.stockMovement.findMany({
        where: { userId, clientGeneratedId: { in: [...clientGeneratedIds] } },
      }),
    );
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
   *
   * TODO(#21): this is a second write path into the ledger. Once
   * `StockMovementsService.recordBatch` (PR #21) lands, route these movements
   * through it so the balance recomputation, the minimum-stock check (US11)
   * and the `needsAdjustment` rule live in a single place.
   *
   * Returns null, writing nothing, when this user has no live appointment with
   * this id that can still take supplies: it was deleted or canceled after the
   * service read it. The row is held FOR SHARE until commit, so a concurrent
   * cancel waits for this registration instead of slipping in between.
   */
  recordItemUsage(
    userId: string,
    appointmentId: string,
    occurredAt: Date,
    usages: readonly ItemUsage[],
  ): Promise<RecordedItemUsage[] | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        if (!(await this.lockOpenAppointment(tx, appointmentId, userId))) {
          return null;
        }

        const recorded: RecordedItemUsage[] = [];
        for (const usage of usages) {
          const movement = await tx.stockMovement.create({
            data: {
              userId,
              clientGeneratedId: usage.clientGeneratedId,
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

          const itemBalance = await this.applyToCaches(tx, movement);
          recorded.push({ movement, itemBalance });
        }
        return recorded;
      }),
    );
  }

  findMovement(id: string, userId: string): Promise<SupplyMovement | null> {
    return runQuery(() =>
      this.prisma.stockMovement.findFirst({
        where: { id, userId, deletedAt: null },
        include: {
          reversal: true,
          replacement: true,
          item: { select: { currentQuantity: true } },
        },
      }),
    );
  }

  /**
   * The supplies of an appointment that are still in effect: its
   * OUTBOUND/APPOINTMENT movements that no reversal undid. An edited supply
   * comes back once, as the movement that replaced it — the original has a
   * reversal. Oldest first, so the list keeps the order it was built in.
   */
  findActiveSupplies(
    appointmentId: string,
    userId: string,
  ): Promise<ActiveSupply[]> {
    return runQuery(() =>
      this.prisma.stockMovement.findMany({
        where: {
          appointmentId,
          userId,
          type: StockMovementType.OUTBOUND,
          source: StockMovementSource.APPOINTMENT,
          deletedAt: null,
          reversal: { is: null },
        },
        include: { item: { select: { name: true, unit: true } } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  }

  /**
   * Corrects a supply without editing it (ADR-10): appends the reversal of
   * `original` and, on an edit, the OUTBOUND/APPOINTMENT movement with the
   * new quantity — same item, lot, cost and date, since it is the same
   * consumption corrected — updating the caches, all in one transaction.
   *
   * The unique `reversed_movement_id` makes a second, concurrent correction
   * of the same supply fail with UniqueConstraintError and write nothing.
   *
   * Returns null, writing nothing, when the appointment was deleted or
   * canceled after the service read it (held FOR SHARE, as in
   * `recordItemUsage`).
   *
   * TODO(#21): another direct write into the ledger; see `recordItemUsage`.
   */
  correctItemUsage(
    userId: string,
    original: StockMovement,
    replacement: {
      quantity: Prisma.Decimal;
      clientGeneratedId: string | null;
    } | null,
  ): Promise<CorrectedItemUsage | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const appointmentId = original.appointmentId!;
        if (!(await this.lockOpenAppointment(tx, appointmentId, userId))) {
          return null;
        }

        const reversal = await tx.stockMovement.create({
          data: { userId, ...reversalOf(original) },
        });
        let itemBalance = await this.applyToCaches(tx, reversal);

        let movement: StockMovement | null = null;
        if (replacement) {
          movement = await tx.stockMovement.create({
            data: {
              userId,
              clientGeneratedId: replacement.clientGeneratedId,
              itemId: original.itemId,
              lotId: original.lotId,
              appointmentId,
              type: StockMovementType.OUTBOUND,
              source: StockMovementSource.APPOINTMENT,
              quantity: replacement.quantity,
              unitCost: original.unitCost,
              occurredAt: original.occurredAt,
              replacedMovementId: original.id,
            },
          });
          itemBalance = await this.applyToCaches(tx, movement);
        }

        return { reversal, movement, itemBalance };
      }),
    );
  }

  /**
   * Whether this user has a live, non-canceled appointment with this id,
   * holding its row FOR SHARE until the transaction ends: a concurrent cancel
   * waits for the stock write instead of slipping in between.
   */
  private async lockOpenAppointment(
    tx: Prisma.TransactionClient,
    appointmentId: string,
    userId: string,
  ): Promise<boolean> {
    const [appointment] = await tx.$queryRaw<{ status: AppointmentStatus }[]>`
      SELECT status FROM appointment
      WHERE id = ${appointmentId}::uuid
        AND user_id = ${userId}::uuid
        AND deleted_at IS NULL
      FOR SHARE`;
    return !!appointment && appointment.status !== AppointmentStatus.CANCELED;
  }

  /**
   * Applies a movement just written to the `currentQuantity` caches of its
   * item and lot, with atomic increments/decrements — never a
   * read-then-write, so concurrent movements on the same item cannot lose
   * each other (ADR-10). A balance that ends up negative switches
   * `needsAdjustment` on (see `docs/data-dictionary.md`).
   *
   * @returns the item's balance right after this movement.
   */
  private async applyToCaches(
    tx: Prisma.TransactionClient,
    movement: Pick<StockMovement, 'type' | 'itemId' | 'lotId' | 'quantity'>,
  ): Promise<Prisma.Decimal> {
    const change =
      movement.type === StockMovementType.INBOUND
        ? { increment: movement.quantity }
        : { decrement: movement.quantity };

    if (movement.lotId) {
      await tx.itemLot.update({
        where: { id: movement.lotId },
        data: { currentQuantity: change },
      });
    }

    const item = await tx.item.update({
      where: { id: movement.itemId },
      data: { currentQuantity: change },
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
    return item.currentQuantity;
  }
}
