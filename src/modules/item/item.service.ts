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
    await this.garantirPresentacaoUnica(dto.userId, dto.name, dto.unit);
    try {
      const item = await this.itemRepository.create(dto);
      return this.sanitize(item);
    } catch (error) {
      if (error instanceof InvalidReferenceError)
        throw this.referenciaInvalida(error.field);
      throw error;
    }
  }

  async update(id: string, dto: UpdateItemDto): Promise<ItemEntity> {
    const existing = await this.getOrThrow(id);

    if (dto.name !== undefined || dto.unit !== undefined) {
      await this.garantirPresentacaoUnica(
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
      if (error instanceof RecordNotFoundError) throw this.naoEncontrado(id);
      if (error instanceof InvalidReferenceError)
        throw this.referenciaInvalida(error.field);
      throw error;
    }
  }

  async remove(id: string): Promise<DeleteItemDto> {
    try {
      const item = await this.itemRepository.softDelete(id);
      return { id: item.id, name: item.name };
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.naoEncontrado(id);
      throw error;
    }
  }

  private async getOrThrow(id: string): Promise<Item> {
    const item = await this.itemRepository.findById(id);
    if (!item) throw this.naoEncontrado(id);
    return item;
  }

  private async garantirPresentacaoUnica(
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
    if (existing) throw this.presentacaoDuplicada();
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

  private naoEncontrado(id: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'ITEM_NAO_ENCONTRADO',
      `Item ${id} não encontrado`,
      { id },
    );
  }

  private presentacaoDuplicada(): DomainError {
    return new DomainError(
      'CONFLICT',
      'ITEM_PRESENTACAO_DUPLICADA',
      'Já existe um item com esse nome e essa unidade de medida',
    );
  }

  private referenciaInvalida(field?: string): DomainError {
    return new DomainError(
      'INVALID_REFERENCE',
      'ITEM_REFERENCIA_INVALIDA',
      field ? `Referência inválida: ${field}` : 'Referência inválida',
      field ? { field } : undefined,
    );
  }
}
