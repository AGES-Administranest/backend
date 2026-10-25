import { EntryNature, EntryScope } from '@prisma/client';

import { UniqueConstraintError } from '../../../src/infra/prisma/prisma-errors';
import { CreateFinancialCategoryDto } from '../../../src/modules/financial/dto/create-financial-category.dto';
import { QueryFinancialCategoryDto } from '../../../src/modules/financial/dto/query-financial-category.dto';
import { FinancialCategoryResponse } from '../../../src/modules/financial/entities/financial-category.entity';
import { FinancialCategoryService } from '../../../src/modules/financial/financial-category.service';

const NEW_ID = '3b8f5d2e-1c4a-4e7b-9a60-2f1d8c7e5b43';

const DEFAULT_OTHER_EXPENSE: FinancialCategoryResponse = {
  id: 'default-other-expense',
  name: 'Other',
  nature: EntryNature.EXPENSE,
  defaultScope: EntryScope.PROFESSIONAL,
  isDefault: true,
};

const OWN_FOOD: FinancialCategoryResponse = {
  id: 'own-food',
  name: 'Comida',
  nature: EntryNature.EXPENSE,
  defaultScope: EntryScope.PERSONAL,
  isDefault: false,
};

function dto(
  overrides: Partial<CreateFinancialCategoryDto> = {},
): CreateFinancialCategoryDto {
  return Object.assign(new CreateFinancialCategoryDto(), {
    id: NEW_ID,
    name: 'Material de escritório',
    nature: EntryNature.EXPENSE,
    defaultScope: EntryScope.PROFESSIONAL,
    ...overrides,
  });
}

function asCreated(payload: CreateFinancialCategoryDto) {
  return {
    id: payload.id,
    name: payload.name,
    nature: payload.nature,
    defaultScope: payload.defaultScope,
    isDefault: false,
  };
}

