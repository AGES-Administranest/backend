import { Injectable } from '@nestjs/common';
import { Appointment, Prisma } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class AppointmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(where: Prisma.AppointmentWhereInput, skip?: number, take?: number) {
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

  create(data: Prisma.AppointmentUncheckedCreateInput): Promise<Appointment> {
    return runQuery(() => this.prisma.appointment.create({ data }));
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

        return tx.appointment.update({ where: { id }, data });
      }),
    );
  }

  delete(id: string, userId: string): Promise<Appointment | null> {
    return this.update(id, userId, { deletedAt: new Date() });
  }
}