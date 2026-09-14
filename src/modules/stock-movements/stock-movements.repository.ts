import { Injectable } from '@nestjs/common';
import { Item, Prisma, StockMovement, StockMovementType } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * What the history endpoint reads besides the movement itself: the item it
 * moved and, when the movement came from an appointment, the appointment the
 * app turns into a link.
 */
export const MOVEMENT_HISTORY_INCLUDE = {
  item: { select: { id: true, name: true, unit: true } },
  appointment: {
    select: { id: true, procedureName: true, patientName: true },
  },
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

  /**
   * The only insert into `stock_movement` in the codebase. It returns the row
   * with its item (and appointment, when there is one) already joined, because
   * every caller answers with the movement and would otherwise read it straight
   * back.
   */
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
   * Which of these ids the ledger already holds, and whose they are.
   *
   * Deliberately not scoped by user: a device generates its own UUIDs (ADR-09),
   * and an id that landed in someone else's account has to be told apart from
   * one the caller already sent. Treating the two the same would silently drop
   * a real consumption.
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
   */
  findCreatedAfter(
    userId: string,
    since: Date,
    take: number,
  ): Promise<MovementWithContext[]> {
    return runQuery(() =>
      this.prisma.stockMovement.findMany({
        where: { userId, createdAt: { gt: since } },
        include: MOVEMENT_HISTORY_INCLUDE,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take,
      }),
    );
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

  /**
   * When the item last received stock. Used to decide whether a manual purchase
   * is recent enough to set the item's price, without reading the ledger: the
   * `(item_id, occurred_at)` index answers it directly.
   */
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

  findItemById(userId: string, itemId: string): Promise<Item | null> {
    return runQuery(() =>
      this.prisma.item.findFirst({
        where: { id: itemId, userId, deletedAt: null },
      }),
    );
  }

  /**
   * Existence checks for the optional references a movement can carry. They all
   * scope by `userId`: the foreign key only proves the row exists, not that it
   * belongs to whoever is writing (ADR-11).
   */
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

  /**
   * One write per item per transaction. `currentQuantity` is the cache ADR-10
   * describes; `needsAdjustment`, `defaultUnitCost` and `active` ride along so a
   * movement never costs more than a single UPDATE on the row it already holds
   * locked.
   */
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
   * Runs `fn` in one transaction with every item row it will touch locked
   * (`SELECT ... FOR UPDATE`). This is what makes the ledger safe under
   * concurrency (ADR-10): simultaneous movements on the same item serialize on
   * the lock instead of racing on stale reads.
   *
   * The ids are locked in a single statement ordered by id, so two batches that
   * overlap always take their locks in the same order and cannot deadlock
   * against each other.
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
