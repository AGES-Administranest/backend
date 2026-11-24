import {
  AppointmentStatus,
  EntryNature,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import {
  InvalidReferenceError,
  UniqueConstraintError,
} from '../../../src/infra/prisma/prisma-errors';
import { AppointmentsRepository } from '../../../src/modules/appointments/appointments.repository';
import { periodFromIsoDates } from '../../../src/shared/dates/period';

const USER = 'user-1';
const ID = 'appointment-1';
const KEY = 'client-generated-1';
const STARTS = new Date('2026-10-10T10:00:00.000Z');
const ENDS = new Date('2026-10-10T11:00:00.000Z');
const decimal = (value: number) => new Prisma.Decimal(value);

const appointment = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  userId: USER,
  procedureName: 'Anesthesia',
  startsAt: STARTS,
  amount: decimal(250),
  status: AppointmentStatus.COMPLETED,
  ...overrides,
});

const usage = (overrides: Record<string, unknown> = {}) => ({
  clientGeneratedId: KEY,
  itemId: 'item-1',
  lotId: 'lot-1',
  quantity: decimal(2),
  unitCost: decimal(5),
  occurredAt: STARTS,
  ...overrides,
});

describe('AppointmentsRepository', () => {
  let tx: Record<string, Record<string, jest.Mock>> & { $queryRaw?: never };
  let queryRaw: jest.Mock;
  let repository: AppointmentsRepository;

  beforeEach(() => {
    queryRaw = jest
      .fn()
      .mockResolvedValue([{ status: AppointmentStatus.SCHEDULED }]);
    tx = {
      appointment: {
        count: jest.fn().mockResolvedValue(2),
        findFirst: jest.fn().mockResolvedValue(null),
        groupBy: jest.fn(),
        create: jest.fn().mockResolvedValue(appointment()),
        update: jest.fn().mockResolvedValue(appointment()),
      },
      client: { findFirst: jest.fn().mockResolvedValue({ id: 'client-1' }) },
      financialCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: 'category-1' }),
      },
      financialEntry: { create: jest.fn(), update: jest.fn() },
      stockMovement: {
        create: jest.fn(({ data }: { data: object }) =>
          Promise.resolve({ id: 'movement-new', ...data }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      item: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({
          id: 'item-1',
          currentQuantity: decimal(8),
          needsAdjustment: false,
        }),
      },
      itemLot: { update: jest.fn() },
    };
    Object.assign(tx, {
      $queryRaw: queryRaw,
      $transaction: (work: (inside: unknown) => unknown) => work(tx),
    });
    repository = new AppointmentsRepository(tx as never);
  });

  it('counts by the local day the appointment starts on', async () => {
    await repository.countInPeriod(
      USER,
      periodFromIsoDates('2026-10-01', '2026-10-31'),
    );

    expect(tx.appointment.count).toHaveBeenCalledWith({
      where: {
        userId: USER,
        deletedAt: null,
        startsAt: {
          gte: new Date('2026-10-01T03:00:00.000Z'),
          lt: new Date('2026-11-01T03:00:00.000Z'),
        },
      },
    });
  });

  it('looks for the retry of a create only among live rows of the user', async () => {
    await repository.findByClientGeneratedId(KEY, USER);

    expect(tx.appointment.findFirst).toHaveBeenCalledWith({
      where: { clientGeneratedId: KEY, userId: USER, deletedAt: null },
    });
  });

  it('adds up by client, an empty sum being zero', async () => {
    tx.appointment.groupBy.mockResolvedValue([
      {
        clientId: 'client-1',
        _count: { _all: 2 },
        _sum: { amount: decimal(9) },
      },
      { clientId: null, _count: { _all: 1 }, _sum: { amount: null } },
    ]);

    const rows = await repository.sumCompletedGroupedByClient(USER, {});

    expect(
      rows.map(row => [row.clientId, row.count, row.amount.toNumber()]),
    ).toEqual([
      ['client-1', 2, 9],
      [null, 1, 0],
    ]);
  });

  describe('findConflicting', () => {
    const whereOf = () =>
      (tx.appointment.findFirst.mock.calls[0] as [{ where: unknown }])[0].where;
    const overlap = {
      userId: USER,
      status: AppointmentStatus.SCHEDULED,
      deletedAt: null,
      startsAt: { lt: ENDS },
      endsAt: { gt: STARTS },
    };

    it('treats the interval as half-open', async () => {
      await repository.findConflicting(USER, STARTS, ENDS);

      expect(whereOf()).toEqual(overlap);
    });

    it('leaves out the appointment being edited', async () => {
      await repository.findConflicting(USER, STARTS, ENDS, ID);

      expect(whereOf()).toEqual({ ...overlap, id: { not: ID } });
    });
  });

  describe('create', () => {
    const data = {
      userId: USER,
      startsAt: STARTS,
      clientGeneratedId: KEY,
      clientId: 'client-1',
    };

    it('posts the revenue of an appointment created as completed', async () => {
      await expect(repository.create(data, USER)).resolves.toMatchObject({
        created: true,
      });

      expect(tx.financialEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: USER,
          nature: EntryNature.INCOME,
          categoryId: 'category-1',
          amount: decimal(250),
          accrualDate: STARTS,
          appointmentId: ID,
        }) as unknown,
      });
    });

    it('describes the revenue when the procedure has no name', async () => {
      tx.appointment.create.mockResolvedValue(
        appointment({ procedureName: null }),
      );

      await repository.create(data, USER);

      expect(tx.financialEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          description: 'Procedimento',
        }) as unknown,
      });
    });

    it.each([[{ status: AppointmentStatus.SCHEDULED }], [{ amount: null }]])(
      'posts no revenue for %j',
      async overrides => {
        tx.appointment.create.mockResolvedValue(appointment(overrides));

        await repository.create(data, USER);

        expect(tx.financialEntry.create).not.toHaveBeenCalled();
      },
    );

    it('answers the stored row to a retry', async () => {
      tx.appointment.findFirst.mockResolvedValue(appointment());

      await expect(repository.create(data, USER)).resolves.toEqual({
        appointment: appointment(),
        created: false,
      });
      expect(tx.appointment.create).not.toHaveBeenCalled();
    });

    it('answers the winner when two retries race', async () => {
      tx.appointment.create.mockRejectedValue(new UniqueConstraintError([]));
      tx.appointment.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(appointment());

      await expect(repository.create(data, USER)).resolves.toMatchObject({
        created: false,
      });
    });

    it('fails when the collision was not with its own retry', async () => {
      const collision = new UniqueConstraintError([]);
      tx.appointment.create.mockRejectedValue(collision);

      await expect(repository.create(data, USER)).rejects.toBe(collision);
      await expect(
        repository.create({ ...data, clientGeneratedId: undefined }, USER),
      ).rejects.toBe(collision);
    });

    it('refuses the client of someone else', async () => {
      tx.client.findFirst.mockResolvedValue(null);

      await expect(repository.create(data, USER)).rejects.toBeInstanceOf(
        InvalidReferenceError,
      );
      expect(tx.client.findFirst).toHaveBeenCalledWith({
        where: { id: 'client-1', userId: USER, deletedAt: null },
        select: { id: true },
      });
      expect(tx.appointment.create).not.toHaveBeenCalled();
    });

    it('fails when the revenue category is missing', async () => {
      tx.financialCategory.findFirst.mockResolvedValue(null);

      await expect(repository.create(data, USER)).rejects.toThrow('not seeded');
    });
  });

  describe('update', () => {
    const owned = (financialEntry: unknown) =>
      tx.appointment.findFirst.mockResolvedValue({
        ...appointment(),
        financialEntry,
      });

    it('answers null for the appointment of someone else', async () => {
      await expect(repository.update(ID, USER, {})).resolves.toBeNull();
      expect(tx.appointment.update).not.toHaveBeenCalled();
    });

    it('updates the revenue already posted', async () => {
      owned({ id: 'entry-1', deletedAt: null });

      await repository.update(ID, USER, {});

      expect(tx.financialEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: expect.objectContaining({
          amount: decimal(250),
          deletedAt: null,
        }) as unknown,
      });
      expect(tx.financialEntry.create).not.toHaveBeenCalled();
    });

    it('leaves the revenue alone when there is no amount', async () => {
      owned({ id: 'entry-1', deletedAt: null });
      tx.appointment.update.mockResolvedValue(appointment({ amount: null }));

      await repository.update(ID, USER, {});

      expect(tx.financialEntry.update).not.toHaveBeenCalled();
    });

    it('removes the revenue when the appointment is no longer completed', async () => {
      owned({ id: 'entry-1', deletedAt: null });
      tx.appointment.update.mockResolvedValue(
        appointment({ status: AppointmentStatus.SCHEDULED }),
      );

      await repository.update(ID, USER, {});

      expect(tx.financialEntry.update).toHaveBeenCalledWith({
        where: { id: 'entry-1' },
        data: { deletedAt: expect.any(Date) as Date },
      });
    });

    it.each([[null], [{ id: 'entry-1', deletedAt: STARTS }]])(
      'has no revenue to remove when the entry is %j',
      async entry => {
        owned(entry);
        tx.appointment.update.mockResolvedValue(
          appointment({ status: AppointmentStatus.SCHEDULED }),
        );

        await repository.update(ID, USER, {});

        expect(tx.financialEntry.update).not.toHaveBeenCalled();
      },
    );
  });

  describe('supplies', () => {
    it('reads only movements and items of the user', async () => {
      await repository.findMovementsByClientGeneratedIds([KEY], USER);
      await repository.findItemsWithLots(['item-1'], USER);
      await repository.findMovement('movement-1', USER);
      await repository.findActiveSupplies(ID, USER);

      expect(tx.stockMovement.findMany).toHaveBeenNthCalledWith(1, {
        where: { userId: USER, clientGeneratedId: { in: [KEY] } },
      });
      expect(tx.item.findMany).toHaveBeenCalledWith({
        where: { id: { in: ['item-1'] }, userId: USER, deletedAt: null },
        include: { lots: true },
      });
      expect(tx.stockMovement.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'movement-1', userId: USER, deletedAt: null },
        }),
      );
      expect(tx.stockMovement.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          where: {
            appointmentId: ID,
            userId: USER,
            type: StockMovementType.OUTBOUND,
            source: StockMovementSource.APPOINTMENT,
            deletedAt: null,
            reversal: { is: null },
          },
        }),
      );
    });

    it('records each usage with the caches of item and lot', async () => {
      const recorded = await repository.recordItemUsage(USER, ID, [usage()]);

      expect(recorded?.[0].itemBalance.toNumber()).toBe(8);
      expect(recorded?.[0].movement).toMatchObject({
        type: StockMovementType.OUTBOUND,
        source: StockMovementSource.APPOINTMENT,
        appointmentId: ID,
      });
      const change = { currentQuantity: { decrement: decimal(2) } };
      expect(tx.itemLot.update).toHaveBeenCalledWith({
        where: { id: 'lot-1' },
        data: change,
      });
      expect(tx.item.update).toHaveBeenCalledTimes(1);
      expect(tx.item.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: change,
      });
    });

    it('touches no lot when the usage has none', async () => {
      await repository.recordItemUsage(USER, ID, [usage({ lotId: null })]);

      expect(tx.itemLot.update).not.toHaveBeenCalled();
    });

    it.each([
      [false, 2],
      [true, 1],
    ])(
      'flags a negative balance once (already flagged: %s)',
      async (needsAdjustment, updates) => {
        tx.item.update.mockResolvedValue({
          id: 'item-1',
          currentQuantity: decimal(-1),
          needsAdjustment,
        });

        await repository.recordItemUsage(USER, ID, [usage()]);

        expect(tx.item.update).toHaveBeenCalledTimes(updates);
        if (!needsAdjustment) {
          expect(tx.item.update).toHaveBeenLastCalledWith({
            where: { id: 'item-1' },
            data: { needsAdjustment: true },
          });
        }
      },
    );

    const original = {
      id: 'movement-1',
      appointmentId: ID,
      itemId: 'item-1',
      lotId: null,
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.APPOINTMENT,
      quantity: decimal(2),
      unitCost: decimal(5),
      occurredAt: STARTS,
    } as never;

    it.each([
      ['does not exist', []],
      ['was canceled', [{ status: AppointmentStatus.CANCELED }]],
    ])('writes nothing when the appointment %s', async (_case, rows) => {
      queryRaw.mockResolvedValue(rows);

      await expect(
        repository.recordItemUsage(USER, ID, [usage()]),
      ).resolves.toBeNull();
      await expect(
        repository.correctItemUsage(USER, original, null),
      ).resolves.toBeNull();
      expect(tx.stockMovement.create).not.toHaveBeenCalled();
    });

    it('removes a supply by reversing it', async () => {
      const result = await repository.correctItemUsage(USER, original, null);

      expect(result?.movement).toBeNull();
      expect(tx.stockMovement.create).toHaveBeenCalledTimes(1);
      expect(result?.reversal).toMatchObject({
        type: StockMovementType.INBOUND,
        source: StockMovementSource.CORRECTION_REVERSAL,
        reversedMovementId: 'movement-1',
      });
      expect(tx.item.update).toHaveBeenCalledWith({
        where: { id: 'item-1' },
        data: { currentQuantity: { increment: decimal(2) } },
      });
    });

    it('edits a supply by reversing it and recording the new quantity', async () => {
      const result = await repository.correctItemUsage(USER, original, {
        quantity: decimal(3),
        clientGeneratedId: KEY,
      });

      expect(tx.stockMovement.create).toHaveBeenCalledTimes(2);
      expect(result?.movement).toMatchObject({
        quantity: decimal(3),
        clientGeneratedId: KEY,
        replacedMovementId: 'movement-1',
        occurredAt: STARTS,
      });
      expect(tx.item.update).toHaveBeenLastCalledWith({
        where: { id: 'item-1' },
        data: { currentQuantity: { decrement: decimal(3) } },
      });
    });
  });
});
