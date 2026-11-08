import { Injectable } from '@nestjs/common';
import { Prisma, Supplier } from '@prisma/client';

import { CreateSupplierDto } from './dto/create-supplier.dto';
import { QuerySupplierDto } from './dto/query-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { SupplierEntity } from './entities/supplier.entity';
import { SupplierRepository } from './supplier.repository';
import {
  InvalidReferenceError,
  RecordNotFoundError,
  UniqueConstraintError,
} from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, match => `\\${match}`);
}

// The alphanumeric CNPJ (July 2026) has letters too.
function unmask(taxId: string): string {
  return taxId.replace(/[^0-9a-z]/gi, '').toUpperCase();
}

@Injectable()
export class SupplierService {
  constructor(private readonly supplierRepository: SupplierRepository) {}

  async findAll(
    userId: string,
    query: QuerySupplierDto,
  ): Promise<SupplierEntity[]> {
    const where: Prisma.SupplierWhereInput = {
      userId,
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

  async findOne(id: string, userId: string): Promise<SupplierEntity> {
    const supplier = await this.supplierRepository.findById(id, userId);
    if (!supplier) throw this.notFound(id);
    return this.sanitize(supplier);
  }

  isActiveAndOwned(userId: string, supplierId: string): Promise<boolean> {
    return this.supplierRepository.isActiveAndOwned(userId, supplierId);
  }

  /**
   * The supplier a document names by its CNPJ. Compared without the mask: a
   * tax id typed before the digits-only rule may still carry one.
   */
  async findIdByTaxId(
    userId: string,
    taxId: string,
  ): Promise<string | undefined> {
    const suppliers = await this.supplierRepository.findMany({
      userId,
      active: true,
      deletedAt: null,
      taxId: { not: null },
    });
    const wanted = unmask(taxId);
    return suppliers.find(
      supplier => supplier.taxId && unmask(supplier.taxId) === wanted,
    )?.id;
  }

  async create(
    userId: string,
    dto: CreateSupplierDto,
  ): Promise<SupplierEntity> {
    try {
      const supplier = await this.supplierRepository.create({
        ...dto,
        ...(dto.taxId ? { taxId: unmask(dto.taxId) } : {}),
        userId,
      });
      return this.sanitize(supplier);
    } catch (error) {
      if (
        error instanceof UniqueConstraintError &&
        error.fields.some(field => field.includes('tax_id'))
      ) {
        throw this.duplicatedTaxId();
      }
      if (error instanceof InvalidReferenceError)
        throw this.invalidReference(error.field);
      throw error;
    }
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateSupplierDto,
  ): Promise<SupplierEntity> {
    try {
      const supplier = await this.supplierRepository.update(id, userId, {
        ...dto,
        ...(dto.taxId ? { taxId: unmask(dto.taxId) } : {}),
      });
      if (!supplier) throw this.notFound(id);
      return this.sanitize(supplier);
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.notFound(id);
      if (
        error instanceof UniqueConstraintError &&
        error.fields.some(field => field.includes('tax_id'))
      ) {
        throw this.duplicatedTaxId();
      }
      if (error instanceof InvalidReferenceError)
        throw this.invalidReference(error.field);
      throw error;
    }
  }

  async remove(id: string, userId: string): Promise<SupplierEntity> {
    const supplier = await this.supplierRepository.deactivate(id, userId);
    if (!supplier) throw this.notFound(id);
    return this.sanitize(supplier);
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
      notes: supplier.notes,
      active: supplier.active,
      createdAt: supplier.createdAt,
      updatedAt: supplier.updatedAt,
    };
  }

  private duplicatedTaxId(): DomainError {
    return new DomainError(
      'CONFLICT',
      'DUPLICATED_SUPPLIER_TAX_ID',
      'A supplier with this tax id already exists',
    );
  }

  private notFound(id: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'SUPPLIER_NOT_FOUND',
      `Supplier ${id} not found`,
      { id },
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