describe('FinancialCategoryService', () => {
  let visible: FinancialCategoryResponse[];
  let repository: {
    findActive: jest.Mock;
    findOwned: jest.Mock;
    idIsTaken: jest.Mock;
    create: jest.Mock;
  };
  let service: FinancialCategoryService;

  beforeEach(() => {
    visible = [DEFAULT_OTHER_EXPENSE, OWN_FOOD];
    repository = {
      findActive: jest.fn((_userId: string, nature?: EntryNature) =>
        Promise.resolve(
          visible.filter(category => !nature || category.nature === nature),
        ),
      ),
      findOwned: jest.fn().mockResolvedValue(null),
      idIsTaken: jest.fn().mockResolvedValue(false),
      create: jest.fn((category: CreateFinancialCategoryDto) =>
        Promise.resolve(asCreated(category)),
      ),
    };
    service = new FinancialCategoryService(repository as never);
  });

  describe('findAll', () => {
    it('asks the repository for this user, with no nature filter', async () => {
      await service.findAll('user-1', new QueryFinancialCategoryDto());

      expect(repository.findActive).toHaveBeenCalledWith('user-1', undefined);
    });

    it('forwards the nature filter', async () => {
      const query = new QueryFinancialCategoryDto();
      query.nature = EntryNature.EXPENSE;

      await service.findAll('user-1', query);

      expect(repository.findActive).toHaveBeenCalledWith(
        'user-1',
        EntryNature.EXPENSE,
      );
    });
  });

  describe('create', () => {
    it('creates the category for the caller and answers it', async () => {
      const created = await service.create('user-1', dto());

      expect(repository.create).toHaveBeenCalledWith({
        id: NEW_ID,
        userId: 'user-1',
        name: 'Material de escritório',
        nature: EntryNature.EXPENSE,
        defaultScope: EntryScope.PROFESSIONAL,
      });
      expect(created).toEqual(asCreated(dto()));
    });

    it('takes the owner from the token, never from the payload', async () => {
      const smuggled = Object.assign(dto(), { userId: 'someone-else' });

      await service.create('user-1', smuggled);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
      expect(repository.create).not.toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'someone-else' }),
      );
    });

    it.each(['Comida', 'comida', 'COMÍDA', 'Comída'])(
      'refuses %j next to the user category "Comida", pointing at it',
      async name => {
        await expect(
          service.create('user-1', dto({ name })),
        ).rejects.toMatchObject({
          code: 'FINANCIAL_CATEGORY_DUPLICATED',
          details: { id: OWN_FOOD.id },
        });
        expect(repository.create).not.toHaveBeenCalled();
      },
    );

    it.each(['Other', 'other', 'OTHER'])(
      'refuses %j next to the default "Other" of the same nature',
      async name => {
        await expect(
          service.create('user-1', dto({ name })),
        ).rejects.toMatchObject({
          code: 'FINANCIAL_CATEGORY_DUPLICATED',
          details: { id: DEFAULT_OTHER_EXPENSE.id },
        });
      },
    );

    it('compares only with categories of the same nature', async () => {
      const income = dto({ name: 'Comida', nature: EntryNature.INCOME });

      await expect(service.create('user-1', income)).resolves.toEqual(
        asCreated(income),
      );
      expect(repository.findActive).toHaveBeenCalledWith(
        'user-1',
        EntryNature.INCOME,
      );
    });

    it('accepts "Outros": defaults are stored in English and only the app translates them', async () => {
      const outros = dto({ name: 'Outros' });

      await expect(service.create('user-1', outros)).resolves.toEqual(
        asCreated(outros),
      );
    });

    it('returns the category already created when the same request is sent again', async () => {
      repository.findOwned.mockResolvedValue(asCreated(dto()));

      await expect(service.create('user-1', dto())).resolves.toEqual(
        asCreated(dto()),
      );
      expect(repository.findOwned).toHaveBeenCalledWith('user-1', NEW_ID);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it.each([
      ['another name', { name: 'Papelaria' }],
      ['another nature', { nature: EntryNature.INCOME }],
      ['another default scope', { defaultScope: EntryScope.PERSONAL }],
    ])(
      'refuses the id of a category of the user with %s',
      async (_case, overrides) => {
        repository.findOwned.mockResolvedValue(asCreated(dto()));

        await expect(
          service.create('user-1', dto(overrides)),
        ).rejects.toMatchObject({ code: 'FINANCIAL_CATEGORY_ID_CONFLICT' });
        expect(repository.create).not.toHaveBeenCalled();
      },
    );

    it('refuses an id that belongs to another account or to a default, without saying whose', async () => {
      repository.idIsTaken.mockResolvedValue(true);

      await expect(service.create('user-1', dto())).rejects.toMatchObject({
        code: 'FINANCIAL_CATEGORY_ID_CONFLICT',
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    describe('when a concurrent request inserts first', () => {
      beforeEach(() => {
        repository.create.mockRejectedValue(
          new UniqueConstraintError(['user_id', 'nature', 'name']),
        );
      });

      it('answers the duplicate it lost to, with its id', async () => {
        const winner = { ...asCreated(dto()), id: 'winner-id' };
        repository.findActive
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([winner]);

        await expect(service.create('user-1', dto())).rejects.toMatchObject({
          code: 'FINANCIAL_CATEGORY_DUPLICATED',
          details: { id: 'winner-id' },
        });
      });

      it('returns the category when the winner was this same request', async () => {
        repository.findOwned
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(asCreated(dto()));

        await expect(service.create('user-1', dto())).resolves.toEqual(
          asCreated(dto()),
        );
      });

      it('refuses the id when another account took it in between', async () => {
        repository.idIsTaken
          .mockResolvedValueOnce(false)
          .mockResolvedValueOnce(true);

        await expect(service.create('user-1', dto())).rejects.toMatchObject({
          code: 'FINANCIAL_CATEGORY_ID_CONFLICT',
        });
      });

      it('still answers 409 when the name is held by an archived category', async () => {
        await expect(service.create('user-1', dto())).rejects.toMatchObject({
          code: 'FINANCIAL_CATEGORY_DUPLICATED',
          details: undefined,
        });
      });
    });

    it('lets any other database failure rise untouched', async () => {
      const failure = new Error('connection lost');
      repository.create.mockRejectedValue(failure);

      await expect(service.create('user-1', dto())).rejects.toBe(failure);
    });
  });
});
