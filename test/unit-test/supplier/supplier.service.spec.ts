import { Supplier, TaxIdType } from '@prisma/client';

import {
  RecordNotFoundError,
  UniqueConstraintError,
} from '../../../src/infra/prisma/prisma-errors';
import { CreateSupplierDto } from '../../../src/modules/supplier/dto/create-supplier.dto';
import { QuerySupplierDto } from '../../../src/modules/supplier/dto/query-supplier.dto';
import { UpdateSupplierDto } from '../../../src/modules/supplier/dto/update-supplier.dto';
import { SupplierService } from '../../../src/modules/supplier/supplier.service';

const supplier = (overrides: Partial<Supplier> = {}): Supplier => ({
  id: 'supplier-1',
  userId: 'user-1',
  name: 'Distribuidora VetSul',
  taxId: null,
  taxIdType: null,
  contact: null,
  email: null,
  phone: null,
  notes: null,
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
    findById: jest.Mock;
    isActiveAndOwned: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deactivate: jest.Mock;
  };
  let service: SupplierService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn(),
      findById: jest.fn(),
      isActiveAndOwned: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
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

  describe('isActiveAndOwned', () => {
    it('checks that a supplier is active and belongs to the user', async () => {
      repository.isActiveAndOwned.mockResolvedValue(true);

      await expect(
        service.isActiveAndOwned('user-1', 'supplier-1'),
      ).resolves.toBe(true);
      expect(repository.isActiveAndOwned).toHaveBeenCalledWith(
        'user-1',
        'supplier-1',
      );
    });
  });

  describe('create', () => {
    const dto = (overrides: Partial<CreateSupplierDto> = {}) =>
      Object.assign(new CreateSupplierDto(), {
        name: 'Distribuidora VetSul',
        ...overrides,
      });

    it('allows repeated names and stores the CNPJ unmasked', async () => {
      repository.create.mockResolvedValue(
        supplier({ taxId: '11222333000181', notes: 'Order monthly' }),
      );

      const result = await service.create(
        'user-1',
        dto({
          taxId: '11.222.333/0001-81',
          taxIdType: TaxIdType.CNPJ,
          notes: 'Order monthly',
        }),
      );

      expect(result.name).toBe('Distribuidora VetSul');
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          taxId: '11222333000181',
          taxIdType: TaxIdType.CNPJ,
          notes: 'Order monthly',
        }),
      );
    });

    it('maps a duplicate CNPJ to the supplier tax id error', async () => {
      repository.create.mockRejectedValue(
        new UniqueConstraintError(['supplier_user_id_tax_id_key']),
      );

      await expect(
        service.create(
          'user-1',
          dto({ taxId: '11222333000181', taxIdType: TaxIdType.CNPJ }),
        ),
      ).rejects.toMatchObject({ code: 'DUPLICATED_SUPPLIER_TAX_ID' });
    });
  });

  describe('findOne', () => {
    it('returns inactive suppliers and sanitizes owner fields', async () => {
      repository.findById.mockResolvedValue(
        supplier({ active: false, notes: 'Call before delivery' }),
      );

      const result = await service.findOne('supplier-1', 'user-1');

      expect(result).toMatchObject({
        id: 'supplier-1',
        active: false,
        notes: 'Call before delivery',
      });
      expect(result).not.toHaveProperty('userId');
      expect(result).not.toHaveProperty('deletedAt');
      expect(repository.findById).toHaveBeenCalledWith('supplier-1', 'user-1');
    });

    it('reports a supplier owned by someone else as not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expect(
        service.findOne('supplier-1', 'user-2'),
      ).rejects.toMatchObject({
        code: 'SUPPLIER_NOT_FOUND',
        kind: 'NOT_FOUND',
      });
    });
  });

  describe('update', () => {
    it('normalizes the CNPJ and passes notes through', async () => {
      const dto = Object.assign(new UpdateSupplierDto(), {
        taxId: '11.222.333/0001-81',
        taxIdType: TaxIdType.CNPJ,
        notes: 'Call before delivery',
      });
      repository.update.mockResolvedValue(
        supplier({
          taxId: '11222333000181',
          taxIdType: TaxIdType.CNPJ,
          notes: dto.notes,
        }),
      );

      const result = await service.update('supplier-1', 'user-1', dto);

      expect(repository.update).toHaveBeenCalledWith('supplier-1', 'user-1', {
        ...dto,
        taxId: '11222333000181',
      });
      expect(result.notes).toBe('Call before delivery');
    });

    it('maps missing and cross-owner suppliers to not found', async () => {
      repository.update.mockResolvedValue(null);

      await expect(
        service.update('supplier-1', 'user-2', {
          name: 'New name',
        }),
      ).rejects.toMatchObject({
        code: 'SUPPLIER_NOT_FOUND',
        kind: 'NOT_FOUND',
      });
    });

    it('maps a row disappearing before update to not found', async () => {
      repository.update.mockRejectedValue(new RecordNotFoundError());

      await expect(
        service.update('supplier-1', 'user-1', { name: 'New name' }),
      ).rejects.toMatchObject({
        code: 'SUPPLIER_NOT_FOUND',
        kind: 'NOT_FOUND',
      });
    });

    it('maps duplicate CNPJ on update', async () => {
      repository.update.mockRejectedValue(
        new UniqueConstraintError(['supplier_user_id_tax_id_key']),
      );

      await expect(
        service.update('supplier-1', 'user-1', {
          taxId: '11222333000181',
          taxIdType: TaxIdType.CNPJ,
        }),
      ).rejects.toMatchObject({ code: 'DUPLICATED_SUPPLIER_TAX_ID' });
    });
  });

  describe('remove', () => {
    it('returns the supplier inactivated by the repository', async () => {
      repository.deactivate.mockResolvedValue(supplier({ active: false }));

      await expect(
        service.remove('supplier-1', 'user-1'),
      ).resolves.toMatchObject({ id: 'supplier-1', active: false });
    });

    it('reports a missing or another user supplier as not found', async () => {
      repository.deactivate.mockResolvedValue(null);

      await expect(
        service.remove('supplier-1', 'user-2'),
      ).rejects.toMatchObject({
        code: 'SUPPLIER_NOT_FOUND',
        kind: 'NOT_FOUND',
      });
    });
  });
});
