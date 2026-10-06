import { Injectable } from '@nestjs/common';
import { EntryNature } from '@prisma/client';

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
}
