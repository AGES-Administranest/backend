import { Item, ItemCategory, MeasurementUnit, Prisma } from '@prisma/client';

const { Decimal } = Prisma;

import {
  InvalidReferenceError,
  RecordNotFoundError,
} from '../../../src/infra/prisma/prisma-errors';
import { CreateItemDto } from '../../../src/modules/item/dto/create-item.dto';
import { QueryItemDto } from '../../../src/modules/item/dto/query-item.dto';
import { ItemService } from '../../../src/modules/item/item.service';
import { DomainError } from '../../../src/shared/errors/domain-error';

const item = (overrides: Partial<Item> = {}): Item => ({
  id: 'item-1',
  userId: 'user-1',
  supplierId: null,
  category: ItemCategory.MEDICATION,
  unit: MeasurementUnit.AMPOULE,
  name: 'Dipirona injetável',
  defaultUnitCost: new Decimal(10),
  minimumStock: new Decimal(5),
  currentQuantity: new Decimal(0),
  needsAdjustment: false,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

const createDto = (overrides: Partial<CreateItemDto> = {}): CreateItemDto =>
  Object.assign(new CreateItemDto(), {
    userId: 'user-1',
    category: ItemCategory.MEDICATION,
    unit: MeasurementUnit.AMPOULE,
    name: 'Dipirona injetável',
    ...overrides,
  });

describe('ItemService', () => {
  let repository: {
    findMany: jest.Mock;
    findById: jest.Mock;
    findByPresentation: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let service: ItemService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn(),
      findById: jest.fn(),
      findByPresentation: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    service = new ItemService(repository as never);
  });

  describe('findAll', () => {
    const query = (overrides: Partial<QueryItemDto> = {}) =>
      Object.assign(new QueryItemDto(), {
        userId: 'user-1',
        active: true,
        sort: 'name',
        page: 1,
        limit: 20,
        ...overrides,
      });

    it('lista os itens do usuário sem expor userId', async () => {
      repository.findMany.mockResolvedValue([item(), item({ id: 'item-2' })]);

      const result = await service.findAll(query());

      expect(result).toHaveLength(2);
      expect(result.every(i => !('userId' in i))).toBe(true);
      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', active: true }),
        { name: 'asc' },
        0,
        20,
      );
    });

    it('filtra por categorias e busca por nome (ignorando <2 caracteres)', async () => {
      repository.findMany.mockResolvedValue([item()]);

      await service.findAll(
        query({ search: 'a', category: [ItemCategory.MEDICATION] }),
      );

      expect(repository.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          category: { in: [ItemCategory.MEDICATION] },
        }),
        expect.anything(),
        0,
        20,
      );
      const [where] = repository.findMany.mock.calls[0] as [
        Prisma.ItemWhereInput,
      ];
      expect(where).not.toHaveProperty('name');

      await service.findAll(query({ search: 'Dipirona' }));

      expect(repository.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          name: { contains: 'Dipirona', mode: 'insensitive' },
        }),
        expect.anything(),
        0,
        20,
      );
    });

    it('escapa % e _ digitados na busca', async () => {
      repository.findMany.mockResolvedValue([]);

      await service.findAll(query({ search: '50%_off' }));

      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          name: { contains: '50\\%\\_off', mode: 'insensitive' },
        }),
        expect.anything(),
        0,
        20,
      );
    });

    it('só retorna inativos quando active=false é pedido explicitamente', async () => {
      repository.findMany.mockResolvedValue([]);

      await service.findAll(query({ active: false }));

      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ active: false }),
        expect.anything(),
        0,
        20,
      );
    });

    it('calcula o skip a partir da página e usa o sort pedido', async () => {
      repository.findMany.mockResolvedValue([]);

      await service.findAll(
        query({ page: 3, limit: 10, sort: 'currentQuantity' }),
      );

      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ active: true }),
        { currentQuantity: 'asc' },
        20,
        10,
      );
    });
  });

  describe('create', () => {
    it('cria o item quando não há presentação duplicada', async () => {
      repository.findByPresentation.mockResolvedValue(null);
      repository.create.mockResolvedValue(item());

      const result = await service.create(createDto());

      expect(repository.create).toHaveBeenCalled();
      expect(result).not.toHaveProperty('userId');
      expect(result.name).toBe('Dipirona injetável');
    });

    it('rejeita item com nome+unidade já cadastrados para o usuário', async () => {
      repository.findByPresentation.mockResolvedValue(item());

      await expect(service.create(createDto())).rejects.toMatchObject({
        code: 'DUPLICATED_ITEM_PRESENTATION',
      } satisfies Partial<DomainError>);
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('traduz FK inválida (userId/supplierId inexistente) em erro de domínio', async () => {
      repository.findByPresentation.mockResolvedValue(null);
      repository.create.mockRejectedValue(new InvalidReferenceError('userId'));

      await expect(service.create(createDto())).rejects.toMatchObject({
        code: 'INVALID_REFERENCE',
      } satisfies Partial<DomainError>);
    });
  });

  describe('findOne', () => {
    it('lança NOT_FOUND quando o item não existe', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(service.findOne('missing')).rejects.toMatchObject({
        code: 'ITEM_NOT_FOUND',
      } satisfies Partial<DomainError>);
    });

    it('não expõe userId na resposta', async () => {
      repository.findById.mockResolvedValue(item());

      const result = await service.findOne('item-1');

      expect(result).not.toHaveProperty('userId');
    });
  });

  describe('update', () => {
    it('revalida unicidade quando name ou unit mudam', async () => {
      repository.findById.mockResolvedValue(item());
      repository.findByPresentation.mockResolvedValue(
        item({ id: 'other-item' }),
      );

      await expect(
        service.update('item-1', { name: 'Novo nome' }),
      ).rejects.toMatchObject({
        code: 'DUPLICATED_ITEM_PRESENTATION',
      } satisfies Partial<DomainError>);
    });

    it('não revalida unicidade quando name e unit não mudam', async () => {
      repository.findById.mockResolvedValue(item());
      repository.update.mockResolvedValue(
        item({ currentQuantity: new Decimal(3) }),
      );

      await service.update('item-1', { currentQuantity: 3 });

      expect(repository.findByPresentation).not.toHaveBeenCalled();
    });

    it('lança NOT_FOUND quando o item não existe', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.update('missing', { currentQuantity: 1 }),
      ).rejects.toMatchObject({
        code: 'ITEM_NOT_FOUND',
      } satisfies Partial<DomainError>);
    });
  });

  describe('remove', () => {
    it('inativa o item e devolve id+name', async () => {
      repository.delete.mockResolvedValue(item({ active: false }));

      const result = await service.remove('item-1');

      expect(result).toEqual({ id: 'item-1', name: 'Dipirona injetável' });
    });

    it('lança NOT_FOUND quando o item não existe', async () => {
      repository.delete.mockRejectedValue(new RecordNotFoundError());

      await expect(service.remove('missing')).rejects.toMatchObject({
        code: 'ITEM_NOT_FOUND',
      } satisfies Partial<DomainError>);
    });
  });
});
