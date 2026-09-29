import { AppointmentStatus } from '@prisma/client';

import { AppointmentsService } from '../../../src/modules/appointments/appointments.service';
import { CancelAppointmentDto } from '../../../src/modules/appointments/dto/cancel-appointment.dto';
import { DomainError } from '../../../src/shared/errors/domain-error';

const appointment = (overrides: Record<string, unknown> = {}) => ({
  id: 'appointment-1',
  userId: 'user-1',
  clientGeneratedId: null,
  clientId: null,
  procedureName: 'Dental cleaning',
  startsAt: new Date('2026-09-19T10:00:00.000Z'),
  endsAt: new Date('2026-09-19T11:00:00.000Z'),
  location: null,
  amount: null,
  patientName: null,
  ownerName: null,
  species: null,
  patientAgeYears: null,
  weightKg: null,
  notes: null,
  asa: null,
  status: AppointmentStatus.SCHEDULED,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

const dto = (reason = 'Patient did not attend') =>
  Object.assign(new CancelAppointmentDto(), { reason });

describe('AppointmentsService.cancel', () => {
  let repository: { findById: jest.Mock; cancel: jest.Mock };
  let service: AppointmentsService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(appointment()),
      cancel: jest.fn().mockResolvedValue(
        appointment({
          status: AppointmentStatus.CANCELED,
          notes: 'Patient did not attend',
        }),
      ),
    };
    service = new AppointmentsService(repository as never);
  });

  it('cancels a scheduled appointment and stores the reason in notes', async () => {
    const result = await service.cancel('appointment-1', 'user-1', dto());

    expect(repository.cancel).toHaveBeenCalledWith(
      'appointment-1',
      'user-1',
      'Patient did not attend',
    );
    expect(result.status).toBe(AppointmentStatus.CANCELED);
    expect(result.notes).toBe('Patient did not attend');
    expect(result).not.toHaveProperty('userId');
  });

  it('reports an appointment of another user as not found', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(
      service.cancel('appointment-1', 'user-2', dto()),
    ).rejects.toMatchObject({
      kind: 'NOT_FOUND',
      code: 'APPOINTMENT_NOT_FOUND',
    } satisfies Partial<DomainError>);
    expect(repository.cancel).not.toHaveBeenCalled();
  });

  it.each([AppointmentStatus.COMPLETED, AppointmentStatus.CANCELED])(
    'refuses to cancel an appointment that is already %s',
    async status => {
      repository.findById.mockResolvedValue(appointment({ status }));

      await expect(
        service.cancel('appointment-1', 'user-1', dto()),
      ).rejects.toMatchObject({
        kind: 'CONFLICT',
        code: 'APPOINTMENT_NOT_SCHEDULED',
        details: { status },
      } satisfies Partial<DomainError>);
      expect(repository.cancel).not.toHaveBeenCalled();
    },
  );

  it('reports a conflict when a concurrent request changed the status first', async () => {
    repository.cancel.mockResolvedValue(null);
    repository.findById
      .mockResolvedValueOnce(appointment())
      .mockResolvedValueOnce(
        appointment({ status: AppointmentStatus.COMPLETED }),
      );

    await expect(
      service.cancel('appointment-1', 'user-1', dto()),
    ).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_SCHEDULED',
      details: { status: AppointmentStatus.COMPLETED },
    } satisfies Partial<DomainError>);
  });
});
