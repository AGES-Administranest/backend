import { AppointmentStatus, Prisma } from '@prisma/client';

import {
  InvalidReferenceError,
  RecordNotFoundError,
} from '../../../src/infra/prisma/prisma-errors';
import { AppointmentsService } from '../../../src/modules/appointments/appointments.service';
import { CreateAppointmentDto } from '../../../src/modules/appointments/dto/create-appointment.dto';
import { UpdateAppointmentDto } from '../../../src/modules/appointments/dto/update-appointment.dto';

const USER = 'user-1';
const ID = 'appointment-1';
const KEY = 'client-generated-1';
const STARTS = '2026-10-10T10:00:00.000Z';
const ENDS = '2026-10-10T11:00:00.000Z';

const stored = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  userId: USER,
  clientId: null,
  startsAt: new Date(STARTS),
  endsAt: new Date(ENDS),
  amount: null,
  weightKg: null,
  status: AppointmentStatus.SCHEDULED,
  deletedAt: null,
  ...overrides,
});

const dtoOf = (fields: Partial<CreateAppointmentDto> = {}) =>
  Object.assign(new CreateAppointmentDto(), {
    startsAt: STARTS,
    endsAt: ENDS,
    ...fields,
  });

describe('AppointmentsService scheduling', () => {
  let repository: Record<string, jest.Mock>;
  let service: AppointmentsService;

  beforeEach(() => {
    repository = {
      countInPeriod: jest.fn().mockResolvedValue(3),
      findCompletedPageByClient: jest.fn().mockResolvedValue('page'),
      sumCompletedByClient: jest.fn().mockResolvedValue('client totals'),
      findCompletedInPeriod: jest.fn().mockResolvedValue('completed'),
      sumCompletedGroupedByClient: jest.fn().mockResolvedValue('grouped'),
      findMany: jest.fn().mockResolvedValue([stored()]),
      findById: jest.fn().mockResolvedValue(stored()),
      findByClientGeneratedId: jest.fn().mockResolvedValue(null),
      findConflicting: jest.fn().mockResolvedValue(null),
      create: jest
        .fn()
        .mockResolvedValue({ appointment: stored(), created: true }),
      update: jest.fn().mockResolvedValue(stored()),
      cancel: jest.fn(),
      delete: jest.fn(),
    };
    service = new AppointmentsService(repository as never);
  });

  it('hands the report reads over to the repository', async () => {
    const period = {};

    await expect(service.countInPeriod(USER, period as never)).resolves.toBe(3);
    await expect(
      service.findCompletedByClient(USER, 'client-1', period, 5, 10),
    ).resolves.toBe('page');
    await expect(
      service.sumCompletedByClient(USER, 'client-1', period),
    ).resolves.toBe('client totals');
    await expect(service.findCompletedInPeriod(USER, period)).resolves.toBe(
      'completed',
    );
    await expect(
      service.sumCompletedGroupedByClient(USER, period),
    ).resolves.toBe('grouped');
    expect(repository.findCompletedPageByClient).toHaveBeenCalledWith(
      USER,
      'client-1',
      period,
      5,
      10,
    );
  });

  describe('findAll', () => {
    const whereOf = () =>
      (repository.findMany.mock.calls[0] as [Record<string, unknown>])[0];

    it('pages the appointments of the user without exposing the owner', async () => {
      const [first] = await service.findAll(USER, {
        status: AppointmentStatus.SCHEDULED,
        page: 3,
        pageSize: 20,
      });

      expect(first).not.toHaveProperty('userId');
      expect(whereOf()).toEqual({
        userId: USER,
        status: AppointmentStatus.SCHEDULED,
        deletedAt: null,
      });
      expect(repository.findMany).toHaveBeenCalledWith(
        expect.anything(),
        40,
        20,
      );
    });

    it.each([
      [{ from: new Date(STARTS) }, { gte: new Date(STARTS) }],
      [{ to: new Date(ENDS) }, { lte: new Date(ENDS) }],
      [
        { from: new Date(STARTS), to: new Date(ENDS) },
        { gte: new Date(STARTS), lte: new Date(ENDS) },
      ],
    ])('filters by the start %j', async (range, startsAt) => {
      await service.findAll(USER, {
        status: AppointmentStatus.SCHEDULED,
        page: 1,
        pageSize: 20,
        ...range,
      });

      expect(whereOf()).toMatchObject({ startsAt });
    });
  });

  it('finds one appointment, or reports it as not found', async () => {
    await expect(service.findOne(ID, USER)).resolves.toMatchObject({ id: ID });

    repository.findById.mockResolvedValue(null);
    await expect(service.findOne(ID, USER)).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
    });
  });

  describe('create', () => {
    it('answers a retry with the first record, before the conflict check', async () => {
      repository.findByClientGeneratedId.mockResolvedValue(stored());
      repository.findConflicting.mockResolvedValue(stored());

      await expect(
        service.createWithResult(USER, dtoOf({ clientGeneratedId: KEY })),
      ).resolves.toMatchObject({ created: false, appointment: { id: ID } });

      expect(repository.create).not.toHaveBeenCalled();
    });

    it('refuses a slot already taken', async () => {
      repository.findConflicting.mockResolvedValue(stored({ id: 'other' }));

      await expect(service.create(USER, dtoOf())).rejects.toMatchObject({
        kind: 'CONFLICT',
      });
      expect(repository.create).not.toHaveBeenCalled();
    });

    it('does not check the slot of a completed appointment', async () => {
      repository.findConflicting.mockResolvedValue(stored({ id: 'other' }));

      await service.create(
        USER,
        dtoOf({ status: AppointmentStatus.COMPLETED, amount: 10 }),
      );

      expect(repository.create).toHaveBeenCalledTimes(1);
    });

    it('refuses an interval that ends before it starts', async () => {
      await expect(
        service.create(USER, dtoOf({ startsAt: ENDS, endsAt: STARTS })),
      ).rejects.toMatchObject({ kind: 'INVALID_INPUT' });
    });

    it('requires the amount of a completed appointment', async () => {
      await expect(
        service.create(USER, dtoOf({ status: AppointmentStatus.COMPLETED })),
      ).rejects.toMatchObject({ kind: 'INVALID_INPUT' });
    });

    it('names the reference that does not exist', async () => {
      repository.create.mockRejectedValue(
        new InvalidReferenceError('clientId'),
      );

      await expect(service.create(USER, dtoOf())).rejects.toMatchObject({
        code: 'INVALID_REFERENCE',
        details: { field: 'clientId' },
      });
    });

    it('lets an unknown failure through', async () => {
      repository.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.create(USER, dtoOf())).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('sync', () => {
    it('updates what is already stored and creates the rest, in order', async () => {
      repository.findByClientGeneratedId
        .mockResolvedValueOnce(stored())
        .mockResolvedValue(null);
      repository.update.mockResolvedValue(stored({ id: 'updated' }));

      const results = await service.sync(USER, [
        dtoOf({ clientGeneratedId: KEY }),
        dtoOf({ clientGeneratedId: 'new-key' }),
        dtoOf(),
      ]);

      expect(results.map(result => result.id)).toEqual(['updated', ID, ID]);
      expect(repository.update).toHaveBeenCalledTimes(1);
      expect(repository.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('update', () => {
    const update = (dto: UpdateAppointmentDto) => service.update(ID, USER, dto);

    it('checks the new slot leaving itself out', async () => {
      await update({ startsAt: STARTS });

      expect(repository.findConflicting).toHaveBeenCalledWith(
        USER,
        new Date(STARTS),
        new Date(ENDS),
        ID,
      );
    });

    it('does not check the slot when it did not move', async () => {
      await update({ notes: 'Fasting' });

      expect(repository.findConflicting).not.toHaveBeenCalled();
    });

    it('leaves the stored dates alone when they were not sent', async () => {
      await update({ endsAt: ENDS });

      expect(repository.update).toHaveBeenCalledWith(
        ID,
        USER,
        expect.objectContaining({
          startsAt: undefined,
          endsAt: new Date(ENDS),
        }),
      );
    });

    it('requires an amount to become completed unless one is stored', async () => {
      await expect(
        update({ status: AppointmentStatus.COMPLETED }),
      ).rejects.toMatchObject({ kind: 'INVALID_INPUT' });

      repository.findById.mockResolvedValue(
        stored({ amount: new Prisma.Decimal(10) }),
      );
      await expect(
        update({ status: AppointmentStatus.COMPLETED }),
      ).resolves.toMatchObject({ id: ID });
    });

    it.each([
      ['another user', () => repository.findById.mockResolvedValue(null)],
      [
        'a row deleted meanwhile',
        () => repository.update.mockResolvedValue(null),
      ],
      [
        'a row that vanished mid-write',
        () => repository.update.mockRejectedValue(new RecordNotFoundError()),
      ],
    ])('reports %s as not found', async (_case, arrange) => {
      arrange();

      await expect(update({ notes: 'x' })).rejects.toMatchObject({
        code: 'APPOINTMENT_NOT_FOUND',
      });
    });

    it('names a reference that does not exist and lets the rest through', async () => {
      repository.update.mockRejectedValueOnce(
        new InvalidReferenceError('clientId'),
      );
      await expect(update({ clientId: 'x' })).rejects.toMatchObject({
        details: { field: 'clientId' },
      });

      repository.update.mockRejectedValueOnce(new Error('connection lost'));
      await expect(update({ notes: 'x' })).rejects.toThrow('connection lost');
    });
  });

  it('reports a cancel that lost the row as not found', async () => {
    repository.cancel.mockResolvedValue(null);
    repository.findById
      .mockResolvedValueOnce(stored())
      .mockResolvedValueOnce(null);

    await expect(
      service.cancel(ID, USER, { reason: 'No show' }),
    ).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });
  });

  it('reports the removal of a missing appointment, and any failure as is', async () => {
    repository.delete.mockResolvedValueOnce(null);
    await expect(service.remove(ID, USER)).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
    });

    repository.delete.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.remove(ID, USER)).rejects.toThrow('connection lost');
    expect(repository.delete).toHaveBeenCalledTimes(2);
  });
});
