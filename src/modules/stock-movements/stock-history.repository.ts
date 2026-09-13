import { Injectable } from '@nestjs/common';
import {
  Item,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** History filters, already converted from the query string. */
export interface StockHistoryFilter {
  itemId?: string;
  /** inclusive lower bound on `occurredAt` */
  from?: Date;
  /** inclusive upper bound on `occurredAt` */
  to?: Date;
  type?: StockMovementType;
  source?: StockMovementSource;
}

export interface PageRequest {
  /** 1-based */
  page: number;
  limit: number;
}

/**
 * Relations resolved together with each history row. Prisma runs one extra
 * query per relation for the whole page (`WHERE id IN (...)`), never one per
 * row — this is what keeps the history free of N+1 (US12).
 */
const historyInclude = {
  item: { select: { id: true, name: true, unit: true } },
  appointment: {
    select: {
      id: true,
      patientName: true,
      procedureName: true,
      startsAt: true,
    },
  },
  purchaseOrder: {
    select: {
      id: true,
      number: true,
      supplier: { select: { id: true, name: true } },
    },
  },
  supplier: { select: { id: true, name: true } },
} satisfies Prisma.StockMovementInclude;

/** A history row: the movement plus its resolved origins. */
export type StockHistoryRow = Prisma.StockMovementGetPayload<{
  include: typeof historyInclude;
}>;

/** Only what the period summary needs — the whole period is loaded at once. */
const summarySelect = {
  type: true,
  source: true,
  adjustmentReason: true,
  quantity: true,
  unitCost: true,
  deletedAt: true,
  appointment: { select: { procedureName: true } },
} satisfies Prisma.StockMovementSelect;

export type StockSummaryRow = Prisma.StockMovementGetPayload<{
  select: typeof summarySelect;
}>;

/** Sum of `quantity` per direction; `null` when that direction had no rows. */
export interface QuantityByType {
  inbound: Prisma.Decimal | null;
  outbound: Prisma.Decimal | null;
}

/**
 * The `where` shared by every history query. Exported so the optional filters
 * can be unit-tested without a database. `userId` and `deletedAt: null` are
 * always present: the first is ADR-11, the second because a soft-deleted
 * movement was "never there" (see the `StockMovement` doc-comment).
 */
export function buildHistoryWhere(
  userId: string,
  filter: StockHistoryFilter,
): Prisma.StockMovementWhereInput {
  const occurredAt = {
    ...(filter.from && { gte: filter.from }),
    ...(filter.to && { lte: filter.to }),
  };

  return {
    userId,
    deletedAt: null,
    ...(filter.itemId && { itemId: filter.itemId }),
    ...(filter.type && { type: filter.type }),
    ...(filter.source && { source: filter.source }),
    ...((filter.from || filter.to) && { occurredAt }),
  };
}

/**
 * Read side of the stock ledger (ADR-01). Every method is scoped by `userId`
 * (ADR-11) and goes through `runQuery`. Nothing here writes: the single write
 * path of the ledger is `StockMovementsService.record()` in the
 * `feat/stock-movement-service` branch.
 */
@Injectable()
export class StockHistoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The item, only if it belongs to the user and is not soft-deleted. */
  findItemById(userId: string, itemId: string): Promise<Item | null> {
    return runQuery(() =>
      this.prisma.item.findFirst({
        where: { id: itemId, userId, deletedAt: null },
      }),
    );
  }

  /** One page, newest first. Ties broken by id so two pages never overlap. */
  findPage(
    userId: string,
    filter: StockHistoryFilter,
    { page, limit }: PageRequest,
  ): Promise<StockHistoryRow[]> {
    return runQuery(() =>
      this.prisma.stockMovement.findMany({
        where: buildHistoryWhere(userId, filter),
        include: historyInclude,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    );
  }

  count(userId: string, filter: StockHistoryFilter): Promise<number> {
    return runQuery(() =>
      this.prisma.stockMovement.count({
        where: buildHistoryWhere(userId, filter),
      }),
    );
  }

  /** Every movement of the period, no pagination: the summary needs all of them. */
  findForSummary(
    userId: string,
    filter: StockHistoryFilter,
  ): Promise<StockSummaryRow[]> {
    return runQuery(() =>
      this.prisma.stockMovement.findMany({
        where: buildHistoryWhere(userId, filter),
        select: summarySelect,
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
    );
  }

  /**
   * Sum of `quantity` per direction over the item's movements strictly before
   * `before`. Raw material of the opening balance: it comes from the ledger,
   * never from the `item.currentQuantity` cache (US12).
   */
  async sumQuantityByTypeBefore(
    userId: string,
    itemId: string,
    before: Date,
  ): Promise<QuantityByType> {
    const rows = await runQuery(() =>
      this.prisma.stockMovement.groupBy({
        by: ['type'],
        where: { userId, itemId, deletedAt: null, occurredAt: { lt: before } },
        _sum: { quantity: true },
      }),
    );

    const sumOf = (type: StockMovementType): Prisma.Decimal | null =>
      rows.find(row => row.type === type)?._sum.quantity ?? null;

    return {
      inbound: sumOf(StockMovementType.INBOUND),
      outbound: sumOf(StockMovementType.OUTBOUND),
    };
  }
}
