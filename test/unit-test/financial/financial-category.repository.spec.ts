import { EntryNature, EntryScope, Prisma } from '@prisma/client';

import { UniqueConstraintError } from '../../../src/infra/prisma/prisma-errors';
import { FinancialCategoryRepository } from '../../../src/modules/financial/financial-category.repository';

const OWN_ROW = {
  id: 'mine-1',
  userId: 'user-1',
  name: 'Food',
  nature: EntryNature.EXPENSE,
  defaultScope: EntryScope.PERSONAL,
};

describe('FinancialCategoryRepository', () => {
  let prisma: {
    financialCategory: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };
  let repository: FinancialCategoryRepository;

  beforeEach(() => {
    prisma = {
      financialCategory: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(OWN_ROW),
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

  describe('create', () => {
    const newCategory = {
      id: 'mine-1',
      userId: 'user-1',
      name: 'Food',
      nature: EntryNature.EXPENSE,
      defaultScope: EntryScope.PERSONAL,
    };

    it('stores the category and answers it as a user category', async () => {
      const created = await repository.create(newCategory);

      expect(prisma.financialCategory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: newCategory }),
      );
      expect(created).toEqual({
        id: 'mine-1',
        name: 'Food',
        nature: EntryNature.EXPENSE,
        defaultScope: EntryScope.PERSONAL,
        isDefault: false,
      });
    });

    it('raises a unique violation in the application vocabulary', async () => {
      prisma.financialCategory.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
          meta: { target: ['user_id', 'nature', 'name'] },
        }),
      );

      await expect(repository.create(newCategory)).rejects.toBeInstanceOf(
        UniqueConstraintError,
      );
    });
  });

  describe('findOwned', () => {
    it('reads the category only among the caller categories', async () => {
      prisma.financialCategory.findFirst.mockResolvedValue(OWN_ROW);

      const found = await repository.findOwned('user-1', 'mine-1');

      const [{ where }] = prisma.financialCategory.findFirst.mock.calls[0] as [
        { where: object },
      ];
      expect(where).toEqual({ id: 'mine-1', userId: 'user-1' });
      expect(found).toMatchObject({ id: 'mine-1', isDefault: false });
    });

    it('answers null when the caller does not own it', async () => {
      expect(await repository.findOwned('user-1', 'theirs-1')).toBeNull();
    });
  });

  describe('idIsTaken', () => {
    it('is true for an id used by any category, whoever owns it', async () => {
      prisma.financialCategory.findUnique.mockResolvedValue({ id: 'any-1' });

      expect(await repository.idIsTaken('any-1')).toBe(true);
      expect(prisma.financialCategory.findUnique).toHaveBeenCalledWith({
        where: { id: 'any-1' },
        select: { id: true },
      });
    });

    it('is false for a new id', async () => {
      expect(await repository.idIsTaken('new-1')).toBe(false);
    });
  });
});
