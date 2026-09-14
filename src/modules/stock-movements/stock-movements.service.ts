import { Injectable } from '@nestjs/common';
import {
  AdjustmentReason,
  Item,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import {
  type DecimalInput,
  assertPositiveQuantity,
  assertSufficientBalance,
  assertValidMovement,
  balanceRequiresAdjustment,
  movementForDelta,
  stockBalance,
} from './domain/stock-movement.rules';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { CreateStockCountDto } from './dto/create-stock-count.dto';
import { CreateStockPurchaseDto } from './dto/create-stock-purchase.dto';
import { QueryStockMovementDto } from './dto/query-stock-movement.dto';
import { StockBalanceReconciliationEntity } from './entities/stock-balance-reconciliation.entity';
import { StockMovementResultEntity } from './entities/stock-movement-result.entity';
import { StockMovementEntity } from './entities/stock-movement.entity';
import {
  StockSyncPullEntity,
  StockSyncPushEntity,
  SyncedItemBalanceEntity,
} from './entities/stock-sync.entity';
import {
  MovementWithContext,
  StockMovementsRepository,
} from './stock-movements.repository';
import { InvalidReferenceError } from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

/**
 * Decides, inside the ledger's transaction and row lock, which lot the movement
 * belongs to — creating it or topping it up on the way.
 *
 * This is how receiving a lot stays a single write path: the caller owns the
 * lot rules (which expiration date joins which lot), the ledger owns the
 * movement and the balance, and both land in one transaction. `unitCost`
 * overrides the input's when the lot already exists and carries its own price.
 */
export type LotResolver = (
  tx: Prisma.TransactionClient,
) => Promise<{ lotId: string; unitCost?: DecimalInput }>;

/** Everything the central ledger needs to record one movement. */
export interface RecordMovementInput {
  /**
   * Only set when the movement was created on a device (ADR-09). The server
   * generates it otherwise. It is what makes a re-sent batch idempotent.
   */
  id?: string;
  itemId: string;
  lotId?: string | null;
  /** Alternative to `lotId` when the lot is created by this very movement. */
  resolveLot?: LotResolver;
  type: StockMovementType;
  source: StockMovementSource;
  /** positive magnitude — the sign comes from `type` */
  quantity: DecimalInput;
  /** cost snapshot for the movement */
  unitCost: DecimalInput;
  occurredAt: Date;
  adjustmentReason?: AdjustmentReason | null;
  appointmentId?: string | null;
  purchaseOrderId?: string | null;
  supplierId?: string | null;
  notes?: string | null;
}

export interface RecordMovementResult {
  movement: MovementWithContext;
  /** the item balance after the movement, from the ledger (ADR-10) */
  balance: Prisma.Decimal;
  /** the new balance is at or under `item.minimumStock` — US11 */
  belowMinimum: boolean;
  /** the item is flagged as needing a physical count — US10 */
  needsAdjustment: boolean;
}

export interface RecordOptions {
  /**
   * Lets an outbound drive the balance below zero. The US10 correction reversal
   * is the reason this exists: it undoes stock that was never physically there,
   * so it has to go through even though the result is negative. Off by default.
   */
  allowNegativeBalance?: boolean;
  /**
   * Turns `item.needsAdjustment` back off when the resulting balance is not
   * negative. Only the physical count sets this: an ordinary movement does not
   * answer the question the flag is asking.
   */
  clearsNeedsAdjustment?: boolean;
  /**
   * Extra columns to merge into the item's single UPDATE, decided inside the
   * lock. Used by the manual purchase to carry the new unit cost.
   */
  itemPatch?: (
    tx: Prisma.TransactionClient,
    context: { movement: MovementWithContext; lockedItem: Item },
  ) => Promise<Prisma.ItemUncheckedUpdateInput>;
}

/**
 * A movement recorded on a device. Same shape as any other, except the id is
 * not optional: it is the device's UUID (ADR-09) and the only thing that makes
 * re-sending the batch safe.
 */
export interface SyncMovementInput extends RecordMovementInput {
  id: string;
}

/** A movement that has been validated and priced, ready to be written. */
interface PreparedMovement extends RecordMovementInput {
  quantity: Prisma.Decimal;
  unitCost: Prisma.Decimal;
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * How far back the pull cursor is rewound, per ADR-08: a row written inside a
 * transaction that commits late carries an earlier `createdAt` than rows
 * already handed out, and a strict cursor would step over it forever. Re-sending
 * a few seconds of overlap costs nothing here, because the device applies
 * movements by id and a repeat is a no-op.
 */
const SYNC_CURSOR_OVERLAP_MS = 5_000;

/** Ceiling on one delta page, so a device that was offline for weeks still gets an answer. */
const SYNC_PULL_LIMIT = 500;

/**
 * The stock ledger's single write path.
 *
 * `record` and `recordBatch` are the only places a `stock_movement` row is
 * created. They persist the movement, recompute the balance from the ledger,
 * refresh the `item.currentQuantity` cache, run the minimum-stock check and
 * flip `needsAdjustment` when the balance goes negative (ADR-10, US10). Every
 * use case — the manual adjustment and purchase here, the appointment and
 * import flows later — goes through them, which is what keeps the sum of the
 * history and the cached balance from ever disagreeing.
 *
 * Knows nothing about HTTP: failures are `DomainError` (ADR-07).
 */
@Injectable()
export class StockMovementsService {
  constructor(private readonly repository: StockMovementsRepository) {}

  /** Records one movement. A batch of one, with the same guarantees. */
  async record(
    userId: string,
    input: RecordMovementInput,
    options: RecordOptions = {},
  ): Promise<RecordMovementResult> {
    const [result] = await this.recordBatch(userId, [input], options);
    return result;
  }

  /**
   * Records several movements atomically — the items of one appointment, the
   * lines of one received order.
   *
   * All of it lands or none of it does: one transaction, every item row locked
   * up front, and the balance of an item that appears more than once carried
   * forward between its own movements so the third line sees what the first two
   * did. An item left short by line 3 rolls back lines 1 and 2 with it.
   */
  async recordBatch(
    userId: string,
    inputs: readonly RecordMovementInput[],
    options: RecordOptions = {},
  ): Promise<RecordMovementResult[]> {
    if (inputs.length === 0) {
      throw new DomainError(
        'INVALID_INPUT',
        'STOCK_MOVEMENT_BATCH_EMPTY',
        'A stock movement batch needs at least one movement',
      );
    }

    const prepared = inputs.map(input => this.prepare(input));

    return this.runLedgerWrite(() =>
      this.repository.withLockedItems(
        prepared.map(input => input.itemId),
        async (tx, lockedItems) => {
          /** Balance per item as the batch walks through it. */
          const balances = new Map<string, Prisma.Decimal>();
          /**
           * The flag as the batch walks through it, so a movement that digs
           * into the red still leaves the item marked even if a later line of
           * the same batch brings the balance back up. Reading `lockedItem`
           * every time would report an alert the stored row then contradicts.
           */
          const flags = new Map<string, boolean>();
          /** The single UPDATE each touched item gets at the end. */
          const patches = new Map<string, Prisma.ItemUncheckedUpdateInput>();
          const results: RecordMovementResult[] = [];

          for (const input of prepared) {
            const lockedItem = lockedItems.get(input.itemId);
            if (
              !lockedItem ||
              lockedItem.userId !== userId ||
              lockedItem.deletedAt
            ) {
              throw this.itemNotFound(input.itemId);
            }

            // The lot is settled first: it has to exist before the movement can
            // point at it, and the caller's rules for it belong inside this
            // lock too.
            const lot = input.resolveLot ? await input.resolveLot(tx) : null;
            const resolved: PreparedMovement = {
              ...input,
              lotId: lot?.lotId ?? input.lotId ?? null,
              unitCost:
                lot?.unitCost === undefined
                  ? input.unitCost
                  : new Prisma.Decimal(lot.unitCost),
            };

            await this.assertReferencesExist(tx, userId, resolved);

            const balanceBefore =
              balances.get(resolved.itemId) ??
              (await this.repository.balanceOf(userId, resolved.itemId, tx));

            const balance = assertSufficientBalance(balanceBefore, resolved, {
              allowNegativeBalance: options.allowNegativeBalance ?? false,
            });

            const movement = await this.repository.create(
              {
                ...(resolved.id ? { id: resolved.id } : {}),
                userId,
                itemId: resolved.itemId,
                lotId: resolved.lotId ?? null,
                type: resolved.type,
                source: resolved.source,
                adjustmentReason: resolved.adjustmentReason ?? null,
                appointmentId: resolved.appointmentId ?? null,
                purchaseOrderId: resolved.purchaseOrderId ?? null,
                supplierId: resolved.supplierId ?? null,
                quantity: resolved.quantity,
                unitCost: resolved.unitCost,
                occurredAt: resolved.occurredAt,
                notes: resolved.notes ?? null,
              },
              tx,
            );
            balances.set(input.itemId, balance);

            const needsAdjustment = this.nextNeedsAdjustment(
              flags.get(input.itemId) ?? lockedItem.needsAdjustment,
              balance,
              options.clearsNeedsAdjustment ?? false,
            );
            flags.set(input.itemId, needsAdjustment);

            patches.set(input.itemId, {
              ...patches.get(input.itemId),
              currentQuantity: balance,
              needsAdjustment,
              ...(options.itemPatch
                ? await options.itemPatch(tx, { movement, lockedItem })
                : {}),
            });

            results.push({
              movement,
              balance,
              belowMinimum: this.isBelowMinimum(lockedItem, balance),
              needsAdjustment,
            });
          }

          for (const [itemId, patch] of patches) {
            await this.repository.updateItem(itemId, patch, tx);
          }

          return results;
        },
      ),
    );
  }

  /** The history the app lists, newest first. */
  async findHistory(
    userId: string,
    query: QueryStockMovementDto,
  ): Promise<StockMovementEntity[]> {
    const where: Prisma.StockMovementWhereInput = {
      userId,
      deletedAt: null,
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.source?.length ? { source: { in: query.source } } : {}),
      // Shorter than two characters matches almost everything, so it is not a
      // filter — same threshold `GET /item` uses.
      ...(query.search && query.search.length >= 2
        ? {
            item: {
              name: { contains: escapeLike(query.search), mode: 'insensitive' },
            },
          }
        : {}),
      ...(query.periodStart || query.periodEnd
        ? {
            occurredAt: {
              ...(query.periodStart
                ? { gte: startOfPeriod(query.periodStart) }
                : {}),
              ...(query.periodEnd ? { lte: endOfPeriod(query.periodEnd) } : {}),
            },
          }
        : {}),
    };

    const movements = await this.repository.findHistory(
      where,
      (query.page - 1) * query.limit,
      query.limit,
    );

    return movements.map(movement => this.sanitize(movement));
  }

  /**
   * US11: a manual outbound adjustment — something was lost, expired, broke.
   *
   * The screen sends what it knows (which item, how much, why). Direction,
   * origin, cost and timestamp are decided here: a loss is not an event the
   * client gets to price or backdate.
   */
  async registerAdjustment(
    userId: string,
    dto: CreateStockAdjustmentDto,
  ): Promise<StockMovementResultEntity> {
    const item = await this.loadItem(userId, dto.itemId);

    const result = await this.record(userId, {
      itemId: dto.itemId,
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.MANUAL_ADJUSTMENT,
      adjustmentReason: dto.reason,
      quantity: dto.quantity,
      // The cost the item carries today. There is no lot to price a loss
      // against, and the history needs a number to show.
      unitCost: item.defaultUnitCost ?? new Prisma.Decimal(0),
      // The server's clock, not the client's: `occurredAt` is when the system
      // learned about the loss, and letting a phone with a wrong date decide it
      // would silently reorder the history.
      occurredAt: new Date(),
      notes: dto.notes ?? null,
    });

    return this.toResultEntity(result);
  }

  /**
   * US10: the physical count that closes the `needsAdjustment` loop.
   *
   * A correction reversal can leave the balance negative — the ledger saying
   * the inventory was wrong. No outbound can fix that (there is nothing left to
   * take out), so the only honest input is the number counted on the shelf. The
   * difference becomes one more movement, in whichever direction it needs to
   * be: the ledger stays append-only, and the flag comes off.
   */
  async registerCount(
    userId: string,
    dto: CreateStockCountDto,
  ): Promise<StockMovementResultEntity> {
    const item = await this.loadItem(userId, dto.itemId);
    const balance = await this.repository.balanceOf(userId, dto.itemId);
    const delta = new Prisma.Decimal(dto.countedQuantity).minus(balance);
    const movement = movementForDelta(delta);

    if (!movement) {
      throw new DomainError(
        'INVALID_INPUT',
        'STOCK_QUANTITY_INVALID',
        'The counted quantity already matches the balance — nothing to adjust',
        { countedQuantity: String(dto.countedQuantity) },
      );
    }

    const result = await this.record(
      userId,
      {
        itemId: dto.itemId,
        type: movement.type,
        source: StockMovementSource.MANUAL_ADJUSTMENT,
        adjustmentReason: AdjustmentReason.OTHER,
        quantity: movement.quantity,
        unitCost: item.defaultUnitCost ?? new Prisma.Decimal(0),
        occurredAt: new Date(),
        notes: dto.notes ?? `Physical count: ${dto.countedQuantity}`,
      },
      { clearsNeedsAdjustment: true },
    );

    return this.toResultEntity(result);
  }

  /**
   * Manual purchase entry: a purchase typed in by hand, for the cases with no
   * order or invoice to import (over-the-counter, a supplier that issues no
   * PDF). The item's cost becomes the price paid — unless this entry is
   * backdated behind a more recent purchase, which must not have its price
   * overwritten by older news.
   *
   * Note: a manual purchase is also an EXPENSE / MANUAL financial event (money
   * left to buy supplies). US03 owns that; it is intentionally NOT emitted here
   * until the financial module exists.
   */
  async registerPurchase(
    userId: string,
    dto: CreateStockPurchaseDto,
  ): Promise<StockMovementResultEntity> {
    const occurredAt = new Date(dto.date);
    if (occurredAt.getTime() > Date.now()) {
      throw new DomainError(
        'INVALID_INPUT',
        'STOCK_MOVEMENT_DATE_IN_FUTURE',
        'A purchase cannot be dated in the future.',
        { date: dto.date },
      );
    }

    const unitCost = new Prisma.Decimal(dto.unitValue);

    const result = await this.record(
      userId,
      {
        itemId: dto.itemId,
        type: StockMovementType.INBOUND,
        source: StockMovementSource.MANUAL_PURCHASE,
        quantity: dto.quantity,
        unitCost,
        occurredAt,
        supplierId: dto.supplierId ?? null,
        notes: dto.notes ?? null,
      },
      {
        itemPatch: async tx => {
          const latestInbound = await this.repository.latestInboundOccurredAt(
            userId,
            dto.itemId,
            tx,
          );
          // The movement just written is already in that maximum, so a tie
          // means this purchase is the newest one.
          const isLatestPrice =
            latestInbound === null ||
            occurredAt.getTime() >= latestInbound.getTime();

          return isLatestPrice
            ? { defaultUnitCost: unitCost, active: true }
            : { active: true };
        },
      },
    );

    return this.toResultEntity(result);
  }

  /**
   * Applies a batch of movements recorded while the device had no connection.
   *
   * Three things make this different from an ordinary batch:
   *
   * - **Idempotent.** The ids come from the device (ADR-09), so a batch that was
   *   half-delivered before the network dropped can be re-sent whole. Ids the
   *   ledger already holds are reported back, not applied again — the failure
   *   this prevents is taking the same stock out twice, which nobody notices
   *   until an appointment runs short.
   * - **Chronological.** Movements are applied in `occurredAt` order, never in
   *   the order they happened to arrive.
   * - **Never refuses a negative balance.** If another device already took that
   *   stock out, the offline consumption still happened — the answer is to
   *   record it and flag the item for a count, not to pretend it did not.
   *
   * Movements referencing an item that only exists on the device fail the whole
   * batch with `ITEM_NOT_FOUND`: items have to be synced before movements.
   */
  async syncPush(
    userId: string,
    movements: readonly SyncMovementInput[],
  ): Promise<StockSyncPushEntity> {
    if (movements.length === 0) {
      throw new DomainError(
        'INVALID_INPUT',
        'STOCK_MOVEMENT_BATCH_EMPTY',
        'A sync batch needs at least one movement',
      );
    }

    const owners = await this.repository.findOwnersOfIds(
      movements.map(movement => movement.id),
    );
    const alreadyMine = new Set(
      owners.filter(row => row.userId === userId).map(row => row.id),
    );
    const someoneElses = owners.find(row => row.userId !== userId);
    if (someoneElses) {
      // A UUID cannot collide by chance. Skipping it would drop a real
      // movement; applying it would fail on the primary key anyway.
      throw new DomainError(
        'CONFLICT',
        'STOCK_MOVEMENT_ID_CONFLICT',
        'A movement id in this batch already belongs to another account',
        { id: someoneElses.id },
      );
    }

    const pending = movements
      .filter(movement => !alreadyMine.has(movement.id))
      // Chronological, with the id breaking ties so the same batch always
      // applies in the same order.
      .sort(
        (a, b) =>
          a.occurredAt.getTime() - b.occurredAt.getTime() ||
          a.id.localeCompare(b.id),
      );

    const applied =
      pending.length > 0
        ? await this.recordBatch(userId, pending, {
            allowNegativeBalance: true,
          })
        : [];

    const touchedItems = [
      ...new Set(movements.map(movement => movement.itemId)),
    ];

    return {
      applied: applied.map(result => this.sanitize(result.movement)),
      duplicated: movements
        .filter(movement => alreadyMine.has(movement.id))
        .map(movement => movement.id),
      balances: await this.itemBalances(userId, touchedItems),
      needsAdjustment: [
        ...new Set(
          applied
            .filter(result => result.needsAdjustment)
            .map(result => result.movement.itemId),
        ),
      ],
    };
  }

  /**
   * Everything written to the ledger since the device's cursor, plus where each
   * affected item now stands.
   *
   * The balances ride along on purpose: without them the device would have to
   * replay its entire local history to work out a single item's quantity, and
   * any gap in that history would go unnoticed.
   */
  async syncPull(userId: string, since: Date): Promise<StockSyncPullEntity> {
    const from = new Date(since.getTime() - SYNC_CURSOR_OVERLAP_MS);
    const movements = await this.repository.findCreatedAfter(
      userId,
      from,
      SYNC_PULL_LIMIT,
    );

    const touchedItems = [...new Set(movements.map(m => m.itemId))];
    const latest = movements.at(-1)?.createdAt;

    return {
      movements: movements.map(movement => this.sanitize(movement)),
      balances: await this.itemBalances(userId, touchedItems),
      // A full page means there is more to come: the device should pull again
      // from here rather than assume it is up to date.
      cursor: latest ?? since,
    };
  }

  private async itemBalances(
    userId: string,
    itemIds: readonly string[],
  ): Promise<SyncedItemBalanceEntity[]> {
    if (itemIds.length === 0) return [];
    const items = await this.repository.findItemBalances(userId, itemIds);
    return items.map(item => ({
      itemId: item.id,
      itemName: item.name,
      currentQuantity: item.currentQuantity.toString(),
      needsAdjustment: item.needsAdjustment,
    }));
  }

  /**
   * Verification/support routine, not part of the write path: recomputes an
   * item's balance from the full movement history and reconciles
   * `item.currentQuantity` if it drifted. Useful in tests, and in support when
   * investigating a suspected divergence between the ledger and the cache.
   */
  reconcileItemBalance(
    userId: string,
    itemId: string,
  ): Promise<StockBalanceReconciliationEntity> {
    return this.repository.withLockedItems(
      [itemId],
      async (tx, lockedItems) => {
        const lockedItem = lockedItems.get(itemId);
        if (
          !lockedItem ||
          lockedItem.userId !== userId ||
          lockedItem.deletedAt
        ) {
          throw this.itemNotFound(itemId);
        }

        const movements = await this.repository.findMovementsByItem(
          userId,
          itemId,
          tx,
        );
        const reconciledBalance = stockBalance(movements);
        const previousBalance = lockedItem.currentQuantity;
        const wasDivergent = !previousBalance.equals(reconciledBalance);

        if (wasDivergent) {
          await this.repository.updateItem(
            itemId,
            {
              currentQuantity: reconciledBalance,
              // A negative balance always means "count this item". The flag is
              // never cleared here: only the user's count answers it.
              ...(balanceRequiresAdjustment(reconciledBalance)
                ? { needsAdjustment: true }
                : {}),
            },
            tx,
          );
        }

        return {
          previousBalance: previousBalance.toString(),
          reconciledBalance: reconciledBalance.toString(),
          wasDivergent,
        };
      },
    );
  }

  private async loadItem(userId: string, itemId: string): Promise<Item> {
    const item = await this.repository.findItemById(userId, itemId);
    if (!item) throw this.itemNotFound(itemId);
    return item;
  }

  /** Normalizes and validates an input before anything is written. */
  private prepare(input: RecordMovementInput): PreparedMovement {
    assertValidMovement({
      type: input.type,
      source: input.source,
      quantity: input.quantity,
      adjustmentReason: input.adjustmentReason ?? null,
      appointmentId: input.appointmentId ?? null,
      purchaseOrderId: input.purchaseOrderId ?? null,
      notes: input.notes ?? null,
    });

    return {
      ...input,
      quantity: assertPositiveQuantity(input.quantity),
      unitCost: new Prisma.Decimal(input.unitCost),
    };
  }

  /**
   * A foreign key proves the row exists, not that it belongs to whoever is
   * writing. Without this, a caller could staple its movement to another
   * account's appointment or purchase order (ADR-11).
   */
  private async assertReferencesExist(
    tx: Prisma.TransactionClient,
    userId: string,
    input: RecordMovementInput,
  ): Promise<void> {
    if (
      input.supplierId &&
      !(await this.repository.supplierExists(userId, input.supplierId, tx))
    ) {
      throw new DomainError(
        'INVALID_REFERENCE',
        'SUPPLIER_NOT_FOUND',
        'Supplier not found. Register the supplier before linking the purchase.',
        { supplierId: input.supplierId },
      );
    }

    if (
      input.appointmentId &&
      !(await this.repository.appointmentExists(
        userId,
        input.appointmentId,
        tx,
      ))
    ) {
      throw new DomainError(
        'INVALID_REFERENCE',
        'APPOINTMENT_NOT_FOUND',
        'Appointment not found',
        { appointmentId: input.appointmentId },
      );
    }

    if (
      input.purchaseOrderId &&
      !(await this.repository.purchaseOrderExists(
        userId,
        input.purchaseOrderId,
        tx,
      ))
    ) {
      throw new DomainError(
        'INVALID_REFERENCE',
        'PURCHASE_ORDER_NOT_FOUND',
        'Purchase order not found',
        { purchaseOrderId: input.purchaseOrderId },
      );
    }

    if (
      input.lotId &&
      !(await this.repository.lotBelongsToItem(input.itemId, input.lotId, tx))
    ) {
      throw new DomainError(
        'INVALID_REFERENCE',
        'ITEM_LOT_NOT_FOUND',
        'Lot not found for this item',
        { lotId: input.lotId, itemId: input.itemId },
      );
    }
  }

  /**
   * US10. Turning the flag on is automatic — a negative balance is always
   * something to count. Turning it off is not: it is workflow state, and only
   * the count the user actually performed answers it.
   */
  private nextNeedsAdjustment(
    current: boolean,
    balance: Prisma.Decimal,
    clears: boolean,
  ): boolean {
    if (balanceRequiresAdjustment(balance)) return true;
    return clears ? false : current;
  }

  /** Same threshold `ItemEntity.belowMinimum` uses, so the two never disagree. */
  private isBelowMinimum(item: Item, balance: Prisma.Decimal): boolean {
    return (
      item.minimumStock !== null && balance.lessThanOrEqualTo(item.minimumStock)
    );
  }

  /**
   * Prisma reports a broken foreign key long after the check that should have
   * caught it. Everything reachable is validated up front; this is the backstop
   * for a race (the appointment deleted between the check and the insert), and
   * it keeps that case a 422 instead of a 500 — same handling `ItemService` and
   * `SupplierService` give it.
   */
  private async runLedgerWrite<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (error instanceof InvalidReferenceError) {
        throw new DomainError(
          'INVALID_REFERENCE',
          'INVALID_REFERENCE',
          error.field
            ? `${error.field} does not match an existing record`
            : 'A reference in the movement does not match an existing record',
          error.field ? { field: error.field } : undefined,
        );
      }
      throw error;
    }
  }

  private toResultEntity(
    result: RecordMovementResult,
  ): StockMovementResultEntity {
    return {
      movement: this.sanitize(result.movement),
      balance: result.balance.toString(),
      belowMinimum: result.belowMinimum,
      needsAdjustment: result.needsAdjustment,
    };
  }

  /**
   * Model to entity. `Decimal` columns leave as strings, the convention the
   * rest of the API follows: `10.005` does not survive a round trip through a
   * JavaScript number, and stock arithmetic is where that shows.
   */
  private sanitize(movement: MovementWithContext): StockMovementEntity {
    return {
      id: movement.id,
      itemId: movement.itemId,
      itemName: movement.item.name,
      unit: movement.item.unit,
      lotId: movement.lotId,
      supplierId: movement.supplierId,
      type: movement.type,
      source: movement.source,
      adjustmentReason: movement.adjustmentReason,
      quantity: movement.quantity.toString(),
      unitCost: movement.unitCost.toString(),
      occurredAt: movement.occurredAt,
      appointmentId: movement.appointmentId,
      purchaseOrderId: movement.purchaseOrderId,
      appointment: movement.appointment
        ? {
            id: movement.appointment.id,
            label: appointmentLabel(movement.appointment),
            procedureName: movement.appointment.procedureName,
            patientName: movement.appointment.patientName,
          }
        : null,
      notes: movement.notes,
    };
  }

  private itemNotFound(itemId: string) {
    return new DomainError(
      'NOT_FOUND',
      'ITEM_NOT_FOUND',
      `Item ${itemId} not found`,
      { itemId },
    );
  }
}

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, match => `\\${match}`);
}

/**
 * A calendar date has no time and no zone. Read as UTC it covers the whole day
 * the user picked on the calendar; pass a full timestamp with an offset when
 * the exact instant matters.
 */
function startOfPeriod(value: string): Date {
  return new Date(CALENDAR_DATE.test(value) ? `${value}T00:00:00.000Z` : value);
}

function endOfPeriod(value: string): Date {
  return new Date(CALENDAR_DATE.test(value) ? `${value}T23:59:59.999Z` : value);
}

/** Used when an appointment has neither a procedure nor a patient recorded. */
const UNLABELLED_APPOINTMENT = 'Atendimento';

/** "procedure — patient", with whichever of the two the appointment has. */
function appointmentLabel(appointment: {
  procedureName: string | null;
  patientName: string | null;
}): string {
  const parts = [appointment.procedureName, appointment.patientName].filter(
    (part): part is string => part != null && part.trim() !== '',
  );
  return parts.length > 0 ? parts.join(' — ') : UNLABELLED_APPOINTMENT;
}
