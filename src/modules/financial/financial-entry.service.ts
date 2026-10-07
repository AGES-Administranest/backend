import { Injectable } from '@nestjs/common';
import { EntryNature, EntryScope, EntrySource, Prisma } from '@prisma/client';

import { CreateFinancialEntryDto } from './dto/create-financial-entry.dto';
import { QueryFinancialEntryDto } from './dto/query-financial-entry.dto';
import { SyncFinancialEntryDto } from './dto/sync-financial-entry.dto';
import { UpdateFinancialEntryDto } from './dto/update-financial-entry.dto';
import {
  FinancialEntryResponse,
  FinancialEntrySyncResult,
} from './entities/financial-entry.entity';
import { FinancialCategoryRepository } from './financial-category.repository';
import {
  FinancialEntryRepository,
  OwnedEntry,
  StatementRow,
} from './financial-entry.repository';
import { UniqueConstraintError } from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

export function accrualMonth(year?: number, month?: number, now = new Date()) {
  const y = year ?? now.getUTCFullYear();
  const m = month ?? now.getUTCMonth() + 1;
  return {
    from: new Date(Date.UTC(y, m - 1, 1)),
    to: new Date(Date.UTC(y, m, 1)),
  };
}

const CLOCK_SKEW_TOLERANCE_MS = 10 * 60 * 1000;

function sameManualPayload(
  existing: OwnedEntry,
  dto: CreateFinancialEntryDto,
): boolean {
  return (
    existing.source === EntrySource.MANUAL &&
    existing.nature === dto.nature &&
    existing.description === dto.description &&
    existing.categoryId === dto.categoryId &&
    existing.amount.equals(new Prisma.Decimal(dto.amount)) &&
    existing.accrualDate.getTime() === new Date(dto.accrualDate).getTime() &&
    (dto.scope === undefined || existing.scope === dto.scope)
  );
}

