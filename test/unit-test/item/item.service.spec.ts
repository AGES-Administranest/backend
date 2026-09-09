import { Item, ItemCategory, MeasurementUnit, Prisma } from '@prisma/client';

const { Decimal } = Prisma;

import {
  InvalidReferenceError,
  RecordNotFoundError,
} from '../../../src/infra/prisma/prisma-errors';
import { CreateItemDto } from '../../../src/modules/item/dto/create-item.dto';
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
    it('lista os itens sem expor userId', async () => {
      repository.findMany.mockResolvedValue([item(), item({ id: 'item-2' })]);

      const result = await service.findAll();

      expect(result).toHaveLength(2);
      expect(result.every(i => !('userId' in i))).toBe(true);
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
