import { Injectable } from '@nestjs/common';
import { Equipment, Prisma, Supplier } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class EquipmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(where: Prisma.EquipmentWhereInput): Promise<Equipment[]> {
    return runQuery(() =>
      this.prisma.equipment.findMany({
        where: { ...where, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    );
  }

  findById(id: string, userId: string): Promise<Equipment | null> {
    return runQuery(() =>
      this.prisma.equipment.findFirst({
        where: { id, userId, deletedAt: null },
      }),
    );
  }

  findActiveSupplier(
    userId: string,
    supplierId: string,
  ): Promise<Supplier | null> {
    return runQuery(() =>
      this.prisma.supplier.findFirst({
        where: { id: supplierId, userId, active: true },
      }),
    );
  }

  create(data: Prisma.EquipmentUncheckedCreateInput): Promise<Equipment> {
    return runQuery(() => this.prisma.equipment.create({ data }));
  }

  update(
    id: string,
    userId: string,
    data: Prisma.EquipmentUncheckedUpdateInput,
  ): Promise<Equipment | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const owned = await tx.equipment.findFirst({
          where: { id, userId, deletedAt: null },
          select: { id: true },
        });
        if (!owned) return null;

        return tx.equipment.update({ where: { id }, data });
      }),
    );
  }

  deactivate(id: string, userId: string): Promise<Equipment | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const owned = await tx.equipment.findFirst({
          where: { id, userId, deletedAt: null },
          select: { id: true },
        });
        if (!owned) return null;

        return tx.equipment.update({
          where: { id },
          data: { active: false },
        });
      }),
    );
  }
}
