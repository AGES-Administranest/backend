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

  /**
   * Scoped to the owner (ADR-11), and `findFirst` rather than `findUnique`
   * because the filter is on two columns. Someone else's item comes back null,
   * which the service reports as "not found" — the same answer as an id that
   * never existed, so the response cannot be used to probe for other people's
   * records.
   */
  findById(id: string, userId: string): Promise<ItemWithNearestLot | null> {
    return runQuery(() =>
      this.prisma.item.findFirst({
        where: { id, userId },
        include: NEAREST_LOT,
      }),
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

  /**
   * Returns null when the item belongs to someone else, so the caller answers
   * "not found" instead of writing to another account's row.
   *
   * Prisma's `update` needs a unique `where`, and ownership is two columns, so
   * the check and the write go in one transaction rather than being a
   * read-then-write that another request could slip between.
   */
  update(
    id: string,
    userId: string,
    data: Prisma.ItemUncheckedUpdateInput,
  ): Promise<ItemWithNearestLot | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const owned = await tx.item.findFirst({
          where: { id, userId },
          select: { id: true },
        });
        if (!owned) return null;

        return tx.item.update({ where: { id }, data, include: NEAREST_LOT });
      }),
    );
  }

  /** Soft delete, owner-scoped the same way as `update`. */
  delete(id: string, userId: string): Promise<Item | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const owned = await tx.item.findFirst({
          where: { id, userId },
          select: { id: true },
        });
        if (!owned) return null;

        return tx.item.update({
          where: { id },
          data: { active: false, deletedAt: new Date() },
        });
      }),
    );
  }
}
