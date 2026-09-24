import { Injectable } from '@nestjs/common';
import { Client, Prisma } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class ClientRepository {
  constructor(private readonly prisma: PrismaService) {}

  findMany(where: Prisma.ClientWhereInput): Promise<Client[]> {
    return runQuery(() =>
      this.prisma.client.findMany({
        where: { ...where, deletedAt: null },
        orderBy: { name: 'asc' },
      }),
    );
  }

  /**
   * Scoped to the owner (ADR-11). Someone else's client, or a deleted one,
   * comes back null, which the service reports as "not found".
   */
  findById(id: string, userId: string): Promise<Client | null> {
    return runQuery(() =>
      this.prisma.client.findFirst({
        where: { id, userId, deletedAt: null },
      }),
    );
  }

  findByName(
    userId: string,
    name: string,
    excludeId?: string,
  ): Promise<Client | null> {
    return runQuery(() =>
      this.prisma.client.findFirst({
        where: {
          userId,
          name,
          active: true,
          deletedAt: null,
          ...(excludeId ? { id: { not: excludeId } } : {}),
        },
      }),
    );
  }

  create(data: Prisma.ClientUncheckedCreateInput): Promise<Client> {
    return runQuery(() => this.prisma.client.create({ data }));
  }

  /**
   * Returns null when the client belongs to someone else or was deleted.
   * The ownership check and the write share a transaction, as in `item`.
   */
  update(
    id: string,
    userId: string,
    data: Prisma.ClientUncheckedUpdateInput,
  ): Promise<Client | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const owned = await tx.client.findFirst({
          where: { id, userId, deletedAt: null },
          select: { id: true },
        });
        if (!owned) return null;

        return tx.client.update({ where: { id }, data });
      }),
    );
  }

  /** Soft delete, owner-scoped the same way as `update`. */
  delete(id: string, userId: string): Promise<Client | null> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const owned = await tx.client.findFirst({
          where: { id, userId, deletedAt: null },
          select: { id: true },
        });
        if (!owned) return null;

        return tx.client.update({
          where: { id },
          data: { active: false, deletedAt: new Date() },
        });
      }),
    );
  }
}
