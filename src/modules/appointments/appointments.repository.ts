import { Injectable } from '@nestjs/common';
import { Appointment, Prisma } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

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
}
