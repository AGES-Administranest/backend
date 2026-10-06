import { Injectable } from '@nestjs/common';
import { EntryNature, EntryScope, Prisma } from '@prisma/client';

import { RecordNotFoundError, runQuery } from '../../infra/prisma/prisma-errors';
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
  category: { select: { id: true, name: true, defaultScope: true } },
} satisfies Prisma.FinancialEntrySelect;

export type StatementRow = Prisma.FinancialEntryGetPayload<{
  select: typeof statementSelect;
}>;

const entrySelect = {
  ...statementSelect,
  userId: true,
  categoryId: true,
  deletedAt: true,
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

  findStatement(
    userId: string,
    filter: StatementFilter,
    skip: number,
    take: number,
  ): Promise<StatementRow[]> {
    const where: Prisma.FinancialEntryWhereInput = {
      userId,
      deletedAt: null,
      accrualDate: { gte: filter.from, lt: filter.to },
      ...(filter.nature ? { nature: filter.nature } : {}),
      ...(filter.scope ? { scope: filter.scope } : {}),
      ...(filter.categoryId ? { categoryId: filter.categoryId } : {}),
    };
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

  findById(id: string): Promise<OwnedEntry | null> {
    return runQuery(() =>
      this.prisma.financialEntry.findUnique({
        where: { id },
        select: entrySelect,
      }),
    );
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
