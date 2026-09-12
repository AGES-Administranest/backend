import { Injectable } from '@nestjs/common';
import { Item, Prisma, StockMovement, Supplier } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

/**
 * The only place the stock-movements module talks to the database (ADR-01).
 * Every method scopes by `userId` (ADR-11); the ledger is append-only, so there
 * is no update or delete of a movement here (ADR-10).
 */
@Injectable()
export class StockMovementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    data: Prisma.StockMovementUncheckedCreateInput,
    tx?: Prisma.TransactionClient,
  ): Promise<StockMovement> {
    return runQuery(() => (tx ?? this.prisma).stockMovement.create({ data }));
  }

  findMovementsByItem(
    userId: string,
    itemId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<StockMovement[]> {
    return runQuery(() =>
      (tx ?? this.prisma).stockMovement.findMany({ where: { userId, itemId } }),
    );
  }

  findItemById(userId: string, itemId: string): Promise<Item | null> {
    return runQuery(() =>
      this.prisma.item.findFirst({
        where: { id: itemId, userId, deletedAt: null },
      }),
    );
  }

  findSupplierById(
    userId: string,
    supplierId: string,
  ): Promise<Supplier | null> {
    return runQuery(() =>
      this.prisma.supplier.findFirst({
        where: { id: supplierId, userId, deletedAt: null },
      }),
    );
  }

  updateItemQuantity(
    itemId: string,
    currentQuantity: Prisma.Decimal,
    tx?: Prisma.TransactionClient,
  ): Promise<Item> {
    return runQuery(() =>
      (tx ?? this.prisma).item.update({
        where: { id: itemId },
        data: { currentQuantity },
      }),
    );
  }

  /**
   * After a manual purchase inbound: the item's cost becomes the latest
   * purchase price (same rule as the purchase-order import, US10) and the item
   * is reactivated if it was inactive.
   */
  applyInboundPurchaseToItem(
    itemId: string,
    unitCost: Prisma.Decimal,
  ): Promise<Item> {
    return runQuery(() =>
      this.prisma.item.update({
        where: { id: itemId },
        data: { defaultUnitCost: unitCost, active: true },
      }),
    );
  }

  setItemNeedsAdjustment(
    itemId: string,
    needsAdjustment: boolean,
    tx?: Prisma.TransactionClient,
  ): Promise<Item> {
    return runQuery(() =>
      (tx ?? this.prisma).item.update({
        where: { id: itemId },
        data: { needsAdjustment },
      }),
    );
  }

  /**
   * Runs `fn` inside a single transaction, with the item's row locked
   * (`SELECT ... FOR UPDATE`) for its duration. This is what makes `record()`
   * safe under concurrency (ADR-10): two simultaneous movements on the same
   * item serialize on this lock instead of racing on stale reads.
   */
  async recordWithLock<T>(
    itemId: string,
    fn: (
      tx: Prisma.TransactionClient,
      lockedItem: Item | undefined,
    ) => Promise<T>,
  ): Promise<T> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const [lockedItem] = await tx.$queryRaw<Item[]>`
          SELECT * FROM "item" WHERE id = ${itemId}::uuid FOR UPDATE
        `;
        return fn(tx, lockedItem);
      }),
    );
  }
}
