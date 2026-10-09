import { VehiclesRepository } from './vehicles.repository';

describe('VehiclesRepository', () => {
  let prisma: {
    vehicle: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repository: VehiclesRepository;

  beforeEach(() => {
    prisma = {
      vehicle: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'vehicle-1' }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({ id: 'vehicle-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'vehicle-1', active: false }),
      },
      // Owner-scoped writes run inside a transaction; the callback gets the
      // same mock as its client.
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    repository = new VehiclesRepository(prisma as never);
  });

  it('lists only the owner’s rows with the requested status, never deleted ones', async () => {
    await repository.findMany('user-1', false);

    expect(prisma.vehicle.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', active: false, deletedAt: null },
      orderBy: [{ brand: 'asc' }, { model: 'asc' }],
    });
  });

  it('finds by id scoped to the owner and skipping deleted rows, active or not', async () => {
    await repository.findById('vehicle-1', 'user-1');

    expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
      where: { id: 'vehicle-1', userId: 'user-1', deletedAt: null },
    });
  });

  it('checks ownership before updating, and writes nothing otherwise', async () => {
    prisma.vehicle.findFirst.mockResolvedValue(null);

    await expect(
      repository.update('vehicle-1', 'user-2', { fuelPrice: 6 }),
    ).resolves.toBeNull();
    expect(prisma.vehicle.findFirst).toHaveBeenCalledWith({
      where: { id: 'vehicle-1', userId: 'user-2', deletedAt: null },
      select: { id: true },
    });
    expect(prisma.vehicle.update).not.toHaveBeenCalled();
  });

  it('inactivates without touching deleted_at, scoped to the owner', async () => {
    await repository.deactivate('vehicle-1', 'user-1');

    expect(prisma.vehicle.updateMany).toHaveBeenCalledWith({
      where: { id: 'vehicle-1', userId: 'user-1', deletedAt: null },
      data: { active: false },
    });
  });

  it('answers null when there is nothing of the owner to inactivate', async () => {
    prisma.vehicle.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.deactivate('vehicle-1', 'user-2'),
    ).resolves.toBeNull();
    expect(prisma.vehicle.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
