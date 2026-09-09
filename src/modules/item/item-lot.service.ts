import { Injectable } from '@nestjs/common';
import { ItemLot } from '@prisma/client';

import { CreateItemLotDto } from './dto/create-item-lot.dto';
import { ItemLotEntity } from './entities/item-lot.entity';
import { ItemLotRepository } from './item-lot.repository';
import { DomainError } from '../../shared/errors/domain-error';

@Injectable()
export class ItemLotService {
  constructor(private readonly itemLotRepository: ItemLotRepository) {}

  async create(itemId: string, dto: CreateItemLotDto): Promise<ItemLotEntity> {
    const item = await this.itemLotRepository.findItemForUser(
      itemId,
      dto.userId,
    );
    if (!item) throw this.itemNotFound(itemId);

    const expirationDate = dto.expirationDate
      ? new Date(dto.expirationDate)
      : null;
    const existingLot = await this.itemLotRepository.findByExpiration(
      itemId,
      expirationDate,
    );

    if (existingLot) {
      const lot = await this.itemLotRepository.addToLot(
        existingLot,
        dto.userId,
        dto.quantity,
      );
      return this.sanitize(lot);
    }

    const unitCost = dto.unitCost ?? item.defaultUnitCost?.toNumber();
    if (unitCost === undefined) throw this.unitCostRequired(itemId);

    const lot = await this.itemLotRepository.createLot(itemId, dto.userId, {
      quantity: dto.quantity,
      unitCost,
      expirationDate,
      receivedOn: dto.receivedOn ? new Date(dto.receivedOn) : new Date(),
      lotNumber: dto.lotNumber,
    });
    return this.sanitize(lot);
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
