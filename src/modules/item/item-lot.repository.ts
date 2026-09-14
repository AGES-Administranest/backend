import { Injectable } from '@nestjs/common';
import { Item, ItemLot, Prisma } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface NewLotEntry {
  quantity: number;
  unitCost: number;
  expirationDate: Date | null;
  receivedOn: Date;
  lotNumber?: string;
}

/**
 * Lots only — this repository does not touch `stock_movement` or
 * `item.current_quantity`.
 *
 * It used to write both, which made receiving a lot a second, parallel way into
 * the ledger: no row lock, no minimum-stock check, and the balance bumped with
 * `increment` instead of recomputed from the history. `StockMovementsService`
 * owns that now (ADR-10), and these methods run inside the transaction it
 * opens, so the lot and its movement still land together or not at all.
 */
@Injectable()
export class ItemLotRepository {
  constructor(private readonly prisma: PrismaService) {}

  findItemForUser(itemId: string, userId: string): Promise<Item | null> {
    return runQuery(() =>
      this.prisma.item.findFirst({ where: { id: itemId, userId } }),
    );
  }

  /**
   * The lot an entry should join: same item, same expiration date. Read inside
   * the ledger's transaction, so two receipts of the same expiration date
   * cannot both decide they are the first one.
   */
  findByExpiration(
    itemId: string,
    expirationDate: Date | null,
    tx?: Prisma.TransactionClient,
  ): Promise<ItemLot | null> {
    return runQuery(() =>
      (tx ?? this.prisma).itemLot.findFirst({
        where: { itemId, expirationDate },
      }),
    );
  }

  /** Tops up an existing lot's cached quantity. */
  addQuantity(
    lotId: string,
    quantity: number,
    tx?: Prisma.TransactionClient,
  ): Promise<ItemLot> {
    return runQuery(() =>
      (tx ?? this.prisma).itemLot.update({
        where: { id: lotId },
        data: { currentQuantity: { increment: quantity } },
      }),
    );
  }

  createLot(
    itemId: string,
    entry: NewLotEntry,
    tx?: Prisma.TransactionClient,
  ): Promise<ItemLot> {
    return runQuery(() =>
      (tx ?? this.prisma).itemLot.create({
        data: {
          itemId,
          lotNumber: entry.lotNumber,
          expirationDate: entry.expirationDate,
          unitCost: entry.unitCost,
          currentQuantity: entry.quantity,
          receivedOn: entry.receivedOn,
        },
      }),
    );
  }
}
