import { Injectable } from '@nestjs/common';
import {
  ItemLot,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { CreateItemLotDto } from './dto/create-item-lot.dto';
import { ItemLotEntity } from './entities/item-lot.entity';
import { ItemLotRepository } from './item-lot.repository';
import { DomainError } from '../../shared/errors/domain-error';
import { StockMovementsService } from '../stock-movements';

@Injectable()
export class ItemLotService {
  constructor(
    private readonly itemLotRepository: ItemLotRepository,
    private readonly stockMovements: StockMovementsService,
  ) {}

  /**
   * Receives stock into a lot: tops up the lot with the same expiration date,
   * or opens a new one.
   *
   * The write goes through the stock ledger (ADR-10), which is the only thing
   * allowed to create a `stock_movement` and to move `item.current_quantity`.
   * The lot itself is decided inside the ledger's transaction, under the item's
   * row lock — so two receipts of the same expiration date arriving together
   * cannot both conclude they are opening the lot, and the lot, the movement
   * and the balance either all land or none do.
   */
  async create(
    itemId: string,
    userId: string,
    dto: CreateItemLotDto,
  ): Promise<ItemLotEntity> {
    const item = await this.itemLotRepository.findItemForUser(itemId, userId);
    if (!item) throw this.itemNotFound(itemId);

    const expirationDate = dto.expirationDate
      ? new Date(dto.expirationDate)
      : null;
    const receivedOn = dto.receivedOn ? new Date(dto.receivedOn) : new Date();

    /** Filled in by the resolver below, inside the transaction. */
    let lot: ItemLot | undefined;

    await this.stockMovements.record(userId, {
      itemId,
      type: StockMovementType.INBOUND,
      source: StockMovementSource.MANUAL_PURCHASE,
      quantity: dto.quantity,
      // A fallback: when the entry joins an existing lot, the resolver replaces
      // this with that lot's own price.
      unitCost: dto.unitCost ?? item.defaultUnitCost ?? 0,
      occurredAt: receivedOn,
      resolveLot: async tx => {
        const existing = await this.itemLotRepository.findByExpiration(
          itemId,
          expirationDate,
          tx,
        );

        if (existing) {
          lot = await this.itemLotRepository.addQuantity(
            existing.id,
            dto.quantity,
            tx,
          );
          // The lot's price is what this stock actually cost.
          return { lotId: lot.id, unitCost: existing.unitCost };
        }

        // Only a brand new lot needs a price of its own; topping one up does
        // not, which is why this is checked here and not up front.
        const unitCost = dto.unitCost ?? item.defaultUnitCost?.toNumber();
        if (unitCost === undefined) throw this.unitCostRequired(itemId);

        lot = await this.itemLotRepository.createLot(
          itemId,
          {
            quantity: dto.quantity,
            unitCost,
            expirationDate,
            receivedOn,
            lotNumber: dto.lotNumber,
          },
          tx,
        );
        return { lotId: lot.id, unitCost };
      },
    });

    return this.sanitize(lot!);
  }

  private sanitize(lot: ItemLot): ItemLotEntity {
    return {
      id: lot.id,
      itemId: lot.itemId,
      lotNumber: lot.lotNumber,
      expirationDate: lot.expirationDate,
      unitCost: lot.unitCost,
      currentQuantity: lot.currentQuantity,
      receivedOn: lot.receivedOn,
      createdAt: lot.createdAt,
      updatedAt: lot.updatedAt,
    };
  }

  private itemNotFound(id: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'ITEM_NOT_FOUND',
      `Item ${id} not found`,
      { id },
    );
  }

  private unitCostRequired(itemId: string): DomainError {
    return new DomainError(
      'INVALID_INPUT',
      'ITEM_LOT_UNIT_COST_REQUIRED',
      'unitCost must be provided when the item has no defaultUnitCost',
      { itemId },
    );
  }
}
