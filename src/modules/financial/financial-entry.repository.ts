import { Injectable } from '@nestjs/common';
import { EntryNature, EntryScope, Prisma } from '@prisma/client';

import {
  RecordNotFoundError,
  runQuery,
} from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

const statementSelect = {
  id: true,
  nature: true,
  description: true,
  scope: true,
  amount: true,
  accrualDate: true,
  source: true,
  appointmentId: true,
  serviceInvoiceId: true,
  purchaseInvoiceId: true,
  tripId: true,
  // userId only feeds isDefault in the response; it is never returned.
  category: {
    select: { id: true, name: true, defaultScope: true, userId: true },
  },
} satisfies Prisma.FinancialEntrySelect;

export type StatementRow = Prisma.FinancialEntryGetPayload<{
  select: typeof statementSelect;
}>;

const entrySelect = {
  ...statementSelect,
  userId: true,
  categoryId: true,
  deletedAt: true,
  updatedAt: true,
} satisfies Prisma.FinancialEntrySelect;

export type OwnedEntry = Prisma.FinancialEntryGetPayload<{
  select: typeof entrySelect;
}>;

export interface StatementFilter {
  from: Date;
  to: Date;
  nature?: EntryNature;
  scope?: EntryScope;
  categoryId?: string;
}

@Injectable()
export class FinancialEntryRepository {
  constructor(private readonly prisma: PrismaService) {}

  // The one definition of "what the statement shows", so the statement and
  // the totals built on it cannot drift apart.
  private statementWhere(
    userId: string,
    filter: StatementFilter,
  ): Prisma.FinancialEntryWhereInput {
    return {
      userId,
      deletedAt: null,
      accrualDate: { gte: filter.from, lt: filter.to },
      ...(filter.nature ? { nature: filter.nature } : {}),
      ...(filter.scope ? { scope: filter.scope } : {}),
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
    };
  }

  sumByScope(
    userId: string,
    filter: StatementFilter,
  ): Promise<{ scope: EntryScope; total: Prisma.Decimal }[]> {
    return runQuery(async () => {
      const rows = await this.prisma.financialEntry.groupBy({
        by: ['scope'],
        where: this.statementWhere(userId, filter),
        _sum: { amount: true },
      });
      return rows.map(row => ({
        scope: row.scope,
        total: row._sum.amount ?? new Prisma.Decimal(0),
      }));
    });
  }

  sumByNatureScopeCategory(
    userId: string,
    filter: StatementFilter,
  ): Promise<
    {
      nature: EntryNature;
      scope: EntryScope;
      categoryId: string;
      total: Prisma.Decimal;
    }[]
  > {
    return runQuery(async () => {
      const rows = await this.prisma.financialEntry.groupBy({
        by: ['nature', 'scope', 'categoryId'],
        where: this.statementWhere(userId, filter),
        _sum: { amount: true },
      });
      return rows.map(row => ({
        nature: row.nature,
        scope: row.scope,
        categoryId: row.categoryId,
        total: row._sum.amount ?? new Prisma.Decimal(0),
      }));
    });
  }

  findStatement(
    userId: string,
    filter: StatementFilter,
    skip: number,
    take: number,
  ): Promise<StatementRow[]> {
    const where = this.statementWhere(userId, filter);
    return runQuery(() =>
      this.prisma.financialEntry.findMany({
        where,
        select: statementSelect,
        orderBy: [{ accrualDate: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
    );
  }

  findByPurchaseInvoice(
    userId: string,
    purchaseInvoiceId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{ id: string } | null> {
    return runQuery(() =>
      db.financialEntry.findFirst({
        where: { userId, purchaseInvoiceId, deletedAt: null },
        select: { id: true },
      }),
    );
  }

  /**
   * The trip's entry, deleted or not: trip_id is unique, so a deleted entry is
   * revived rather than created again.
   */
  findByTrip(
    userId: string,
    tripId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{ id: string; deletedAt: Date | null } | null> {
    return runQuery(() =>
      db.financialEntry.findFirst({
        where: { userId, tripId },
        select: { id: true, deletedAt: true },
      }),
    );
  }

  findByServiceInvoice(
    userId: string,
    serviceInvoiceId: string,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<{ id: string } | null> {
    return runQuery(() =>
      db.financialEntry.findFirst({
        where: { userId, serviceInvoiceId, deletedAt: null },
        select: { id: true },
      }),
    );
  }

  /** For automatic entries, whose origin decides every change. */
  async updateById(
    id: string,
    data: Prisma.FinancialEntryUncheckedUpdateInput,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    await runQuery(() =>
      db.financialEntry.update({ where: { id }, data, select: { id: true } }),
    );
  }

  /** Updates the note's entry, unless it was already deleted. */
  async updateByServiceInvoice(
    userId: string,
    serviceInvoiceId: string,
    data: Prisma.FinancialEntryUncheckedUpdateManyInput,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    await runQuery(() =>
      db.financialEntry.updateMany({
        where: { userId, serviceInvoiceId, deletedAt: null },
        data,
      }),
    );
  }

  findForUser(userId: string, id: string): Promise<OwnedEntry | null> {
    return runQuery(() =>
      this.prisma.financialEntry.findFirst({
        where: { id, userId },
        select: entrySelect,
      }),
    );
  }

  idIsTaken(id: string): Promise<boolean> {
    return runQuery(async () => {
      const row = await this.prisma.financialEntry.findUnique({
        where: { id },
        select: { id: true },
      });
      return row !== null;
    });
  }

  findOwned(userId: string, id: string): Promise<OwnedEntry | null> {
    return runQuery(() =>
      this.prisma.financialEntry.findFirst({
        where: { id, userId, deletedAt: null },
        select: entrySelect,
      }),
    );
  }

  create(
    data: Prisma.FinancialEntryUncheckedCreateInput,
    db: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<StatementRow> {
    return runQuery(() =>
      db.financialEntry.create({ data, select: statementSelect }),
    );
  }

  async update(
    userId: string,
    id: string,
    data: Prisma.FinancialEntryUncheckedUpdateInput,
  ): Promise<StatementRow> {
    return runQuery(async () => {
      const { count } = await this.prisma.financialEntry.updateMany({
        where: { id, userId, deletedAt: null },
        data,
      });
      if (count === 0) throw new RecordNotFoundError();
      return this.prisma.financialEntry.findFirstOrThrow({
        where: { id, userId },
        select: statementSelect,
      });
    });
  }
}
