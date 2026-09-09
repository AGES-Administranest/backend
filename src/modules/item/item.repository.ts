import { Injectable } from '@nestjs/common';
import { Item, MeasurementUnit, Prisma } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class ItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(where: Prisma.ItemWhereInput = { active: true }): Promise<Item[]> {
    return runQuery(() => this.prisma.item.findMany({ where }));
  }

  findById(id: string): Promise<Item | null> {
    return runQuery(() => this.prisma.item.findUnique({ where: { id } }));
  }

  findByPresentation(
    userId: string,
    name: string,
    unit: MeasurementUnit,
    excludeId?: string,
  ): Promise<Item | null> {
    return runQuery(() =>
      this.prisma.item.findFirst({
        where: {
          userId,
          name,
          unit,
          active: true,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      }),
    );
  }

  create(data: Prisma.ItemUncheckedCreateInput): Promise<Item> {
    return runQuery(() => this.prisma.item.create({ data }));
  }

  update(id: string, data: Prisma.ItemUncheckedUpdateInput): Promise<Item> {
    return runQuery(() => this.prisma.item.update({ where: { id }, data }));
  }

  delete(id: string): Promise<Item> {
    return runQuery(() =>
      this.prisma.item.update({
        where: { id },
        data: { active: false, deletedAt: new Date() },
      }),
    );
  }
}