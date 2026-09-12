import { Injectable } from '@nestjs/common';
import { MeasurementUnit, Prisma } from '@prisma/client';

import { CreateItemDto } from './dto/create-item.dto';
import { DeleteItemDto } from './dto/delete-item.dto';
import { QueryItemDto } from './dto/query-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemEntity } from './entities/item.entity';
import { ItemRepository, type ItemWithNearestLot } from './item.repository';
import {
  InvalidReferenceError,
  RecordNotFoundError,
} from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, match => `\\${match}`);
}

@Injectable()
export class ItemService {
  constructor(private readonly itemRepository: ItemRepository) {}

  async findAll(query: QueryItemDto): Promise<ItemEntity[]> {
    const where: Prisma.ItemWhereInput = {
      userId: query.userId,
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

  async findOne(id: string): Promise<ItemEntity> {
    const item = await this.getOrThrow(id);
    return this.sanitize(item);
  }

  async create(dto: CreateItemDto): Promise<ItemEntity> {
    await this.ensureUniquePresentation(dto.userId, dto.name, dto.unit);
    try {
      const item = await this.itemRepository.create(dto);
      return this.sanitize(item);
    } catch (error) {
      if (error instanceof InvalidReferenceError)
        throw this.invalidReference(error.field);
      throw error;
    }
  }

  async update(id: string, dto: UpdateItemDto): Promise<ItemEntity> {
    const existing = await this.getOrThrow(id);

    if (dto.name !== undefined || dto.unit !== undefined) {
      await this.ensureUniquePresentation(
        existing.userId,
        dto.name ?? existing.name,
        dto.unit ?? existing.unit,
        id,
      );
    }

    try {
      const item = await this.itemRepository.update(id, dto);
      return this.sanitize(item);
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.itemNotFound(id);
      if (error instanceof InvalidReferenceError)
        throw this.invalidReference(error.field);
      throw error;
    }
  }

  async remove(id: string): Promise<DeleteItemDto> {
    try {
      const item = await this.itemRepository.delete(id);
      return { id: item.id, name: item.name };
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.itemNotFound(id);
      throw error;
    }
  }

  private async getOrThrow(id: string): Promise<ItemWithNearestLot> {
    const item = await this.itemRepository.findById(id);
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
