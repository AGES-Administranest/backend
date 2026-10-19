import { FuelType, Prisma, Vehicle } from '@prisma/client';

import { VehiclesService } from './vehicles.service';
import { RecordNotFoundError } from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

const vehicle = (overrides: Partial<Vehicle> = {}): Vehicle => ({
  id: 'vehicle-1',
  userId: 'user-1',
  brand: 'Fiat',
  model: 'Strada',
  fuelType: FuelType.GASOLINE,
  avgConsumptionKmL: new Prisma.Decimal('12.5'),
  fuelPrice: new Prisma.Decimal('5.899'),
  active: true,
  createdAt: new Date('2026-10-07T12:00:00Z'),
  updatedAt: new Date('2026-10-07T12:00:00Z'),
  deletedAt: null,
  ...overrides,
});

const notFound = {
  kind: 'NOT_FOUND',
  code: 'VEHICLE_NOT_FOUND',
} satisfies Partial<DomainError>;

describe('VehiclesService', () => {
  let repository: {
    findMany: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    deactivate: jest.Mock;
  };
  let service: VehiclesService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn().mockResolvedValue([vehicle()]),
      findById: jest.fn().mockResolvedValue(vehicle()),
      create: jest.fn().mockResolvedValue(vehicle()),
      update: jest.fn().mockResolvedValue(vehicle()),
      deactivate: jest.fn().mockResolvedValue(vehicle({ active: false })),
    };
    service = new VehiclesService(repository as never);
  });

  describe('every response', () => {
    it.each([
      ['create', () => service.create('user-1', {} as never)],
      [
        'findAll',
        async () => (await service.findAll('user-1', { active: true }))[0],
      ],
      ['findOne', () => service.findOne('vehicle-1', 'user-1')],
      ['update', () => service.update('vehicle-1', 'user-1', {})],
      ['remove', () => service.remove('vehicle-1', 'user-1')],
    ])(
      '%s carries costPerKm and no owner or deletion fields',
      async (_name, call) => {
        const result = await call();

        expect(result.costPerKm).toBe('0.4719');
        expect(result).not.toHaveProperty('userId');
        expect(result).not.toHaveProperty('deletedAt');
      },
    );
  });

  it('creates the vehicle for the token owner', async () => {
    const dto = {
      brand: 'Fiat',
      model: 'Strada',
      fuelType: FuelType.GASOLINE,
      avgConsumptionKmL: 12.5,
      fuelPrice: 5.899,
    };

    await service.create('user-1', dto);

    expect(repository.create).toHaveBeenCalledWith({
      ...dto,
      userId: 'user-1',
    });
  });

  it.each([true, false])('passes active=%s to the listing', async active => {
    await service.findAll('user-1', { active });

    expect(repository.findMany).toHaveBeenCalledWith('user-1', active);
  });

  it('reads an inactive vehicle by id', async () => {
    repository.findById.mockResolvedValue(vehicle({ active: false }));

    await expect(service.findOne('vehicle-1', 'user-1')).resolves.toMatchObject(
      {
        active: false,
      },
    );
  });

  it('reports a vehicle of another user, or a deleted one, as not found', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.findOne('vehicle-1', 'user-2')).rejects.toMatchObject(
      notFound,
    );
  });

  it('recalculates costPerKm from the new fuel price', async () => {
    repository.update.mockResolvedValue(
      vehicle({
        fuelPrice: new Prisma.Decimal('6.29'),
        avgConsumptionKmL: new Prisma.Decimal('10'),
      }),
    );

    const result = await service.update('vehicle-1', 'user-1', {
      fuelPrice: 6.29,
    });

    expect(repository.update).toHaveBeenCalledWith('vehicle-1', 'user-1', {
      fuelPrice: 6.29,
    });
    expect(result.costPerKm).toBe('0.6290');
  });

  it('prices a FLEX vehicle from the informed fuel price', async () => {
    repository.findById.mockResolvedValue(
      vehicle({
        fuelType: FuelType.FLEX,
        fuelPrice: new Prisma.Decimal('4.19'),
        avgConsumptionKmL: new Prisma.Decimal('8.4'),
      }),
    );

    const result = await service.findOne('vehicle-1', 'user-1');

    expect(result.fuelType).toBe(FuelType.FLEX);
    expect(result.costPerKm).toBe('0.4988');
  });

  it('reactivates through PATCH active: true', async () => {
    repository.update.mockResolvedValue(vehicle({ active: true }));

    const result = await service.update('vehicle-1', 'user-1', {
      active: true,
    });

    expect(repository.update).toHaveBeenCalledWith('vehicle-1', 'user-1', {
      active: true,
    });
    expect(result.active).toBe(true);
  });

  it.each([
    [
      'the vehicle is not the owner’s',
      () => repository.update.mockResolvedValue(null),
    ],
    [
      'the row vanishes between the check and the write',
      () => repository.update.mockRejectedValue(new RecordNotFoundError()),
    ],
  ])('update answers not found when %s', async (_label, arrange) => {
    arrange();

    await expect(
      service.update('vehicle-1', 'user-2', { fuelPrice: 6 }),
    ).rejects.toMatchObject(notFound);
  });

  it('DELETE inactivates and answers the whole vehicle', async () => {
    const result = await service.remove('vehicle-1', 'user-1');

    expect(repository.deactivate).toHaveBeenCalledWith('vehicle-1', 'user-1');
    expect(result).toMatchObject({
      id: 'vehicle-1',
      active: false,
      costPerKm: '0.4719',
    });
  });

  it('DELETE on an already inactive vehicle answers the same way', async () => {
    const first = await service.remove('vehicle-1', 'user-1');
    const second = await service.remove('vehicle-1', 'user-1');

    expect(second).toEqual(first);
  });

  it('DELETE on a vehicle of another user is not found', async () => {
    repository.deactivate.mockResolvedValue(null);

    await expect(service.remove('vehicle-1', 'user-2')).rejects.toMatchObject(
      notFound,
    );
  });
});
