import { Injectable } from '@nestjs/common';
import {
  AdjustmentReason,
  MeasurementUnit,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { CreateItemDto } from './dto/create-item.dto';
import { DeleteItemDto } from './dto/delete-item.dto';
import { QueryItemDto } from './dto/query-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemEntity } from './entities/item.entity';
import { ItemLotRepository } from './item-lot.repository';
import { ItemRepository, type ItemWithNearestLot } from './item.repository';
import {
  InvalidReferenceError,
  RecordNotFoundError,
} from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';
import { StockMovementsService } from '../stock-movements';

export type ItemCatalogEntry = {
  id: string;
  name: string;
  unit: MeasurementUnit;
};

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, match => `\\${match}`);
}

@Injectable()
export class ItemService {
  constructor(
    private readonly itemRepository: ItemRepository,
    private readonly itemLotRepository: ItemLotRepository,
    private readonly stockMovements: StockMovementsService,
  ) {}

  async findAll(userId: string, query: QueryItemDto): Promise<ItemEntity[]> {
    const where: Prisma.ItemWhereInput = {
      userId,
      active: query.active,
      ...(query.category?.length ? { category: { in: query.category } } : {}),
      ...(query.search && query.search.length >= 2
        ? { name: { contains: escapeLike(query.search), mode: 'insensitive' } }
        : {}),
    };
    const skip = (query.page - 1) * query.limit;

    const items = await this.itemRepository.findMany(
      where,
      { [query.sort]: 'asc' },
      skip,
      query.limit,
    );
    return items.map(item => this.sanitize(item));
  }

  /** Every active item, lean: what purchase lines are matched against. */
  findCatalog(userId: string): Promise<ItemCatalogEntry[]> {
    return this.itemRepository.findCatalog(userId);
  }

  /** Of `ids`, the ones that are this user's and still active. */
  findActiveIds(userId: string, ids: string[]): Promise<string[]> {
    return this.itemRepository.findActiveIds(userId, ids);
  }

  async findOne(id: string, userId: string): Promise<ItemEntity> {
    const item = await this.getOrThrow(id, userId);
    return this.sanitize(item);
  }

  /**
   * The balance the item is created with is not written to the column: the
   * ledger recomputes `current_quantity` from its movements on every write
   * (ADR-10), so a quantity no movement explains would vanish on the next one.
   * It is recorded as the item's first movement instead, into a lot of its own.
   */
  async create(userId: string, dto: CreateItemDto): Promise<ItemEntity> {
    await this.ensureUniquePresentation(userId, dto.name, dto.unit);
    const { currentQuantity: openingQuantity, ...fields } = dto;

    let item: ItemWithNearestLot;
    try {
      item = await this.itemRepository.create({ ...fields, userId });
    } catch (error) {
      if (error instanceof InvalidReferenceError)
        throw this.invalidReference(error.field);
      throw error;
    }

    if (!openingQuantity) return this.sanitize(item);

    try {
      await this.recordOpeningBalance(userId, item, openingQuantity);
    } catch (error) {
      // The ledger runs in a transaction of its own, so the item is already
      // committed. Left behind, it would hold the name+unit and turn the
      // retry into DUPLICATED_ITEM_PRESENTATION.
      await this.itemRepository.purgeNew(item.id);
      throw error;
    }
    return this.sanitize(await this.getOrThrow(item.id, userId));
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateItemDto,
  ): Promise<ItemEntity> {
    const existing = await this.getOrThrow(id, userId);

    if (dto.name !== undefined || dto.unit !== undefined) {
      await this.ensureUniquePresentation(
        userId,
        dto.name ?? existing.name,
        dto.unit ?? existing.unit,
        id,
      );
    }

    try {
      const item = await this.itemRepository.update(id, userId, dto);
      if (!item) throw this.itemNotFound(id);
      return this.sanitize(item);
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.itemNotFound(id);
      if (error instanceof InvalidReferenceError)
        throw this.invalidReference(error.field);
      throw error;
    }
  }

  async remove(id: string, userId: string): Promise<DeleteItemDto> {
    try {
      const item = await this.itemRepository.delete(id, userId);
      // Someone else's item is reported exactly as a missing one.
      if (!item) throw this.itemNotFound(id);
      return { id: item.id, name: item.name };
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.itemNotFound(id);
      throw error;
    }
  }

  private async recordOpeningBalance(
    userId: string,
    item: ItemWithNearestLot,
    quantity: number,
  ): Promise<void> {
    const unitCost = item.defaultUnitCost ?? new Prisma.Decimal(0);
    await this.stockMovements.record(userId, {
      itemId: item.id,
      type: StockMovementType.INBOUND,
      source: StockMovementSource.MANUAL_ADJUSTMENT,
      adjustmentReason: AdjustmentReason.OTHER,
      quantity,
      unitCost,
      occurredAt: item.createdAt,
      notes: 'Opening balance',
      resolveLot: async tx => {
        const lot = await this.itemLotRepository.createLot(
          item.id,
          {
            quantity,
            unitCost: unitCost.toNumber(),
            expirationDate: null,
            receivedOn: item.createdAt,
          },
          tx,
        );
        return { lotId: lot.id };
      },
    });
  }

  private async getOrThrow(
    id: string,
    userId: string,
  ): Promise<ItemWithNearestLot> {
    const item = await this.itemRepository.findById(id, userId);
    if (!item) throw this.itemNotFound(id);
    return item;
  }

  private async ensureUniquePresentation(
    userId: string,
    name: string,
    unit: MeasurementUnit,
    excludeId?: string,
  ): Promise<void> {
    const existing = await this.itemRepository.findByPresentation(
      userId,
      name,
      unit,
      excludeId,
    );
    if (existing) throw this.duplicatedPresentation();
  }

  private sanitize(item: ItemWithNearestLot): ItemEntity {
    return {
      id: item.id,
      supplierId: item.supplierId,
      category: item.category,
      unit: item.unit,
      name: item.name,
      defaultUnitCost: item.defaultUnitCost,
      minimumStock: item.minimumStock,
      currentQuantity: item.currentQuantity,
      belowMinimum:
        item.minimumStock !== null &&
        item.currentQuantity.lessThanOrEqualTo(item.minimumStock),
      needsAdjustment: item.needsAdjustment,
      // `expiration_date` is a DATE column: it has no time and no zone. Sent
      // as a full timestamp it would read as the previous day for any client
      // west of UTC, so only the calendar part travels.
      nearestExpiration:
        item.lots[0]?.expirationDate?.toISOString().slice(0, 10) ?? null,
      active: item.active,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      deletedAt: item.deletedAt,
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

  private duplicatedPresentation(): DomainError {
    return new DomainError(
      'CONFLICT',
      'DUPLICATED_ITEM_PRESENTATION',
      'An item with this name and measurement unit already exists',
    );
  }

  private invalidReference(field?: string): DomainError {
    return new DomainError(
      'INVALID_REFERENCE',
      'INVALID_REFERENCE',
      'The provided reference does not exist or is invalid',
      { field },
    );
  }
}
