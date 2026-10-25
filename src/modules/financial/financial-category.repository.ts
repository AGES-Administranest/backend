import { Injectable } from '@nestjs/common';
import { EntryNature, EntryScope, Prisma } from '@prisma/client';

import { FinancialCategoryResponse } from './entities/financial-category.entity';
import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

const RESPONSE_COLUMNS = {
  id: true,
  userId: true,
  name: true,
  nature: true,
  defaultScope: true,
} satisfies Prisma.FinancialCategorySelect;

type CategoryRow = Prisma.FinancialCategoryGetPayload<{
  select: typeof RESPONSE_COLUMNS;
}>;

function toResponse({
  userId,
  ...category
}: CategoryRow): FinancialCategoryResponse {
  return { ...category, isDefault: userId === null };
}

export interface NewFinancialCategory {
  id: string;
  userId: string;
  name: string;
  nature: EntryNature;
  defaultScope: EntryScope;
}

@Injectable()
export class FinancialCategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findActive(
    userId: string,
    nature?: EntryNature,
  ): Promise<FinancialCategoryResponse[]> {
    const rows = await runQuery(() =>
      this.prisma.financialCategory.findMany({
        where: {
          active: true,
          OR: [{ userId: null }, { userId }],
          ...(nature ? { nature } : {}),
        },
        select: RESPONSE_COLUMNS,
      }),
    );
    return rows.map(toResponse);
  }

  async create(
    category: NewFinancialCategory,
  ): Promise<FinancialCategoryResponse> {
    const row = await runQuery(() =>
      this.prisma.financialCategory.create({
        data: category,
        select: RESPONSE_COLUMNS,
      }),
    );
    return toResponse(row);
  }

  async findOwned(
    userId: string,
    id: string,
  ): Promise<FinancialCategoryResponse | null> {
    const row = await runQuery(() =>
      this.prisma.financialCategory.findFirst({
        where: { id, userId },
        select: RESPONSE_COLUMNS,
      }),
    );
    return row && toResponse(row);
  }

  idIsTaken(id: string): Promise<boolean> {
    return runQuery(async () => {
      const row = await this.prisma.financialCategory.findUnique({
        where: { id },
        select: { id: true },
      });
      return row !== null;
    });
  }

  findNames(
    userId: string,
    ids: string[],
  ): Promise<{ id: string; name: string }[]> {
    return runQuery(() =>
      this.prisma.financialCategory.findMany({
        where: {
          id: { in: ids },
          OR: [{ userId: null }, { userId }],
        },
        select: { id: true, name: true },
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
        where: { id, active: true, OR: [{ userId: null }, { userId }] },
        select: { id: true, nature: true, defaultScope: true },
      }),
    );
  }
}
