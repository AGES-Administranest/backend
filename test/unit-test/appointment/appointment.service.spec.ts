import { AppointmentStatus, Species } from '@prisma/client';

import { UniqueConstraintError } from '../../../src/infra/prisma/prisma-errors';
import { AppointmentsService } from '../../../src/modules/appointments/appointments.service';
import { CreateAppointmentDto } from '../../../src/modules/appointments/dto/create-appointment.dto';
import { UpdateAppointmentDto } from '../../../src/modules/appointments/dto/update-appointment.dto';
import { DomainError } from '../../../src/shared/errors/domain-error';

const appointment = (overrides: Record<string, unknown> = {}) => ({
  id: 'appointment-1',
  userId: 'user-1',
  clientId: null,
  procedureName: 'Dental cleaning',
  startsAt: new Date('2026-09-19T10:00:00.000Z'),
  endsAt: null,
  location: 'Room 2',
  amount: null,
  patientName: 'Maya',
  ownerName: null,
  species: Species.CANINE,
  patientAgeYears: 4,
  weightKg: null,
  notes: null,
  status: AppointmentStatus.SCHEDULED,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

describe('AppointmentsService', () => {
  let repository: {
    findMany: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let service: AppointmentsService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    service = new AppointmentsService(repository as never);
  });

  it('creates scheduled records by default', async () => {
    const dto = Object.assign(new CreateAppointmentDto(), {
      startsAt: new Date('2026-09-19T10:00:00.000Z'),
    });
    repository.create.mockResolvedValue({
      appointment: appointment(),
      created: true,
    });

    const result = await service.create('user-1', dto);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        status: AppointmentStatus.SCHEDULED,
      }),
      'user-1',
    );
    expect(result.status).toBe(AppointmentStatus.SCHEDULED);
    expect(result).not.toHaveProperty('userId');
  });

  it('preserves an explicitly completed status when an amount is provided', async () => {
    const dto = Object.assign(new CreateAppointmentDto(), {
      startsAt: new Date('2026-09-19T10:00:00.000Z'),
      status: AppointmentStatus.COMPLETED,
      amount: 250,
    });
    repository.create.mockResolvedValue({
      appointment: appointment({
        status: AppointmentStatus.COMPLETED,
        amount: 250,
      }),
      created: true,
    });

    const result = await service.create('user-1', dto);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        status: AppointmentStatus.COMPLETED,
      }),
      'user-1',
    );
    expect(result.status).toBe(AppointmentStatus.COMPLETED);
  });

  it('does not apply the creation status default to partial updates', async () => {
    const dto = Object.assign(new UpdateAppointmentDto(), { amount: 200 });
    repository.findById.mockResolvedValue(
      appointment({ status: AppointmentStatus.COMPLETED, amount: 100 }),
    );
    repository.update.mockResolvedValue(
      appointment({ status: AppointmentStatus.COMPLETED, amount: 200 }),
    );

    await service.update('appointment-1', 'user-1', dto);

    expect(dto.status).toBeUndefined();
    expect(repository.update).toHaveBeenCalledWith(
      'appointment-1',
      'user-1',
      expect.objectContaining({
        status: undefined,
        amount: 200,
      }),
    );
  });

  it('reports another user appointment as not found', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(
      service.findOne('appointment-1', 'user-2'),
    ).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
    } satisfies Partial<DomainError>);
  });

  it('retries a delete that raced a supply correction on the same appointment', async () => {
    // A concurrent edit/removal reversed a supply first: this transaction
    // rolled back on the unique reversed_movement_id, and the retry no longer
    // sees that supply as in effect.
    repository.delete
      .mockRejectedValueOnce(new UniqueConstraintError(['reversedMovementId']))
      .mockResolvedValueOnce(appointment({ deletedAt: new Date() }));

    const result = await service.remove('appointment-1', 'user-1');

    expect(repository.delete).toHaveBeenCalledTimes(2);
    expect(result.id).toBe('appointment-1');
  });
});
