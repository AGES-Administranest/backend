import { EntryNature, EntryScope } from '@prisma/client';

import { PrismaService } from '../../src/infra/prisma/prisma.service';

const DEFAULTS: {
  name: string;
  nature: EntryNature;
  defaultScope: EntryScope;
}[] = [
  {
    name: 'Professional fees',
    nature: EntryNature.INCOME,
    defaultScope: EntryScope.PROFESSIONAL,
  },
  {
    name: 'Supplies',
    nature: EntryNature.EXPENSE,
    defaultScope: EntryScope.PROFESSIONAL,
  },
  {
    name: 'Travel',
    nature: EntryNature.EXPENSE,
    defaultScope: EntryScope.PROFESSIONAL,
  },
  {
    name: 'Taxes and fees',
    nature: EntryNature.EXPENSE,
    defaultScope: EntryScope.PROFESSIONAL,
  },
  {
    name: 'Fixed costs',
    nature: EntryNature.EXPENSE,
    defaultScope: EntryScope.PROFESSIONAL,
  },
  {
    name: 'Other',
    nature: EntryNature.EXPENSE,
    defaultScope: EntryScope.PROFESSIONAL,
  },
  {
    name: 'Other',
    nature: EntryNature.INCOME,
    defaultScope: EntryScope.PERSONAL,
  },
];

export async function ensureDefaultFinancialCategories(
  prisma: PrismaService,
): Promise<void> {
  for (const category of DEFAULTS) {
    const existing = await prisma.financialCategory.findFirst({
      where: { userId: null, name: category.name, nature: category.nature },
    });
    if (existing) continue;
    await prisma.financialCategory.create({
      data: { userId: null, ...category },
    });
  }
}
