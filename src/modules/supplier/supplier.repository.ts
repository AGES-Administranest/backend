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
        where,
        orderBy: { name: 'asc' },
        skip,
        take,
      }),
    );
  }

  findByName(userId: string, name: string): Promise<Supplier | null> {
    return runQuery(() =>
      this.prisma.supplier.findFirst({
        where: { userId, name, active: true },
      }),
    );
  }

  create(data: Prisma.SupplierUncheckedCreateInput): Promise<Supplier> {
    return runQuery(() => this.prisma.supplier.create({ data }));
  }
}
