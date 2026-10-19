import { Supplier } from '@prisma/client';

import { CreateSupplierDto } from '../../../src/modules/supplier/dto/create-supplier.dto';
import { QuerySupplierDto } from '../../../src/modules/supplier/dto/query-supplier.dto';
import { SupplierService } from '../../../src/modules/supplier/supplier.service';
import { DomainError } from '../../../src/shared/errors/domain-error';

const supplier = (overrides: Partial<Supplier> = {}): Supplier => ({
  id: 'supplier-1',
  userId: 'user-1',
  name: 'Distribuidora VetSul',
  taxId: null,
  taxIdType: null,
  contact: null,
  email: null,
  phone: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

const query = (overrides: Partial<QuerySupplierDto> = {}) =>
  Object.assign(new QuerySupplierDto(), {
    active: true,
    page: 1,
    limit: 100,
    ...overrides,
  });

describe('SupplierService', () => {
  let repository: {
    findMany: jest.Mock;
    findByName: jest.Mock;
    create: jest.Mock;
  };
  let service: SupplierService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn(),
      findByName: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    };
    service = new SupplierService(repository as never);
  });

  describe('findAll', () => {
    it("lists the user's suppliers without leaking userId", async () => {
      repository.findMany.mockResolvedValue([supplier()]);

      const result = await service.findAll('user-1', query());

      expect(result).toHaveLength(1);
      expect(result.every(s => !('userId' in s))).toBe(true);
      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', active: true }),
        0,
        100,
      );
    });

    it('ignores a search shorter than 2 characters', async () => {
      repository.findMany.mockResolvedValue([]);

      await service.findAll('user-1', query({ search: 'a' }));

      const [where] = repository.findMany.mock.calls[0] as [
        Record<string, unknown>,
      ];
      expect(where).not.toHaveProperty('name');
    });

    it('escapes % and _ typed into the search', async () => {
      repository.findMany.mockResolvedValue([]);

      await service.findAll('user-1', query({ search: '50%_off' }));

      expect(repository.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          name: { contains: '50\\%\\_off', mode: 'insensitive' },
        }),
        0,
        100,
      );
    });
  });

  describe('findIdByTaxId', () => {
    it('finds the supplier whatever the mask it was typed with', async () => {
      repository.findMany.mockResolvedValue([
        supplier({ id: 'masked', taxId: '11.222.333/0001-81' }),
      ]);

      await expect(
        service.findIdByTaxId('user-1', '11222333000181'),
      ).resolves.toBe('masked');
      expect(repository.findMany).toHaveBeenCalledWith({
        userId: 'user-1',
        active: true,
        deletedAt: null,
        taxId: { not: null },
      });
    });

    it('answers nothing when no supplier has that CNPJ', async () => {
      repository.findMany.mockResolvedValue([
        supplier({ taxId: '11222333000181' }),
      ]);

      await expect(
        service.findIdByTaxId('user-1', '44555666000199'),
      ).resolves.toBeUndefined();
    });
  });

  describe('create', () => {
    const dto = (overrides: Partial<CreateSupplierDto> = {}) =>
      Object.assign(new CreateSupplierDto(), {
        name: 'Distribuidora VetSul',
        ...overrides,
      });

    it('creates the supplier when the name is free', async () => {
      repository.create.mockResolvedValue(supplier());

      const result = await service.create('user-1', dto());

      expect(result.name).toBe('Distribuidora VetSul');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1' }),
      );
    });

    it('refuses a name the user already registered', async () => {
      repository.findByName.mockResolvedValue(supplier());

      await expect(service.create('user-1', dto())).rejects.toBeInstanceOf(
        DomainError,
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });
});
