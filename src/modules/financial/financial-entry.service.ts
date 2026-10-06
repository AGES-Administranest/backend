import { Injectable } from '@nestjs/common';
import { EntryNature, EntryScope, EntrySource, Prisma } from '@prisma/client';

import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { QueryFinancialEntryDto } from './dto/query-financial-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import { FinancialEntryResponse } from './entities/financial-entry.entity';
import { FinancialCategoryRepository } from './financial-category.repository';
import {
  FinancialEntryRepository,
  OwnedEntry,
  StatementRow,
} from './financial-entry.repository';
import { DomainError } from '../../shared/errors/domain-error';

export function accrualMonth(year?: number, month?: number, now = new Date()) {
  const y = year ?? now.getUTCFullYear();
  const m = month ?? now.getUTCMonth() + 1;
  return {
    from: new Date(Date.UTC(y, m - 1, 1)),
    to: new Date(Date.UTC(y, m, 1)),
  };
}

export function toStatementEntry(row: StatementRow): FinancialEntryResponse {
  const id =
    row.appointmentId ??
    row.serviceInvoiceId ??
    row.purchaseInvoiceId ??
    row.tripId ??
    null;
  return {
    id: row.id,
    nature: row.nature,
    description: row.description,
    category: row.category,
    scope: row.scope,
    amount: row.amount,
    accrualDate: row.accrualDate,
    source: row.source,
    origin: { type: row.source, id },
  };
}

@Injectable()
export class FinancialEntryService {
  constructor(
    private readonly repository: FinancialEntryRepository,
    private readonly categories: FinancialCategoryRepository,
  ) {}

  async findAll(
    userId: string,
    query: QueryFinancialEntryDto,
  ): Promise<FinancialEntryResponse[]> {
    const { from, to } = accrualMonth(query.year, query.month);
    const rows = await this.repository.findStatement(
      userId,
      {
        from,
        to,
        nature: query.nature,
        scope: query.scope,
        categoryId: query.categoryId,
      },
      (query.page - 1) * query.limit,
      query.limit,
    );
    return rows.map(toStatementEntry);
  }

  async create(
    userId: string,
    dto: CreateFinancialEntryDto,
  ): Promise<FinancialEntryResponse> {
    const existing = await this.repository.findById(dto.id);
    if (existing) {
      if (
        existing.userId === userId &&
        existing.deletedAt === null &&
        existing.source === EntrySource.MANUAL
      ) {
        return toStatementEntry(existing);
      }
      throw new DomainError(
        'CONFLICT',
        'FINANCIAL_ENTRY_ID_CONFLICT',
        'This id is already in use',
      );
    }

    const category = await this.categoryFor(userId, dto.categoryId, dto.nature);
    const created = await this.repository.create({
      id: dto.id,
      userId,
      nature: dto.nature,
      description: dto.description,
      amount: new Prisma.Decimal(dto.amount),
      accrualDate: new Date(dto.accrualDate),
      categoryId: dto.categoryId,
      scope: dto.scope ?? category.defaultScope,
      source: EntrySource.MANUAL,
    });
    return toStatementEntry(created);
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateFinancialEntryDto,
  ): Promise<FinancialEntryResponse> {
    const entry = await this.manualEntry(userId, id);
    const nature = dto.nature ?? entry.nature;
    const categoryId = dto.categoryId ?? entry.categoryId;
    if (dto.nature || dto.categoryId) {
      await this.categoryFor(userId, categoryId, nature);
    }
    const updated = await this.repository.update(id, {
      ...(dto.nature ? { nature: dto.nature } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.amount !== undefined
        ? { amount: new Prisma.Decimal(dto.amount) }
        : {}),
      ...(dto.accrualDate ? { accrualDate: new Date(dto.accrualDate) } : {}),
      ...(dto.categoryId ? { categoryId: dto.categoryId } : {}),
      ...(dto.scope ? { scope: dto.scope } : {}),
    });
    return toStatementEntry(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    await this.manualEntry(userId, id);
    await this.repository.update(id, { deletedAt: new Date() });
  }

  private async manualEntry(userId: string, id: string): Promise<OwnedEntry> {
    const entry = await this.repository.findOwned(userId, id);
    if (!entry) {
      throw new DomainError(
        'NOT_FOUND',
        'FINANCIAL_ENTRY_NOT_FOUND',
        'Financial entry was not found',
      );
    }
    if (entry.source !== EntrySource.MANUAL) {
      throw new DomainError(
        'INVALID_INPUT',
        'FINANCIAL_ENTRY_NOT_MANUAL',
        'Only a manual entry can be changed',
      );
    }
    return entry;
  }

  private async categoryFor(
    userId: string,
    categoryId: string,
    nature: EntryNature,
  ): Promise<{ defaultScope: EntryScope }> {
    const category = await this.categories.findForUser(userId, categoryId);
    if (!category || category.nature !== nature) {
      throw new DomainError(
        'INVALID_INPUT',
        'FINANCIAL_CATEGORY_INVALID',
        'Category was not found or does not match the entry nature',
      );
    }
    return category;
  }
}
