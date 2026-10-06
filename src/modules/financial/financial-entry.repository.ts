import { Injectable } from '@nestjs/common';
import { EntryNature, EntryScope, Prisma } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
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
}
