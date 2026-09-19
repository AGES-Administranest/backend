import { Injectable } from '@nestjs/common';
import { Appointment, AppointmentStatus, Prisma } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

const OWNED: Pick<Prisma.AppointmentWhereInput, 'deletedAt'> = {
  deletedAt: null,
};

@Injectable()
export class AppointmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string, userId: string): Promise<Appointment | null> {
    return runQuery(() =>
      this.prisma.appointment.findFirst({
        where: { id, userId, ...OWNED },
      }),
    );
  }

  cancelIfScheduled(
    id: string,
    userId: string,
    notes: string,
  ): Promise<Appointment | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const owned = await tx.appointment.findFirst({
          where: {
            id,
            userId,
            status: AppointmentStatus.SCHEDULED,
            ...OWNED,
          },
          select: { id: true },
        });
        if (!owned) return null;

        return tx.appointment.update({
          where: { id },
          data: { status: AppointmentStatus.CANCELED, notes },
        });
      }),
    );
  }
}
