import { Injectable } from '@nestjs/common';
import { Item, Prisma, StockMovement } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class StockMovementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.StockMovementCreateInput): Promise<StockMovement> {
    return runQuery(() => this.prisma.stockMovement.create({ data }));
  }

  findMovementsByItem(
    userId: string,
    itemId: string,
  ): Promise<StockMovement[]> {
    return runQuery(() =>
      this.prisma.stockMovement.findMany({ where: { userId, itemId } }),
    );
  }

  findItemById(userId: string, itemId: string): Promise<Item | null> {
    return runQuery(() =>
      this.prisma.item.findFirst({ where: { id: itemId, userId } }),
    );
  }

  updateItemQuantity(
    itemId: string,
    currentQuantity: Prisma.Decimal,
  ): Promise<Item> {
    return runQuery(() =>
      this.prisma.item.update({
        where: { id: itemId },
        data: { currentQuantity },
      }),
    );
  }

  setItemNeedsAdjustment(
    itemId: string,
    needsAdjustment: boolean,
  ): Promise<Item> {
    return runQuery(() =>
      this.prisma.item.update({
        where: { id: itemId },
        data: { needsAdjustment },
      }),
    );
  }
}
