import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * The records a procedure estimate (US21) points at, read only and scoped to
 * the owner (ADR-11): someone else's client or item, or a deleted one, is not
 * found.
 */
@Injectable()
export class ProcedureEstimateRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Inactive clients count: a quote for a client seen before is still valid. */
  async clientExists(userId: string, clientId: string): Promise<boolean> {
    const client = await runQuery(() =>
      this.prisma.client.findFirst({
        where: { id: clientId, userId, deletedAt: null },
        select: { id: true },
      }),
    );
    return client !== null;
  }

  /** The unit cost of each item found; missing ids are simply absent. */
  findItemCosts(
    userId: string,
    itemIds: readonly string[],
  ): Promise<{ id: string; defaultUnitCost: Prisma.Decimal | null }[]> {
    return runQuery(() =>
      this.prisma.item.findMany({
        where: { id: { in: [...itemIds] }, userId, deletedAt: null },
        select: { id: true, defaultUnitCost: true },
      }),
    );
  }
}
