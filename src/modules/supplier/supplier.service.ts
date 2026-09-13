import { Injectable } from '@nestjs/common';
import { Prisma, Supplier } from '@prisma/client';

import { CreateSupplierDto } from './dto/create-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';
import { SupplierEntity } from './entities/supplier.entity';
import { SupplierRepository } from './supplier.repository';
import { InvalidReferenceError } from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, match => `\\${match}`);
}

@Injectable()
export class SupplierService {
  constructor(private readonly supplierRepository: SupplierRepository) {}

  async findAll(query: QuerySupplierDto): Promise<SupplierEntity[]> {
    const where: Prisma.SupplierWhereInput = {
      userId: query.userId,
      active: query.active,
      ...(query.search && query.search.length >= 2
        ? { name: { contains: escapeLike(query.search), mode: 'insensitive' } }
        : {}),
    };

    const suppliers = await this.supplierRepository.findMany(
      where,
      (query.page - 1) * query.limit,
      query.limit,
    );
    return suppliers.map(supplier => this.sanitize(supplier));
  }

  async create(dto: CreateSupplierDto): Promise<SupplierEntity> {
    const existing = await this.supplierRepository.findByName(
      dto.userId,
      dto.name,
    );
    if (existing) throw this.duplicatedName();

    try {
      const supplier = await this.supplierRepository.create(dto);
      return this.sanitize(supplier);
    } catch (error) {
      if (error instanceof InvalidReferenceError)
        throw this.invalidReference(error.field);
      throw error;
    }
  }

  private sanitize(supplier: Supplier): SupplierEntity {
    return {
      id: supplier.id,
      name: supplier.name,
      taxId: supplier.taxId,
      taxIdType: supplier.taxIdType,
      contact: supplier.contact,
      email: supplier.email,
      phone: supplier.phone,
      active: supplier.active,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt,
    };
  }

  private duplicatedName(): DomainError {
    return new DomainError(
      'CONFLICT',
      'DUPLICATED_SUPPLIER_NAME',
      'A supplier with this name already exists',
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
