import { Injectable } from '@nestjs/common';
import {
  Item,
  ItemLot,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface NewLotEntry {
  quantity: number;
  unitCost: number;
  expirationDate: Date | null;
  receivedOn: Date;
  lotNumber?: string;
}

@Injectable()
export class ItemLotRepository {
  constructor(private readonly prisma: PrismaService) {}

  findItemForUser(itemId: string, userId: string): Promise<Item | null> {
    return runQuery(() =>
      this.prisma.item.findFirst({ where: { id: itemId, userId } }),
    );
  }

  findByExpiration(
    itemId: string,
    expirationDate: Date | null,
  ): Promise<ItemLot | null> {
    return runQuery(() =>
      this.prisma.itemLot.findFirst({ where: { itemId, expirationDate } }),
    );
  }

  addToLot(
    lot: ItemLot,
    userId: string,
    quantity: number,
  ): Promise<ItemLot> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const updatedLot = await tx.itemLot.update({
          where: { id: lot.id },
          data: { currentQuantity: { increment: quantity } },
        });
        await tx.item.update({
          where: { id: lot.itemId },
          data: { currentQuantity: { increment: quantity } },
        });
        await tx.stockMovement.create({
          data: {
            userId,
            itemId: lot.itemId,
            lotId: lot.id,
            type: StockMovementType.IN,
            source: StockMovementSource.MANUAL,
            quantity,
            unitCost: lot.unitCost,
            occurredAt: new Date(),
          },
        });
        return updatedLot;
      }),
    );
  }

  createLot(
    itemId: string,
    userId: string,
    entry: NewLotEntry,
  ): Promise<ItemLot> {
    return runQuery(() =>
      this.prisma.$transaction(async tx => {
        const lot = await tx.itemLot.create({
          data: {
            itemId,
            lotNumber: entry.lotNumber,
            expirationDate: entry.expirationDate,
            unitCost: entry.unitCost,
            currentQuantity: entry.quantity,
            receivedOn: entry.receivedOn,
          },
        });
        await tx.item.update({
          where: { id: itemId },
          data: { currentQuantity: { increment: entry.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            userId,
            itemId,
            lotId: lot.id,
            type: StockMovementType.IN,
            source: StockMovementSource.MANUAL,
            quantity: entry.quantity,
            unitCost: entry.unitCost,
            occurredAt: new Date(),
          },
        });
        return lot;
      }),
    );
  }
}
