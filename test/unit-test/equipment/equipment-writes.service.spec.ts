import { Prisma } from '@prisma/client';

import { InvalidReferenceError } from '../../../src/infra/prisma/prisma-errors';
import { CreateEquipmentDto } from '../../../src/modules/equipment/dto/create-equipment.dto';
import { UpdateEquipmentDto } from '../../../src/modules/equipment/dto/update-equipment.dto';
import { EquipmentService } from '../../../src/modules/equipment/equipment.service';

const USER = 'user-1';
const ID = 'equipment-1';

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  userId: USER,
  supplierId: null,
  name: 'Monitor',
  purchaseValue: new Prisma.Decimal(1000),
  salvageValue: new Prisma.Decimal(100),
  acquisitionDate: new Date('2026-01-01T00:00:00.000Z'),
  usefulLifeMonths: 60,
  notes: null,
  active: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

const dto = (fields: Partial<CreateEquipmentDto> = {}): CreateEquipmentDto => ({
  name: 'Monitor',
  purchaseValue: 1000,
  acquisitionDate: '2026-01-01',
  ...fields,
});

describe('EquipmentService writes', () => {
  let repository: Record<string, jest.Mock>;
  let service: EquipmentService;

  beforeEach(() => {
    repository = {
      countAcquiredInPeriod: jest.fn().mockResolvedValue(2),
      findById: jest.fn().mockResolvedValue(stored()),
      findActiveSupplier: jest.fn().mockResolvedValue({ id: 'supplier-1' }),
      create: jest.fn().mockResolvedValue(stored()),
      update: jest.fn().mockResolvedValue(stored()),
    };
    service = new EquipmentService(repository as never);
  });

  it('counts what the user acquired in the period', async () => {
    const period = {} as never;

    await expect(service.countAcquiredInPeriod(USER, period)).resolves.toBe(2);
    expect(repository.countAcquiredInPeriod).toHaveBeenCalledWith(USER, period);
  });

  it.each([
    [{ purchaseValue: 0 }, 'EQUIPMENT_PURCHASE_VALUE_INVALID'],
    [{ purchaseValue: -1 }, 'EQUIPMENT_PURCHASE_VALUE_INVALID'],
    [{ purchaseValue: NaN }, 'EQUIPMENT_PURCHASE_VALUE_INVALID'],
    [{ salvageValue: -1 }, 'EQUIPMENT_SALVAGE_VALUE_INVALID'],
    [{ salvageValue: 1000 }, 'EQUIPMENT_SALVAGE_VALUE_INVALID'],
    [{ salvageValue: NaN }, 'EQUIPMENT_SALVAGE_VALUE_INVALID'],
    [{ usefulLifeMonths: 0 }, 'EQUIPMENT_USEFUL_LIFE_INVALID'],
    [{ usefulLifeMonths: 1.5 }, 'EQUIPMENT_USEFUL_LIFE_INVALID'],
  ])('refuses %j on create and on update', async (fields, code) => {
    await expect(service.create(USER, dto(fields))).rejects.toMatchObject({
      code,
    });
    await expect(service.update(ID, USER, fields)).rejects.toMatchObject({
      code,
    });
    expect(repository.create).not.toHaveBeenCalled();
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('checks a new salvage value against the stored purchase value', async () => {
    await expect(
      service.update(ID, USER, { salvageValue: 1000 }),
    ).rejects.toMatchObject({ code: 'EQUIPMENT_SALVAGE_VALUE_INVALID' });
  });

  it('refuses a future acquisition date on update', async () => {
    await expect(
      service.update(ID, USER, { acquisitionDate: '2999-01-01' }),
    ).rejects.toMatchObject({ code: 'EQUIPMENT_ACQUISITION_DATE_IN_FUTURE' });
  });

  it('stores the optional fields that were sent', async () => {
    await service.create(
      USER,
      dto({ supplierId: 'supplier-1', notes: 'Used', salvageValue: 10 }),
    );

    expect(repository.findActiveSupplier).toHaveBeenCalledWith(
      USER,
      'supplier-1',
    );
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        supplierId: 'supplier-1',
        notes: 'Used',
        salvageValue: 10,
      }),
    );
  });

  it('refuses the supplier of someone else', async () => {
    repository.findActiveSupplier.mockResolvedValue(null);
    const expected = {
      code: 'INVALID_REFERENCE',
      details: { field: 'supplierId' },
    };

    await expect(
      service.create(USER, dto({ supplierId: 'foreign' })),
    ).rejects.toMatchObject(expected);
    await expect(
      service.update(ID, USER, { supplierId: 'foreign' }),
    ).rejects.toMatchObject(expected);
  });

  it('reports a supplier removed between the check and the write', async () => {
    const removed = new InvalidReferenceError('supplierId');
    repository.create.mockRejectedValue(removed);
    repository.update.mockRejectedValue(removed);

    const expected = { code: 'INVALID_REFERENCE' };
    await expect(service.create(USER, dto())).rejects.toMatchObject(expected);
    await expect(
      service.update(ID, USER, { name: 'New' }),
    ).rejects.toMatchObject(expected);
  });

  it('lets an unknown failure through', async () => {
    const failure = new Error('connection lost');
    repository.create.mockRejectedValue(failure);
    repository.update.mockRejectedValue(failure);

    await expect(service.create(USER, dto())).rejects.toBe(failure);
    await expect(service.update(ID, USER, {})).rejects.toBe(failure);
  });

  it('writes only the fields that were sent, null included', async () => {
    const changes: UpdateEquipmentDto = {
      name: 'New',
      purchaseValue: 2000,
      salvageValue: 0,
      acquisitionDate: '2026-02-01',
      usefulLifeMonths: 12,
      supplierId: null,
      notes: 'Note',
    };

    await service.update(ID, USER, {});
    await service.update(ID, USER, changes);

    expect(repository.update).toHaveBeenNthCalledWith(1, ID, USER, {});
    expect(repository.update).toHaveBeenNthCalledWith(2, ID, USER, {
      ...changes,
      acquisitionDate: new Date('2026-02-01'),
    });
    expect(repository.findActiveSupplier).not.toHaveBeenCalled();
  });

  it('falls back to the default life of equipment stored without one', async () => {
    repository.findById.mockResolvedValue(stored({ usefulLifeMonths: null }));
    repository.update.mockResolvedValue(stored({ usefulLifeMonths: null }));

    const result = await service.update(ID, USER, { name: 'New' });

    expect(result.usefulLifeMonths).toBeGreaterThan(0);
  });

  it('reports equipment of someone else, or deleted meanwhile, as not found', async () => {
    const expected = { code: 'EQUIPMENT_NOT_FOUND' };
    repository.update.mockResolvedValue(null);
    await expect(service.update(ID, USER, {})).rejects.toMatchObject(expected);

    repository.findById.mockResolvedValue(null);
    await expect(service.update(ID, USER, {})).rejects.toMatchObject(expected);
  });
});
