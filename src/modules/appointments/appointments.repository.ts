import { Injectable } from '@nestjs/common';
import { Appointment, Prisma } from '@prisma/client';

import { InvalidReferenceError, runQuery } from '../../infra/prisma/prisma-errors';
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
        return tx.appointment.create({ data });
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
          select: { id: true },
        });
        if (!owned) return null;

        await this.ensureClientBelongsToUser(tx, data.clientId, userId);
        return tx.appointment.update({ where: { id }, data });
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
}