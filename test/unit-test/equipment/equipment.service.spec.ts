import { Equipment, Prisma } from '@prisma/client';

import { CreateEquipmentDto } from '../../../src/modules/equipment/dto/create-equipment.dto';
import { EquipmentService } from '../../../src/modules/equipment/equipment.service';
import { DomainError } from '../../../src/shared/errors/domain-error';

const { Decimal } = Prisma;

const equipment = (overrides: Partial<Equipment> = {}): Equipment => ({
  id: 'equipment-1',
  userId: 'user-1',
  supplierId: null,
  name: 'Ultrasound machine',
  purchaseValue: new Decimal(25000),
  salvageValue: new Decimal(1000),
  acquisitionDate: new Date('2000-01-01T00:00:00.000Z'),
  usefulLifeMonths: 120,
  notes: null,
  active: true,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  deletedAt: null,
  ...overrides,
});

const expectDomainError = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
};

describe('EquipmentService', () => {
  let repository: {
    findMany: jest.Mock;
    findById: jest.Mock;
    findActiveSupplier: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deactivate: jest.Mock;
  };
  let service: EquipmentService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn().mockResolvedValue([]),
      findById: jest.fn(),
      findActiveSupplier: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      deactivate: jest.fn(),
    };
    service = new EquipmentService(repository as never);
  });

  describe('findAll', () => {
    it('lists active equipment scoped to the authenticated user by default', async () => {
      repository.findMany.mockResolvedValue([equipment()]);

      const result = await service.findAll('user-1', {});

      expect(repository.findMany).toHaveBeenCalledWith({
        userId: 'user-1',
        active: true,
      });
      expect(result).toHaveLength(1);
      expect(result[0]).not.toHaveProperty('userId');
      expect(result[0]).not.toHaveProperty('deletedAt');
    });

    it('lists inactive equipment only when requested', async () => {
      await service.findAll('user-1', { active: false });

      expect(repository.findMany).toHaveBeenCalledWith({
        userId: 'user-1',
        active: false,
      });
    });
  });

  describe('findOne', () => {
    it('returns equipment scoped to its owner', async () => {
      repository.findById.mockResolvedValue(equipment());

      const result = await service.findOne('equipment-1', 'user-1');

      expect(repository.findById).toHaveBeenCalledWith('equipment-1', 'user-1');
      expect(result.id).toBe('equipment-1');
    });

    it('reports foreign or missing equipment as not found', async () => {
      repository.findById.mockResolvedValue(null);

      await expectDomainError(
        service.findOne('equipment-1', 'user-2'),
        'EQUIPMENT_NOT_FOUND',
      );
    });
  });

  describe('create', () => {
    const dto: CreateEquipmentDto = {
      name: 'Ultrasound machine',
      purchaseValue: 25000,
      acquisitionDate: '2000-01-01',
      salvageValue: 1000,
    };

    it('creates equipment for the user and applies the default useful life', async () => {
      repository.create.mockResolvedValue(equipment());

      const result = await service.create('user-1', dto);

      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          name: dto.name,
          purchaseValue: dto.purchaseValue,
          salvageValue: dto.salvageValue,
          usefulLifeMonths: 120,
          acquisitionDate: new Date(dto.acquisitionDate),
        }),
      );
      expect(result.usefulLifeMonths).toBe(120);
    });

    it('rejects a future acquisition date', async () => {
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      await expectDomainError(
        service.create('user-1', { ...dto, acquisitionDate: tomorrow }),
        'EQUIPMENT_ACQUISITION_DATE_IN_FUTURE',
      );
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('rejects salvage value equal to or greater than the purchase value', async () => {
      await expectDomainError(
        service.create('user-1', { ...dto, salvageValue: 25000 }),
        'EQUIPMENT_SALVAGE_VALUE_INVALID',
      );
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('depreciation', () => {
    it('returns straight-line values rounded to cents and capped at salvage value', async () => {
      repository.findById.mockResolvedValue(equipment());

      const result = await service.findOne('equipment-1', 'user-1');

      expect(result.monthlyDepreciation).toBe(200);
      expect(result.accumulatedDepreciation).toBe(24000);
      expect(result.currentBookValue).toBe(1000);
    });

    it('recalculates depreciation after an equipment update', async () => {
      repository.findById.mockResolvedValue(equipment());
      repository.update.mockResolvedValue(
        equipment({
          purchaseValue: new Decimal(13000),
          salvageValue: new Decimal(1000),
          usefulLifeMonths: 60,
        }),
      );

      const result = await service.update('equipment-1', 'user-1', {
        purchaseValue: 13000,
        usefulLifeMonths: 60,
      });

      expect(repository.update).toHaveBeenCalledWith(
        'equipment-1',
        'user-1',
        expect.objectContaining({
          purchaseValue: 13000,
          usefulLifeMonths: 60,
        }),
      );
      expect(result.monthlyDepreciation).toBe(200);
      expect(result.currentBookValue).toBe(1000);
    });
  });

  describe('remove', () => {
    it('deactivates the equipment and returns its calculated fields', async () => {
      repository.deactivate.mockResolvedValue(equipment({ active: false }));

      const result = await service.remove('equipment-1', 'user-1');

      expect(repository.deactivate).toHaveBeenCalledWith(
        'equipment-1',
        'user-1',
      );
      expect(result.active).toBe(false);
      expect(result).toHaveProperty('currentBookValue');
    });

    it('reports foreign or missing equipment as not found', async () => {
      repository.deactivate.mockResolvedValue(null);

      await expectDomainError(
        service.remove('equipment-1', 'user-2'),
        'EQUIPMENT_NOT_FOUND',
      );
    });
  });
});
