import { AppointmentStatus, Prisma, Species } from '@prisma/client';

import { AppointmentsService } from '../../../src/modules/appointments/appointments.service';
import { CompleteAppointmentDto } from '../../../src/modules/appointments/dto/complete-appointment.dto';
import { DomainError } from '../../../src/shared/errors/domain-error';

const appointment = (overrides: Record<string, unknown> = {}) => ({
  id: 'appointment-1',
  userId: 'user-1',
  clientGeneratedId: null,
  clientId: 'client-1',
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

const financialEntry = {
  id: 'financial-entry-1',
  userId: 'user-1',
  appointmentId: 'appointment-1',
  amount: new Prisma.Decimal(250),
  source: 'APPOINTMENT',
};

const dto = (fields: Partial<CompleteAppointmentDto> = {}) =>
  Object.assign(new CompleteAppointmentDto(), fields);

describe('AppointmentsService.complete', () => {
  let repository: { findById: jest.Mock; complete: jest.Mock };
  let service: AppointmentsService;

  beforeEach(() => {
    repository = {
      findById: jest.fn().mockResolvedValue(appointment()),
      complete: jest.fn().mockResolvedValue({
        appointment: appointment({
          status: AppointmentStatus.COMPLETED,
          amount: new Prisma.Decimal(250),
        }),
        financialEntry,
      }),
    };
    service = new AppointmentsService(repository as never);
  });

  it('completes with the amount from the body and hands over the clinical fields', async () => {
    await service.complete(
      'appointment-1',
      'user-1',
      dto({
        amount: 250,
        patientName: 'Maya',
        species: Species.CANINE,
        weightKg: 12.5,
        notes: 'No complications',
        asa: 'ASA I',
      }),
    );

    expect(repository.complete).toHaveBeenCalledWith(
      'appointment-1',
      'user-1',
      250,
      expect.objectContaining({
        patientName: 'Maya',
        species: Species.CANINE,
        weightKg: 12.5,
        notes: 'No complications',
        asa: 'ASA I',
      }),
    );
  });

  it('never forwards the client, the time slot or the status', async () => {
    await service.complete('appointment-1', 'user-1', dto({ amount: 250 }));

    const [, , , data] = repository.complete.mock.calls[0] as [
      string,
      string,
      unknown,
      Record<string, unknown>,
    ];
    expect(data).not.toHaveProperty('clientId');
    expect(data).not.toHaveProperty('startsAt');
    expect(data).not.toHaveProperty('endsAt');
    expect(data).not.toHaveProperty('status');
  });

  it('falls back to the amount already stored on the appointment', async () => {
    const stored = new Prisma.Decimal(180);
    repository.findById.mockResolvedValue(appointment({ amount: stored }));

    await service.complete('appointment-1', 'user-1', dto());

    expect(repository.complete).toHaveBeenCalledWith(
      'appointment-1',
      'user-1',
      stored,
      expect.any(Object),
    );
  });

  it('prefers the amount in the body over the stored one', async () => {
    repository.findById.mockResolvedValue(
      appointment({ amount: new Prisma.Decimal(180) }),
    );

    await service.complete('appointment-1', 'user-1', dto({ amount: 250 }));

    expect(repository.complete).toHaveBeenCalledWith(
      'appointment-1',
      'user-1',
      250,
      expect.any(Object),
    );
  });

  it('answers with the appointment and its revenue entry, without owner ids', async () => {
    const result = await service.complete(
      'appointment-1',
      'user-1',
      dto({ amount: 250 }),
    );

    expect(result.status).toBe(AppointmentStatus.COMPLETED);
    expect(result).not.toHaveProperty('userId');
    expect(result.financialEntry).toMatchObject({
      id: 'financial-entry-1',
      appointmentId: 'appointment-1',
    });
    expect(result.financialEntry).not.toHaveProperty('userId');
  });

  it('reports an appointment of another user as not found', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(
      service.complete('appointment-1', 'user-2', dto({ amount: 250 })),
    ).rejects.toMatchObject({
      kind: 'NOT_FOUND',
      code: 'APPOINTMENT_NOT_FOUND',
    } satisfies Partial<DomainError>);
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it.each([AppointmentStatus.COMPLETED, AppointmentStatus.CANCELED])(
    'refuses to complete an appointment that is already %s',
    async status => {
      repository.findById.mockResolvedValue(appointment({ status }));

      await expect(
        service.complete('appointment-1', 'user-1', dto({ amount: 250 })),
      ).rejects.toMatchObject({
        kind: 'CONFLICT',
        code: 'APPOINTMENT_NOT_SCHEDULED',
        details: { status },
      } satisfies Partial<DomainError>);
      expect(repository.complete).not.toHaveBeenCalled();
    },
  );

  it('requires an amount when neither the body nor the appointment has one', async () => {
    await expect(
      service.complete('appointment-1', 'user-1', dto()),
    ).rejects.toMatchObject({
      kind: 'INVALID_INPUT',
      code: 'INVALID_REQUEST',
    } satisfies Partial<DomainError>);
    expect(repository.complete).not.toHaveBeenCalled();
  });

  it('reports a conflict when a concurrent request changed the status first', async () => {
    repository.complete.mockResolvedValue(null);
    repository.findById
      .mockResolvedValueOnce(appointment())
      .mockResolvedValueOnce(
        appointment({ status: AppointmentStatus.CANCELED }),
      );

    await expect(
      service.complete('appointment-1', 'user-1', dto({ amount: 250 })),
    ).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_SCHEDULED',
      details: { status: AppointmentStatus.CANCELED },
    } satisfies Partial<DomainError>);
  });

  it('reports not found when the appointment was deleted in the meantime', async () => {
    repository.complete.mockResolvedValue(null);
    repository.findById
      .mockResolvedValueOnce(appointment())
      .mockResolvedValueOnce(null);

    await expect(
      service.complete('appointment-1', 'user-1', dto({ amount: 250 })),
    ).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
    } satisfies Partial<DomainError>);
  });
});
