import { Injectable } from '@nestjs/common';
import { Item, MeasurementUnit, Prisma } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * The lot that expires first among those still holding stock.
 *
 * It is what the app shows beside an item, so it travels with every read
 * instead of forcing one request per item. `take: 1` keeps it to a single
 * extra query for the whole page, served by the `[itemId, expirationDate]`
 * index. Empty lots are excluded: a depleted lot's date says nothing about
 * what is in stock today.
 */
const NEAREST_LOT = {
  lots: {
    where: {
      expirationDate: { not: null },
      currentQuantity: { gt: 0 },
    },
    orderBy: { expirationDate: 'asc' },
    take: 1,
    select: { expirationDate: true },
  },
} satisfies Prisma.ItemInclude;

export type ItemWithNearestLot = Item & {
  lots: { expirationDate: Date | null }[];
};

@Injectable()
export class ItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(
    where: Prisma.ItemWhereInput = { active: true },
    orderBy: Prisma.ItemOrderByWithRelationInput = { name: 'asc' },
    skip?: number,
    take?: number,
  ): Promise<ItemWithNearestLot[]> {
    return runQuery(() =>
      this.prisma.item.findMany({
        where,
        orderBy,
        skip,
        take,
        include: NEAREST_LOT,
      }),
    );
  }

  findById(id: string): Promise<ItemWithNearestLot | null> {
    return runQuery(() =>
      this.prisma.item.findUnique({ where: { id }, include: NEAREST_LOT }),
    );
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

  create(data: Prisma.ItemUncheckedCreateInput): Promise<ItemWithNearestLot> {
    return runQuery(() =>
      this.prisma.item.create({ data, include: NEAREST_LOT }),
    );
  }

  update(
    id: string,
    data: Prisma.ItemUncheckedUpdateInput,
  ): Promise<ItemWithNearestLot> {
    return runQuery(() =>
      this.prisma.item.update({ where: { id }, data, include: NEAREST_LOT }),
    );
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
