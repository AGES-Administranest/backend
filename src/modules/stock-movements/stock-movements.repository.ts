import { Injectable } from '@nestjs/common';
import { Item, Prisma, StockMovement, StockMovementType } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

/** The origins the history resolves alongside the movement itself. */
export const MOVEMENT_HISTORY_INCLUDE = {
  item: { select: { id: true, name: true, unit: true } },
  appointment: {
    select: { id: true, procedureName: true, patientName: true },
  },
  // US12 asks the history to resolve the origin, not just point at it: an entry
  // that came from a received order has to say which supplier it came from, or
  // the screen needs a second round trip to be readable.
  supplier: { select: { id: true, name: true } },
  purchaseOrder: { select: { id: true, number: true, status: true } },
} as const;

export type MovementWithContext = Prisma.StockMovementGetPayload<{
  include: typeof MOVEMENT_HISTORY_INCLUDE;
}>;

/** The columns of `item` the ledger reads back after locking the row. */
const LOCKED_ITEM_COLUMNS = Prisma.sql`
  id,
  user_id            AS "userId",
  supplier_id        AS "supplierId",
  category,
  unit,
  name,
  default_unit_cost  AS "defaultUnitCost",
  minimum_stock      AS "minimumStock",
  current_quantity   AS "currentQuantity",
  needs_adjustment   AS "needsAdjustment",
  active,
  created_at         AS "createdAt",
  updated_at         AS "updatedAt",
  deleted_at         AS "deletedAt"
`;

/**
 * The only place the stock-movements module talks to the database (ADR-01).
 * Every method scopes by `userId` (ADR-11); the ledger is append-only, so there
 * is no update or delete of a movement here (ADR-10).
 */
