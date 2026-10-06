import { Injectable } from '@nestjs/common';
import { EntryNature, EntryScope } from '@prisma/client';

import { FinancialCategoryResponse } from './entities/financial-category.entity';
import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

@Injectable()
export class FinancialCategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActive(
    userId: string,
    nature?: EntryNature,
  ): Promise<FinancialCategoryResponse[]> {
    return runQuery(() =>
      this.prisma.financialCategory.findMany({
        where: {
          active: true,
          OR: [{ userId: null }, { userId }],
          ...(nature ? { nature } : {}),
        },
        select: {
          id: true,
          name: true,
          nature: true,
          defaultScope: true,
        },
      }),
    );
  }

  findDefault(
    name: string,
    nature: EntryNature,
  ): Promise<{ id: string; defaultScope: EntryScope } | null> {
    return runQuery(() =>
      this.prisma.financialCategory.findFirst({
        where: { userId: null, name, nature, active: true },
        select: { id: true, defaultScope: true },
      }),
    );
  }

  findForUser(
    userId: string,
    id: string,
  ): Promise<{
    id: string;
    nature: EntryNature;
    defaultScope: EntryScope;
  } | null> {
    return runQuery(() =>
      this.prisma.financialCategory.findFirst({
        where: { id, OR: [{ userId: null }, { userId }] },
        select: { id: true, nature: true, defaultScope: true },
      }),
    );
  }
}
