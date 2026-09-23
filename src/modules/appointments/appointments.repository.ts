import { Injectable } from '@nestjs/common';
import {
  Appointment,
  AppointmentStatus,
  EntryNature,
  EntryScope,
  EntrySource,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import {
  InvalidReferenceError,
  UniqueConstraintError,
  runQuery,
} from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { reversalType } from '../stock-movements';

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
}
