import { Injectable } from '@nestjs/common';
import { Prisma, Supplier } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class SupplierRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(
    where: Prisma.SupplierWhereInput,
    skip?: number,
    take?: number,
  ): Promise<Supplier[]> {
    return runQuery(() =>
      this.prisma.supplier.findMany({
        where: { ...where, deletedAt: null },
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
    );
  }

  findById(id: string, userId: string): Promise<Supplier | null> {
    return runQuery(() =>
      this.prisma.supplier.findFirst({
        where: { id, userId, deletedAt: null },
      }),
    );
  }

  isActiveAndOwned(userId: string, supplierId: string): Promise<boolean> {
    return runQuery(async () =>
      Boolean(
        await this.prisma.supplier.findFirst({
          where: { id: supplierId, userId, active: true, deletedAt: null },
          select: { id: true },
        }),
      ),
    );
  }

  create(data: Prisma.SupplierUncheckedCreateInput): Promise<Supplier> {
    return runQuery(() => this.prisma.supplier.create({ data }));
  }

  update(
    id: string,
    userId: string,
    data: Prisma.SupplierUncheckedUpdateInput,
  ): Promise<Supplier | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const owned = await tx.supplier.findFirst({
          where: { id, userId, deletedAt: null },
          select: { id: true },
        });
        if (!owned) return null;

        return tx.supplier.update({ where: { id }, data });
      }),
    );
  }

  deactivate(id: string, userId: string): Promise<Supplier | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const { count } = await tx.supplier.updateMany({
          where: { id, userId, deletedAt: null },
          data: { active: false },
        });
        if (count === 0) return null;

        return tx.supplier.findUniqueOrThrow({ where: { id } });
      }),
    );
  }
}