@Injectable()
export class StockMovementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The only insert into `stock_movement`, with the origins already joined. */
  create(
    data: Prisma.StockMovementUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<MovementWithContext> {
    return runQuery(() =>
      (tx ?? this.prisma).stockMovement.create({
        data,
        include: MOVEMENT_HISTORY_INCLUDE,
      }),
    );
  }

  /**
   * Which of these ids the ledger already holds, and whose. Not scoped by user
   * on purpose: an id in someone else's account must be told apart from one the
   * caller already sent, or a real consumption is dropped in silence (ADR-09).
   */
  findOwnersOfIds(
    ids: readonly string[],
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; userId: string }[]> {
    return runQuery(() =>
      (tx ?? this.prisma).stockMovement.findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, userId: true },
      }),
    );
  }

  /**
   * Everything written to the ledger after `since`, for the delta pull.
   *
   * The cursor is `createdAt` — when the server stored the movement — not
   * `occurredAt`, which is when it happened on the device. A baixa registered
   * offline on Monday and synced on Friday has to reach the other devices on
   * Friday, and ordering by `occurredAt` would file it behind their cursor and
   * hide it forever.
   *
   * Soft-deleted rows are left out: the entity carries no `deletedAt`, so the
   * device would file one as a live movement.
   *
   * KNOWN GAP: if soft delete is ever used here, a device will not learn that a
   * movement it holds was removed — the row's `createdAt` stays behind the
   * cursor. Closing it needs a "last changed" column, which an append-only
   * table has no reason to carry. Solve that before the first soft delete.
   */
  findCreatedAfter(
    userId: string,
    since: Date,
    take: number,
  ): Promise<MovementWithContext[]> {
    return runQuery(() =>
      this.prisma.stockMovement.findMany({
        where: { userId, deletedAt: null, createdAt: { gt: since } },
        include: MOVEMENT_HISTORY_INCLUDE,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    );
  }

  /**
   * The page after `afterId`, in the same `(createdAt, id)` order, compared in
   * the database: a whole push shares one `created_at` (the transaction's), at
   * microseconds a JS `Date` cannot carry, so only the row itself can anchor
   * the next page. Null when the anchor is not one of this user's movements.
   */
  async findCreatedAfterMovement(
    userId: string,
    afterId: string,
    take: number,
  ): Promise<MovementWithContext[] | null> {
    const anchor = await runQuery(() =>
      this.prisma.stockMovement.findFirst({
        where: { id: afterId, userId },
        select: { id: true },
      }),
    );
    if (!anchor) return null;

    const page = await runQuery(
      () =>
        this.prisma.$queryRaw<{ id: string }[]>`
        SELECT m.id
        FROM "stock_movement" m,
          (SELECT created_at, id FROM "stock_movement" WHERE id = ${afterId}::uuid) a
        WHERE m.user_id = ${userId}::uuid
          AND m.deleted_at IS NULL
          AND (m.created_at, m.id) > (a.created_at, a.id)
        ORDER BY m.created_at, m.id
        LIMIT ${take}
      `,
    );
    if (page.length === 0) return [];

    const rows = await runQuery(() =>
      this.prisma.stockMovement.findMany({
        where: { id: { in: page.map(row => row.id) } },
        include: MOVEMENT_HISTORY_INCLUDE,
      }),
    );
    const byId = new Map(rows.map(row => [row.id, row]));
    return page.map(row => byId.get(row.id)!);
  }

  /** Current cached balance of the given items, for the app to reconcile against. */
  findItemBalances(
    userId: string,
    itemIds: readonly string[],
  ): Promise<
    {
      id: string;
      name: string;
      currentQuantity: Prisma.Decimal;
      needsAdjustment: boolean;
    }[]
  > {
    return runQuery(() =>
      this.prisma.item.findMany({
        where: { userId, id: { in: [...itemIds] } },
        select: {
          id: true,
          name: true,
          currentQuantity: true,
          needsAdjustment: true,
        },
      }),
    );
  }

  /** When the item last received stock — decides if a purchase sets the price. */
  async latestInboundOccurredAt(
    userId: string,
    itemId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Date | null> {
    const latest = await runQuery(() =>
      (tx ?? this.prisma).stockMovement.findFirst({
        where: {
          userId,
          itemId,
          deletedAt: null,
          type: StockMovementType.INBOUND,
        },
        orderBy: { occurredAt: 'desc' },
        select: { occurredAt: true },
      }),
    );
    return latest?.occurredAt ?? null;
  }

  /**
   * The item's balance, summed by the database from the ledger itself (ADR-10).
   *
   * Grouping by `type` and letting Postgres add the rows keeps this O(rows) in
   * the database instead of shipping every movement to Node just to fold it —
   * which matters because an append-only ledger only ever grows, and this runs
   * inside the row lock on every single write.
   */
  async balanceOf(
    userId: string,
    itemId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Prisma.Decimal> {
    const totals = await runQuery(() =>
      (tx ?? this.prisma).stockMovement.groupBy({
        by: ['type'],
        where: { userId, itemId, deletedAt: null },
        _sum: { quantity: true },
      }),
    );

    return totals.reduce((balance, group) => {
      const sum = group._sum.quantity ?? new Prisma.Decimal(0);
      return group.type === StockMovementType.INBOUND
        ? balance.plus(sum)
        : balance.minus(sum);
    }, new Prisma.Decimal(0));
  }

  /** Full history of one item — the reconciliation routine, never the write path. */
  findMovementsByItem(
    userId: string,
    itemId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<StockMovement[]> {
    return runQuery(() =>
      (tx ?? this.prisma).stockMovement.findMany({
        where: { userId, itemId },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
    );
  }

  /** The history the app lists: newest first, ties broken by id (ascending). */
  findHistory(
    where: Prisma.StockMovementWhereInput,
    skip: number,
    take: number,
  ): Promise<MovementWithContext[]> {
    return runQuery(() =>
      this.prisma.stockMovement.findMany({
        where,
        include: MOVEMENT_HISTORY_INCLUDE,
        orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
        skip,
        take,
      }),
    );
  }

  /** Every movement in the period. No pagination: a partial summary would lie. */
  findForSummary(
    where: Prisma.StockMovementWhereInput,
  ): Promise<MovementWithContext[]> {
    return runQuery(() =>
      this.prisma.stockMovement.findMany({
        where,
        include: MOVEMENT_HISTORY_INCLUDE,
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      }),
    );
  }

  /** Balance before `before`, from the ledger — not today's `current_quantity`. */
  async balanceBefore(
    userId: string,
    itemId: string,
    before: Date,
  ): Promise<Prisma.Decimal> {
    const totals = await runQuery(() =>
      this.prisma.stockMovement.groupBy({
        by: ['type'],
        where: {
          userId,
          itemId,
          deletedAt: null,
          occurredAt: { lt: before },
        },
        _sum: { quantity: true },
      }),
    );

    return totals.reduce((balance, group) => {
      const sum = group._sum.quantity ?? new Prisma.Decimal(0);
      return group.type === StockMovementType.INBOUND
        ? balance.plus(sum)
        : balance.minus(sum);
    }, new Prisma.Decimal(0));
  }

  findItemById(userId: string, itemId: string): Promise<Item | null> {
    return runQuery(() =>
      this.prisma.item.findFirst({
        where: { id: itemId, userId, deletedAt: null },
      }),
    );
  }

  /** Reference checks, all scoped by `userId`: the FK alone proves nothing (ADR-11). */
  async supplierExists(
    userId: string,
    supplierId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const found = await runQuery(() =>
      (tx ?? this.prisma).supplier.findFirst({
        where: { id: supplierId, userId, deletedAt: null },
        select: { id: true },
      }),
    );
    return found !== null;
  }

  async appointmentExists(
    userId: string,
    appointmentId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const found = await runQuery(() =>
      (tx ?? this.prisma).appointment.findFirst({
        where: { id: appointmentId, userId, deletedAt: null },
        select: { id: true },
      }),
    );
    return found !== null;
  }

  async purchaseOrderExists(
    userId: string,
    purchaseOrderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const found = await runQuery(() =>
      (tx ?? this.prisma).purchaseOrder.findFirst({
        where: { id: purchaseOrderId, userId, deletedAt: null },
        select: { id: true },
      }),
    );
    return found !== null;
  }

  /** `item_lot` has no `user_id`: ownership is inherited through the item. */
  async lotBelongsToItem(
    itemId: string,
    lotId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const lot = await runQuery(() =>
      (tx ?? this.prisma).itemLot.findFirst({
        where: { id: lotId, itemId },
        select: { id: true },
      }),
    );
    return lot !== null;
  }

  /** One UPDATE per item per transaction, on the row already held locked. */
  updateItem(
    itemId: string,
    data: Prisma.ItemUncheckedUpdateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<Item> {
    return runQuery(() =>
      (tx ?? this.prisma).item.update({ where: { id: itemId }, data }),
    );
  }

  /**
   * Runs `fn` in one transaction with every item row locked (`SELECT ... FOR
   * UPDATE`), which is what makes the ledger safe under concurrency (ADR-10).
   * Locked in one statement ordered by id, so overlapping batches cannot deadlock.
   */
  async withLockedItems<T>(
    itemIds: readonly string[],
    fn: (
      tx: Prisma.TransactionClient,
      lockedItems: Map<string, Item>,
    ) => Promise<T>,
  ): Promise<T> {
    const uniqueIds = [...new Set(itemIds)];

    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const rows = await tx.$queryRaw<Item[]>`
          SELECT ${LOCKED_ITEM_COLUMNS}
          FROM "item"
          WHERE id IN (${Prisma.join(
            uniqueIds.map(id => Prisma.sql`${id}::uuid`),
          )})
          ORDER BY id
          FOR UPDATE
        `;

        return fn(tx, new Map(rows.map(row => [row.id, row])));
      }),
    );
  }
}
