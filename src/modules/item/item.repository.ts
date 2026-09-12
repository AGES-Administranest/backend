import { Injectable } from '@nestjs/common';
import { Item, MeasurementUnit, Prisma } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class ItemRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(
    where: Prisma.ItemWhereInput = { active: true },
    orderBy: Prisma.ItemOrderByWithRelationInput = { name: 'asc' },
    skip?: number,
    take?: number,
  ): Promise<Item[]> {
    return runQuery(() =>
      this.prisma.item.findMany({ where, orderBy, skip, take }),
    );
  }

  /**
   * Scoped to the owner (ADR-11), and `findFirst` rather than `findUnique`
   * because the filter is on two columns. Someone else's item comes back null,
   * which the service reports as "not found" — the same answer as an id that
   * never existed, so the response cannot be used to probe for other people's
   * records.
   */
  findById(id: string, userId: string): Promise<Item | null> {
    return runQuery(() =>
      this.prisma.item.findFirst({ where: { id, userId } }),
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

  create(data: Prisma.ItemUncheckedCreateInput): Promise<Item> {
    return runQuery(() => this.prisma.item.create({ data }));
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
  ): Promise<Item | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const owned = await tx.item.findFirst({
          where: { id, userId },
          select: { id: true },
        });
        if (!owned) return null;

        return tx.item.update({ where: { id }, data });
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