function originDetails(entry: OwnedEntry): Record<string, unknown> {
  const origin = toStatementEntry(entry).origin;
  return { type: origin.type, id: origin.id };
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
    category: {
      id: row.category.id,
      name: row.category.name,
      scope: row.category.defaultScope,
    },
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
    const existing = await this.repository.findForUser(userId, dto.id);
    if (existing) {
      if (
        existing.deletedAt === null &&
        existing.source === EntrySource.MANUAL &&
        sameManualPayload(existing, dto)
      ) {
        return toStatementEntry(existing);
      }
      throw new DomainError(
        'CONFLICT',
        'FINANCIAL_ENTRY_ID_CONFLICT',
        'This id is already in use',
      );
    }
    if (await this.repository.idIsTaken(dto.id)) {
      throw new DomainError(
        'CONFLICT',
        'FINANCIAL_ENTRY_ID_CONFLICT',
        'This id is already in use',
      );
    }

    const category = await this.categoryFor(userId, dto.categoryId, dto.nature);
    try {
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
    } catch (error) {
      if (!(error instanceof UniqueConstraintError)) throw error;
      const winner = await this.repository.findForUser(userId, dto.id);
      if (
        winner &&
        winner.deletedAt === null &&
        winner.source === EntrySource.MANUAL &&
        sameManualPayload(winner, dto)
      ) {
        return toStatementEntry(winner);
      }
      throw new DomainError(
        'CONFLICT',
        'FINANCIAL_ENTRY_ID_CONFLICT',
        'This id is already in use',
      );
    }
  }

  async recordPurchaseInvoice(
    input: {
      userId: string;
      purchaseInvoiceId: string;
      amount: Prisma.Decimal;
      issueDate: Date;
      number: string | null;
    },
    db?: Prisma.TransactionClient,
  ): Promise<void> {
    const existing = await this.repository.findByPurchaseInvoice(
      input.userId,
      input.purchaseInvoiceId,
      db,
    );
    if (existing) return;

    const category = await this.categories.findDefault(
      'Supplies',
      EntryNature.EXPENSE,
    );
    if (!category) {
      throw new DomainError(
        'INVALID_INPUT',
        'FINANCIAL_CATEGORY_NOT_SEEDED',
        'Supplies category is not seeded',
      );
    }

    await this.repository.create(
      {
        userId: input.userId,
        nature: EntryNature.EXPENSE,
        scope: category.defaultScope,
        categoryId: category.id,
        description: input.number
          ? `Invoice ${input.number}`
          : 'Purchase invoice',
        amount: input.amount,
        accrualDate: input.issueDate,
        source: EntrySource.PURCHASE_INVOICE,
        purchaseInvoiceId: input.purchaseInvoiceId,
      },
      db,
    );
  }

  async sync(
    userId: string,
    operations: SyncFinancialEntryDto[],
  ): Promise<FinancialEntrySyncResult[]> {
    const now = Date.now();
    for (const operation of operations) {
      const at = new Date(operation.occurredAt);
      if (at.getTime() > now + CLOCK_SKEW_TOLERANCE_MS) {
        throw new DomainError(
          'INVALID_INPUT',
          'FINANCIAL_ENTRY_DATE_IN_FUTURE',
          'This operation is dated in the future. Check the clock on the device that recorded it.',
          {
            id: operation.id,
            occurredAt: at.toISOString(),
            serverTime: new Date(now).toISOString(),
          },
        );
      }
    }
    const ordered = [...operations].sort(
      (a, b) =>
        new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );
    const written = new Set<string>();
    const results: FinancialEntrySyncResult[] = [];
    for (const operation of ordered) {
      results.push(await this.applySync(userId, operation, written));
    }
    return results;
  }

  private async applySync(
    userId: string,
    operation: SyncFinancialEntryDto,
    written: Set<string>,
  ): Promise<FinancialEntrySyncResult> {
    const existing = await this.repository.findForUser(userId, operation.id);
    const at = new Date(operation.occurredAt);

    if (operation.operation === 'create') {
      if (existing?.deletedAt) {
        return this.syncConflict(operation.id, 'FINANCIAL_ENTRY_SYNC_CONFLICT');
      }
      if (!existing && (await this.repository.idIsTaken(operation.id))) {
        return this.syncConflict(operation.id, 'FINANCIAL_ENTRY_ID_CONFLICT');
      }
      if (existing) {
        const replay: CreateFinancialEntryDto = {
          id: operation.id,
          nature: operation.nature ?? existing.nature,
          description: operation.description ?? existing.description,
          amount: operation.amount ?? existing.amount.toNumber(),
          accrualDate:
            operation.accrualDate ?? existing.accrualDate.toISOString(),
          categoryId: operation.categoryId ?? existing.categoryId,
          scope: operation.scope,
        };
        if (!sameManualPayload(existing, replay)) {
          return this.syncConflict(operation.id, 'FINANCIAL_ENTRY_ID_CONFLICT');
        }
        return { id: operation.id, result: 'ignored' };
      }
      if (
        !operation.nature ||
        !operation.description ||
        operation.amount == null ||
        !operation.accrualDate ||
        !operation.categoryId
      ) {
        return this.syncConflict(operation.id, 'VALIDATION_ERROR');
      }
      try {
        await this.create(userId, {
          id: operation.id,
          nature: operation.nature,
          description: operation.description,
          amount: operation.amount,
          accrualDate: operation.accrualDate,
          categoryId: operation.categoryId,
          scope: operation.scope,
        });
        written.add(operation.id);
        return { id: operation.id, result: 'applied' };
      } catch (error) {
        return this.syncFailure(operation.id, error);
      }
    }

    if (!existing || existing.deletedAt) {
      return this.syncConflict(operation.id, 'FINANCIAL_ENTRY_SYNC_CONFLICT');
    }
    if (!written.has(operation.id) && existing.updatedAt > at) {
      return this.syncConflict(operation.id, 'FINANCIAL_ENTRY_SYNC_CONFLICT');
    }

    try {
      if (operation.operation === 'delete') {
        await this.remove(userId, operation.id);
      } else {
        await this.update(userId, operation.id, {
          nature: operation.nature,
          description: operation.description,
          amount: operation.amount,
          accrualDate: operation.accrualDate,
          categoryId: operation.categoryId,
          scope: operation.scope,
          notes: operation.notes,
        });
      }
      written.add(operation.id);
      return { id: operation.id, result: 'applied' };
    } catch (error) {
      return this.syncFailure(operation.id, error);
    }
  }

  private syncConflict(
    id: string,
    code: FinancialEntrySyncResult['code'],
  ): FinancialEntrySyncResult {
    return { id, result: 'conflict', code };
  }

  private syncFailure(id: string, error: unknown): FinancialEntrySyncResult {
    if (!(error instanceof DomainError)) throw error;
    return { id, result: 'conflict', code: error.code };
  }

  async findOne(userId: string, id: string): Promise<FinancialEntryResponse> {
    return toStatementEntry(await this.owned(userId, id));
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateFinancialEntryDto,
  ): Promise<FinancialEntryResponse> {
    const entry = await this.owned(userId, id);
    if (entry.source !== EntrySource.MANUAL) {
      if (dto.amount !== undefined || dto.accrualDate !== undefined) {
        throw new DomainError(
          'INVALID_INPUT',
          'FINANCIAL_ENTRY_CONTROLLED_BY_ORIGIN',
          'Amount and accrual date are controlled by the origin',
          originDetails(entry),
        );
      }
      if (dto.nature !== undefined) {
        throw new DomainError(
          'INVALID_INPUT',
          'FINANCIAL_ENTRY_CONTROLLED_BY_ORIGIN',
          'Only description, category, scope and notes can be changed on an automatic entry',
        );
      }
    }
    const nature = dto.nature ?? entry.nature;
    const categoryId = dto.categoryId ?? entry.categoryId;
    if (dto.nature || dto.categoryId) {
      await this.categoryFor(userId, categoryId, nature);
    }
    const updated = await this.repository.update(userId, id, {
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
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    });
    return toStatementEntry(updated);
  }

  async remove(userId: string, id: string): Promise<void> {
    const entry = await this.owned(userId, id);
    if (entry.source !== EntrySource.MANUAL) {
      throw new DomainError(
        'CONFLICT',
        'FINANCIAL_ENTRY_DELETE_VIA_ORIGIN',
        'An automatic entry can only be deleted by deleting its origin',
        originDetails(entry),
      );
    }
    await this.repository.update(userId, id, { deletedAt: new Date() });
  }

  private async owned(userId: string, id: string): Promise<OwnedEntry> {
    const entry = await this.repository.findOwned(userId, id);
    if (!entry) {
      throw new DomainError(
        'NOT_FOUND',
        'FINANCIAL_ENTRY_NOT_FOUND',
        'Financial entry was not found',
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
