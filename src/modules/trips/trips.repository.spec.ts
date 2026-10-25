import { Prisma } from '@prisma/client';

import { TripsRepository } from './trips.repository';

describe('TripsRepository', () => {
  let prisma: {
    trip: {
      findMany: jest.Mock;
      count: jest.Mock;
      aggregate: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    vehicle: { findFirst: jest.Mock };
    appointment: { findFirst: jest.Mock };
    client: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let repository: TripsRepository;

  beforeEach(() => {
    prisma = {
      trip: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { distanceKm: null, cost: null } }),
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'trip-1' }),
      },
      vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
      appointment: { findFirst: jest.fn().mockResolvedValue(null) },
      client: { findFirst: jest.fn().mockResolvedValue(null) },
      // Both forms: a callback gets the same mock as its client, and an array
      // of queries resolves each of them.
      $transaction: jest.fn((arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (tx: unknown) => unknown)(prisma)
          : Promise.all(arg as Promise<unknown>[]),
      ),
    };
    repository = new TripsRepository(prisma as never);
  });

  describe('findPage', () => {
    const period = {
      from: new Date('2026-10-01T00:00:00.000Z'),
      to: new Date('2026-10-31T00:00:00.000Z'),
    };
    const where = {
      userId: 'user-1',
      deletedAt: null,
      occurredOn: { gte: period.from, lte: period.to },
    };

    it('pages and totals the owner’s live trips with the same filter', async () => {
      await repository.findPage('user-1', period, 20, 10);

      expect(prisma.trip.findMany).toHaveBeenCalledWith({
        where,
        orderBy: [{ occurredOn: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        skip: 20,
        take: 10,
      });
      expect(prisma.trip.count).toHaveBeenCalledWith({ where });
      expect(prisma.trip.aggregate).toHaveBeenCalledWith({
        where,
        _sum: { distanceKm: true, cost: true },
      });
    });

    it('drops the date filter without a period, and either end on its own', async () => {
      await repository.findPage('user-1', {}, 0, 20);
      await repository.findPage('user-1', { from: period.from }, 0, 20);

      expect(prisma.trip.count).toHaveBeenNthCalledWith(1, {
        where: { userId: 'user-1', deletedAt: null },
      });
      expect(prisma.trip.count).toHaveBeenNthCalledWith(2, {
        where: {
          userId: 'user-1',
          deletedAt: null,
          occurredOn: { gte: period.from },
        },
      });
    });

    it('returns the sums, and zero for a period without trips', async () => {
      prisma.trip.count.mockResolvedValueOnce(3);
      prisma.trip.aggregate.mockResolvedValueOnce({
        _sum: {
          distanceKm: new Prisma.Decimal('42.5'),
          cost: new Prisma.Decimal('80'),
        },
      });

      const filled = await repository.findPage('user-1', {}, 0, 20);
      const empty = await repository.findPage('user-1', {}, 0, 20);

      expect(filled.total).toBe(3);
      expect(filled.totalKm.toString()).toBe('42.5');
      expect(filled.totalCost.toString()).toBe('80');
      expect(empty.totalKm.toString()).toBe('0');
      expect(empty.totalCost.toString()).toBe('0');
    });
  });

  it('finds a trip by id scoped to the owner, skipping deleted ones', async () => {
    await repository.findById('trip-1', 'user-1');

    expect(prisma.trip.findFirst).toHaveBeenCalledWith({
      where: { id: 'trip-1', userId: 'user-1', deletedAt: null },
    });
  });

  it('finds a device id across accounts and deleted trips', async () => {
    await repository.findAnyById('trip-1');

    expect(prisma.trip.findUnique).toHaveBeenCalledWith({
      where: { id: 'trip-1' },
    });
  });

  it.each([
    [
      'vehicle',
      () => repository.findVehicle('vehicle-1', 'user-1'),
      'vehicle-1',
      { active: true, fuelPrice: true, avgConsumptionKmL: true },
    ],
    [
      'appointment',
      () => repository.findAppointment('appointment-1', 'user-1'),
      'appointment-1',
      { clientId: true },
    ],
    [
      'client',
      () => repository.clientExists('client-1', 'user-1'),
      'client-1',
      { id: true },
    ],
  ] as const)(
    'looks a %s up scoped to the owner, skipping deleted ones',
    async (model, call, id, select) => {
      await call();

      expect(prisma[model].findFirst).toHaveBeenCalledWith({
        where: { id, userId: 'user-1', deletedAt: null },
        select,
      });
    },
  );

  it('tells whether the client exists', async () => {
    expect(await repository.clientExists('client-1', 'user-1')).toBe(false);

    prisma.client.findFirst.mockResolvedValueOnce({ id: 'client-1' });
    expect(await repository.clientExists('client-1', 'user-1')).toBe(true);
  });

  it('runs a query on the transaction client it is given', async () => {
    const tx = { trip: { findFirst: jest.fn().mockResolvedValue(null) } };

    await repository.findById('trip-1', 'user-1', tx as never);

    expect(tx.trip.findFirst).toHaveBeenCalled();
    expect(prisma.trip.findFirst).not.toHaveBeenCalled();
  });

  describe('softDelete', () => {
    it('sets deleted_at on the owner’s live trip and returns it', async () => {
      const result = await repository.softDelete('trip-1', 'user-1');

      const [args] = prisma.trip.updateMany.mock.calls[0] as [
        { where: unknown; data: { deletedAt: unknown } },
      ];
      expect(args.where).toEqual({
        id: 'trip-1',
        userId: 'user-1',
        deletedAt: null,
      });
      expect(args.data.deletedAt).toBeInstanceOf(Date);
      expect(result).toEqual({ id: 'trip-1' });
    });

    it('returns null for a trip of another account or already deleted', async () => {
      prisma.trip.updateMany.mockResolvedValueOnce({ count: 0 });

      await expect(
        repository.softDelete('trip-1', 'user-2'),
      ).resolves.toBeNull();
      expect(prisma.trip.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });
});
