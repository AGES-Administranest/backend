import { Injectable, Logger } from '@nestjs/common';
import {
  AdjustmentReason,
  Item,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { currentLot } from './domain/current-lot';
import {
  CLOCK_SKEW_TOLERANCE_MS,
  type DecimalInput,
  assertNotInTheFuture,
  assertPositiveQuantity,
  assertSufficientBalance,
  assertValidMovement,
  balanceRequiresAdjustment,
  movementForDelta,
  stockBalance,
} from './domain/stock-movement.rules';
import {
  adjustmentsByReason,
  consumptionByProcedure,
  directionTotals,
  itemPeriodBalance,
} from './domain/stock-summary.rules';
import { CreateStockAdjustmentDto } from './dto/create-stock-adjustment.dto';
import { CreateStockCountDto } from './dto/create-stock-count.dto';
import { CreateStockPurchaseDto } from './dto/create-stock-purchase.dto';
import { QueryStockMovementDto } from './dto/query-stock-movement.dto';
import { QueryStockSummaryDto } from './dto/query-stock-summary.dto';
import {
  QueryStockSyncDto,
  SyncStockMovementDto,
  SyncStockMovementsDto,
} from './dto/sync-stock-movement.dto';
import { StockBalanceReconciliationEntity } from './entities/stock-balance-reconciliation.entity';
import { StockMovementResultEntity } from './entities/stock-movement-result.entity';
import { StockMovementEntity } from './entities/stock-movement.entity';
import { StockSummaryEntity } from './entities/stock-summary.entity';
import {
  StockSyncPullEntity,
  StockSyncPushEntity,
  SyncedItemBalanceEntity,
} from './entities/stock-sync.entity';
import {
  MovementWithContext,
  StockMovementsRepository,
} from './stock-movements.repository';
import {
  InvalidReferenceError,
  UniqueConstraintError,
} from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

/**
 * Creates or tops up the lot, inside the ledger's transaction and row lock.
 * `unitCost` overrides the input's when the lot already carries its own price.
 */
export type LotResolver = (
  tx: Prisma.TransactionClient,
) => Promise<{ lotId: string; unitCost?: DecimalInput }>;

/** Everything the central ledger needs to record one movement. */
export interface RecordMovementInput {
  /** Set only for movements created on a device (ADR-09); makes a resend idempotent. */
  id?: string;
  itemId: string;
  lotId?: string | null;
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
  /** Lets an outbound go below zero — the US10 correction reversal needs it. */
  allowNegativeBalance?: boolean;
  /** Clears `needsAdjustment` when the balance is not negative. Only the count sets it. */
  clearsNeedsAdjustment?: boolean;
  /**
   * The balance the caller derived this movement from, read before the lock.
   * Checked under it: if the ledger moved in between, nothing is written and
   * `BalanceChangedError` is thrown, so the caller can derive it again.
   */
  expectedBalance?: Prisma.Decimal;
  /** Extra columns merged into the item's single UPDATE, decided inside the lock. */
  itemPatch?: (
    tx: Prisma.TransactionClient,
    context: { movement: MovementWithContext; lockedItem: Item },
  ) => Promise<Prisma.ItemUncheckedUpdateInput>;
}

/** The ledger moved between the caller's read and the lock (`expectedBalance`). */
export class BalanceChangedError extends Error {
  constructor(readonly itemId: string) {
    super(`The balance of item ${itemId} changed while it was being read`);
  }
}

/** A movement recorded on a device: same shape, but the id is required (ADR-09). */
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
 * ADR-08: a transaction that commits late carries an earlier `createdAt` than
 * rows already handed out, so a strict cursor would skip it forever. The
 * overlap re-sends a few seconds; the device applies by id, so a repeat is free.
 */
const SYNC_CURSOR_OVERLAP_MS = 5_000;

/** A count re-reads the balance this many times before giving up on a busy item. */
const COUNT_ATTEMPTS = 3;

/** Ceiling on one delta page, so a device that was offline for weeks still gets an answer. */
const SYNC_PULL_LIMIT = 500;

/**
 * The stock ledger's single write path (ADR-10).
 *
 * `record` and `recordBatch` are the only places a `stock_movement` row is
 * created: they write the movement, recompute the balance from the ledger,
 * refresh the `item.currentQuantity` cache and flip `needsAdjustment` when the
 * balance goes negative. Every stock flow goes through them, which is what
 * keeps the sum of the history and the cached balance from disagreeing.
 *
 * Failures are `DomainError` (ADR-07).
 */
@Injectable()
export class StockMovementsService {
  /** Offline sync fails silently into a wrong balance; these lines are the trail. */
  private readonly logger = new Logger(StockMovementsService.name);

  constructor(private readonly repository: StockMovementsRepository) {}

  /** One movement — a batch of one, with the same guarantees. */
  async record(
    userId: string,
    input: RecordMovementInput,
    options: RecordOptions = {},
  ): Promise<RecordMovementResult> {
    const [result] = await this.recordBatch(userId, [input], options);
    return result;
  }

  /**
   * Several movements atomically — the items of one appointment, the lines of
   * one received order. One transaction, every item row locked up front, and
   * the balance of a repeated item carried forward between its own movements.
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
          const balances = new Map<string, Prisma.Decimal>();
          /** Carried forward: a line that digs into the red keeps the item marked. */
          const flags = new Map<string, boolean>();
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

            // The lot has to exist before the movement can point at it.
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
            if (!input.resolveLot && !resolved.lotId) {
              resolved.lotId = await this.defaultLot(tx, resolved);
            }

            const carried = balances.get(resolved.itemId);
            const balanceBefore =
              carried ??
              (await this.repository.balanceOf(userId, resolved.itemId, tx));
            if (
              carried === undefined &&
              options.expectedBalance &&
              !balanceBefore.equals(options.expectedBalance)
            ) {
              throw new BalanceChangedError(resolved.itemId);
            }

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
            // A resolver already set its lot's quantity; any other lot moves here,
            // so the lots keep adding up to the item's balance.
            if (!input.resolveLot && resolved.lotId) {
              await this.repository.moveLotQuantity(
                resolved.lotId,
                resolved.type,
                resolved.quantity,
                tx,
              );
            }
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
      // Under two characters is not a filter — same threshold as `GET /item`.
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
   * US12: what moved over a period, and what it was worth.
   *
   * Aggregated in Node, not SQL: grouping by procedure means folding case and
   * accents on a free-text column of a joined table. The rows still arrive in
   * one query with the origins joined, so this is O(1) round trips.
   */
  async buildSummary(
    userId: string,
    query: QueryStockSummaryDto,
  ): Promise<StockSummaryEntity> {
    const periodStart = startOfPeriod(query.periodStart);
    const periodEnd = endOfPeriod(query.periodEnd);

    if (periodStart > periodEnd) {
      throw new DomainError(
        'INVALID_INPUT',
        'INVALID_REQUEST',
        'periodStart must not be after periodEnd',
        { periodStart: query.periodStart, periodEnd: query.periodEnd },
      );
    }

    const movements = await this.repository.findForSummary({
      userId,
      deletedAt: null,
      occurredAt: { gte: periodStart, lte: periodEnd },
      ...(query.itemId ? { itemId: query.itemId } : {}),
    });

    const { inbound, outbound } = directionTotals(movements);
    const adjustments = adjustmentsByReason(movements);
    const expired = adjustments.find(
      group => group.reason === AdjustmentReason.EXPIRATION,
    );

    return {
      periodStart,
      periodEnd,
      inbound,
      outbound,
      byProcedure: consumptionByProcedure(movements),
      adjustments,
      expiredValue: expired?.value ?? '0',
      item: query.itemId
        ? await this.itemPeriodSummary(
            userId,
            query.itemId,
            periodStart,
            movements,
          )
        : null,
    };
  }

  /** The per-item block: where it opened, what moved, where it closed. */
  private async itemPeriodSummary(
    userId: string,
    itemId: string,
    periodStart: Date,
    movements: readonly MovementWithContext[],
  ) {
    const item = await this.loadItem(userId, itemId);
    const openingBalance = await this.repository.balanceBefore(
      userId,
      itemId,
      periodStart,
    );

    return {
      itemId: item.id,
      itemName: item.name,
      unit: item.unit,
      ...itemPeriodBalance(openingBalance, movements),
    };
  }

  /**
   * US11: a manual outbound adjustment. Direction, origin, cost and timestamp
   * are decided here — a loss is not an event the client gets to price or backdate.
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
      unitCost: item.defaultUnitCost ?? new Prisma.Decimal(0),
      // The server's clock: a phone with a wrong date would reorder the history.
      occurredAt: new Date(),
      notes: dto.notes ?? null,
    });

    return this.toResultEntity(result);
  }

  /**
   * US10: the physical count that closes the `needsAdjustment` loop.
   *
   * A negative balance cannot be fixed by an outbound — there is nothing left
   * to take out — so the input is the number counted on the shelf. The
   * difference is written as one more movement, in whichever direction it needs.
   */
  async registerCount(
    userId: string,
    dto: CreateStockCountDto,
  ): Promise<StockMovementResultEntity> {
    const item = await this.loadItem(userId, dto.itemId);

    // The delta is only right against the balance it was taken from. A
    // movement landing between the read and the lock would leave the item
    // off the count while the flag is cleared, so the write checks the
    // balance under the lock and the count is taken again if it moved.
    for (let attempt = 1; ; attempt++) {
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

      try {
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
          { clearsNeedsAdjustment: true, expectedBalance: balance },
        );
        return this.toResultEntity(result);
      } catch (error) {
        if (!(error instanceof BalanceChangedError)) throw error;
        if (attempt === COUNT_ATTEMPTS) {
          throw new DomainError(
            'CONFLICT',
            'STOCK_BALANCE_CHANGED',
            'The item kept moving while the count was being recorded — try again',
            { itemId: dto.itemId },
          );
        }
      }
    }
  }

  /**
   * Manual purchase entry, for buys with no order or invoice to import. The
   * item's cost becomes the price paid, unless this entry is backdated behind a
   * more recent purchase.
   *
   * The matching EXPENSE entry belongs to US03 and is deliberately not emitted
   * here until the financial module exists.
   */
  async registerPurchase(
    userId: string,
    dto: CreateStockPurchaseDto,
  ): Promise<StockMovementResultEntity> {
    const occurredAt = new Date(dto.date);
    // No tolerance: this date is typed on a screen, not read off a device clock.
    assertNotInTheFuture(occurredAt);

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
          // The new movement is already in that maximum, so a tie means newest.
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
   * Applies a batch recorded while the device had no connection.
   *
   * - Idempotent: ids come from the device (ADR-09), so a half-delivered batch
   *   can be re-sent whole. Ids already held are reported back, not applied
   *   again — otherwise a retry takes the same stock out twice.
   * - Chronological: applied in `occurredAt` order, not arrival order.
   * - Never refuses a negative balance: the offline consumption did happen, so
   *   it is recorded and the item flagged for a count.
   *
   * An item that exists only on the device fails the whole batch with
   * `ITEM_NOT_FOUND`: items sync before movements.
   */
  async syncPush(
    userId: string,
    dto: SyncStockMovementsDto,
  ): Promise<StockSyncPushEntity> {
    if (dto.movements.length === 0) {
      throw new DomainError(
        'INVALID_INPUT',
        'STOCK_MOVEMENT_BATCH_EMPTY',
        'A sync batch needs at least one movement',
      );
    }

    const movements = dto.movements.map(movement => this.toSyncInput(movement));

    // ADR-08, first trap: a wrong phone clock. `occurredAt` decides the apply
    // order, so a movement dated next year would sit at the top for good.
    for (const movement of movements) {
      assertNotInTheFuture(movement.occurredAt, {
        toleranceMs: CLOCK_SKEW_TOLERANCE_MS,
      });
    }

    // Importing a purchase order needs the network to begin with (US10), so a
    // device can never have recorded one offline. Refusing it here keeps a
    // confused client from inventing order entries through the sync door.
    const online = movements.find(
      movement => movement.source === StockMovementSource.ORDER_IMPORT,
    );
    if (online) {
      throw new DomainError(
        'INVALID_INPUT',
        'STOCK_SYNC_SOURCE_NOT_ALLOWED',
        'ORDER_IMPORT movements cannot be recorded offline — importing an order requires a connection',
        { id: online.id, source: online.source },
      );
    }

    // Two pushes of the same batch (a retry fired before the first answered)
    // both find the ids free, and the second then trips the primary key once
    // the first commits. Sorting the ids again settles it: they are now
    // duplicates, reported as such, and nothing is taken out twice.
    const { applied, alreadyMine } = await this.applySyncBatch(
      userId,
      movements,
    ).catch((error: unknown) => {
      if (!(error instanceof UniqueConstraintError)) throw error;
      return this.applySyncBatch(userId, movements);
    });

    const touchedItems = [
      ...new Set(movements.map(movement => movement.itemId)),
    ];

    const flagged = [
      ...new Set(
        applied
          .filter(result => result.needsAdjustment)
          .map(result => result.movement.itemId),
      ),
    ];

    this.logger.log(
      `sync push user=${userId} sent=${movements.length} ` +
        `applied=${applied.length} duplicated=${alreadyMine.size} ` +
        `items=${touchedItems.length}`,
    );
    if (flagged.length > 0) {
      // A warning, not a log line: the inventory now needs a human to count it.
      this.logger.warn(
        `sync push user=${userId} left ${flagged.length} item(s) negative, ` +
          `flagged for a count: ${flagged.join(', ')}`,
      );
    }

    return {
      applied: applied.map(result => this.sanitize(result.movement)),
      duplicated: movements
        .filter(movement => alreadyMine.has(movement.id))
        .map(movement => movement.id),
      balances: await this.itemBalances(userId, touchedItems),
      needsAdjustment: flagged,
    };
  }

  /**
   * Everything written since the device's cursor, plus where each affected item
   * now stands — the balances spare the device replaying its whole local history.
   */
  async syncPull(
    userId: string,
    query: QueryStockSyncDto,
  ): Promise<StockSyncPullEntity> {
    const since = new Date(query.since);
    // Continuing a page goes strictly past its last row. Only a fresh pull
    // steps back: re-sending the overlap on every page would, once a full page
    // fits in the window, hand the same page back forever.
    const continued = query.afterId
      ? await this.repository.findCreatedAfterMovement(
          userId,
          query.afterId,
          SYNC_PULL_LIMIT,
        )
      : null;
    const movements =
      continued ??
      (await this.repository.findCreatedAfter(
        userId,
        new Date(since.getTime() - SYNC_CURSOR_OVERLAP_MS),
        SYNC_PULL_LIMIT,
      ));
    const hasMore = movements.length === SYNC_PULL_LIMIT;

    const touchedItems = [...new Set(movements.map(m => m.itemId))];
    const latest = movements.at(-1)?.createdAt;

    this.logger.log(
      `sync pull user=${userId} since=${since.toISOString()} ` +
        `movements=${movements.length} items=${touchedItems.length}` +
        (hasMore ? ' (page full, more to come)' : ''),
    );

    return {
      movements: movements.map(movement => this.sanitize(movement)),
      balances: await this.itemBalances(userId, touchedItems),
      cursor: latest ?? since,
      // Told, not inferred: the device cannot see the limit it would compare against.
      hasMore,
      afterId: hasMore ? movements[movements.length - 1].id : null,
    };
  }

  /** Splits the batch into ids already held and new ones, and applies the new. */
  private async applySyncBatch(
    userId: string,
    movements: readonly SyncMovementInput[],
  ): Promise<{ applied: RecordMovementResult[]; alreadyMine: Set<string> }> {
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
      // Chronological; the id breaks ties so a batch always applies in one order.
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
    return { applied, alreadyMine };
  }

  /** Wire shape to ledger input. */
  private toSyncInput(movement: SyncStockMovementDto): SyncMovementInput {
    return {
      id: movement.id,
      itemId: movement.itemId,
      lotId: movement.lotId ?? null,
      type: movement.type,
      source: movement.source,
      quantity: movement.quantity,
      unitCost: movement.unitCost,
      occurredAt: new Date(movement.occurredAt),
      adjustmentReason: movement.adjustmentReason ?? null,
      appointmentId: movement.appointmentId ?? null,
      supplierId: movement.supplierId ?? null,
      notes: movement.notes ?? null,
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
   * Support routine, not part of the write path: recomputes the balance from
   * the full history and reconciles `item.currentQuantity` if it drifted.
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
              // Never cleared here: only the user's count answers the flag.
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
   * A foreign key proves the row exists, not that it belongs to the caller —
   * without this a movement could point at another account's appointment (ADR-11).
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
   * The lot a movement that named none draws from or lands in. An outbound
   * takes from the current lot — FEFO, the same rule a consumption follows; an
   * inbound joins the item's lot without an expiration date, opened on demand.
   */
  private async defaultLot(
    tx: Prisma.TransactionClient,
    movement: PreparedMovement,
  ): Promise<string | null> {
    const lots = await this.repository.findLots(movement.itemId, tx);
    if (movement.type === StockMovementType.OUTBOUND) {
      return currentLot(lots)?.id ?? null;
    }

    const [undated] = lots
      .filter(lot => lot.expirationDate === null)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    if (undated) return undated.id;

    const opened = await this.repository.createEmptyLot(
      movement.itemId,
      { unitCost: movement.unitCost, receivedOn: movement.occurredAt },
      tx,
    );
    return opened.id;
  }

  /** US10: turning the flag on is automatic; only the user's count turns it off. */
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
   * Backstop for a race the up-front checks cannot catch (a reference deleted
   * between check and insert): keeps it a 422 instead of a 500, like `ItemService`.
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

  /** `Decimal` leaves as string: `10.005` does not survive a JavaScript number. */
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
      totalValue: movement.quantity.times(movement.unitCost).toString(),
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
      purchaseOrder: movement.purchaseOrder
        ? {
            id: movement.purchaseOrder.id,
            number: movement.purchaseOrder.number,
            status: movement.purchaseOrder.status,
          }
        : null,
      supplier: movement.supplier
        ? { id: movement.supplier.id, name: movement.supplier.name }
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

/** A calendar date has no zone: read as UTC it covers the whole day picked. */
function startOfPeriod(value: string): Date {
  return new Date(CALENDAR_DATE.test(value) ? `${value}T00:00:00.000Z` : value);
}

function endOfPeriod(value: string): Date {
  return new Date(CALENDAR_DATE.test(value) ? `${value}T23:59:59.999Z` : value);
}

/** Used when an appointment has neither a procedure nor a patient recorded. */
const UNLABELLED_APPOINTMENT = 'Atendimento';

function appointmentLabel(appointment: {
  procedureName: string | null;
  patientName: string | null;
}): string {
  const parts = [appointment.procedureName, appointment.patientName].filter(
    (part): part is string => part != null && part.trim() !== '',
  );
  return parts.length > 0 ? parts.join(' — ') : UNLABELLED_APPOINTMENT;
}
