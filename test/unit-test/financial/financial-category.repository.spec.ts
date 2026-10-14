import { EntryNature, EntryScope } from '@prisma/client';

import { FinancialCategoryRepository } from '../../../src/modules/financial/financial-category.repository';

describe('FinancialCategoryRepository', () => {
  let prisma: {
    financialCategory: { findMany: jest.Mock; findFirst: jest.Mock };
  };
  let repository: FinancialCategoryRepository;

  beforeEach(() => {
    prisma = {
      financialCategory: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    repository = new FinancialCategoryRepository(prisma as never);
  });

  describe('findActive', () => {
    it('marks a category without an owner as default and hides the owner', async () => {
      prisma.financialCategory.findMany.mockResolvedValue([
        {
          id: 'default-1',
          userId: null,
          name: 'Supplies',
          nature: EntryNature.EXPENSE,
          defaultScope: EntryScope.PROFESSIONAL,
        },
        {
          id: 'mine-1',
          userId: 'user-1',
          name: 'Food',
          nature: EntryNature.EXPENSE,
          defaultScope: EntryScope.PERSONAL,
        },
      ]);

      const categories = await repository.findActive('user-1');

      expect(categories).toEqual([
        {
          id: 'default-1',
          name: 'Supplies',
          nature: EntryNature.EXPENSE,
          defaultScope: EntryScope.PROFESSIONAL,
          isDefault: true,
        },
        {
          id: 'mine-1',
          name: 'Food',
          nature: EntryNature.EXPENSE,
          defaultScope: EntryScope.PERSONAL,
          isDefault: false,
        },
      ]);
      expect(categories.every(category => !('userId' in category))).toBe(true);
    });

    it('reads only active defaults and the caller categories', async () => {
      await repository.findActive('user-1', EntryNature.INCOME);

      const [{ where }] = prisma.financialCategory.findMany.mock.calls[0] as [
        { where: object },
      ];
      expect(where).toEqual({
        active: true,
        OR: [{ userId: null }, { userId: 'user-1' }],
        nature: EntryNature.INCOME,
      });
    });
  });

  describe('findForUser', () => {
    it('ignores an inactive category, so no new entry can point at it', async () => {
      await repository.findForUser('user-1', 'category-1');

      const [{ where }] = prisma.financialCategory.findFirst.mock.calls[0] as [
        { where: object },
      ];
      expect(where).toEqual({
        id: 'category-1',
        active: true,
        OR: [{ userId: null }, { userId: 'user-1' }],
      });
    });
  });
});
