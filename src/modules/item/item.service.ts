import { Injectable } from '@nestjs/common';
import { Item, MeasurementUnit } from '@prisma/client';

import { CreateItemDto } from './dto/create-item.dto';
import { DeleteItemDto } from './dto/delete-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { ItemEntity } from './entities/item.entity';
import { ItemRepository } from './item.repository';
import {
  InvalidReferenceError,
  RecordNotFoundError,
} from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

@Injectable()
export class ItemService {
  constructor(private readonly itemRepository: ItemRepository) {}

  async findAll(): Promise<ItemEntity[]> {
    const items = await this.itemRepository.findMany();
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

  private async getOrThrow(id: string): Promise<Item> {
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
    if (existing) throw this.duplicatePresentation();
  }

  private sanitize(item: Item): ItemEntity {
    return {
      id: item.id,
      supplierId: item.supplierId,
      category: item.category,
      unit: item.unit,
      name: item.name,
      defaultUnitCost: item.defaultUnitCost,
      minimumStock: item.minimumStock,
      currentQuantity: item.currentQuantity,
      active: item.active,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      deletedAt: item.deletedAt,
    };
  }

  private itemNotFound(id: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'ITEM_NAO_ENCONTRADO',
      `Item ${id} not found`,
      { id },
    );
  }

  private duplicatePresentation(): DomainError {
    return new DomainError(
      'CONFLICT',
      'ITEM_PRESENTACAO_DUPLICADA',
      'An item with this name and measurement unit already exists',
    );
  }

  private invalidReference(field?: string): DomainError {
    return new DomainError(
      'INVALID_REFERENCE',
      'ITEM_REFERENCIA_INVALIDA',
      field ? `Invalid reference: ${field}` : 'Invalid reference',
      field ? { field } : undefined,
    );
  }
}
