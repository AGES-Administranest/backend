import { Injectable } from '@nestjs/common';
import {
  Appointment,
  AppointmentStatus,
  EntryNature,
  EntryScope,
  EntrySource,
  Prisma,
} from '@prisma/client';

import {
  InvalidReferenceError,
  runQuery,
} from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class AppointmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

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
  ): Promise<Appointment> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        await this.ensureClientBelongsToUser(tx, data.clientId, userId);
        const appointment = await tx.appointment.create({ data });

        if (appointment.status === AppointmentStatus.COMPLETED) {
          if (appointment.amount !== null) {
            await this.upsertFinancialEntry(
              tx,
              appointment,
              userId,
              appointment.amount,
            );
          }
        }

        return appointment;
      }),
    );
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
    return this.update(id, userId, { deletedAt: new Date() });
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
