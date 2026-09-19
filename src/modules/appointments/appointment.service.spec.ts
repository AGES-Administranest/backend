import { Appointment, AppointmentStatus, Prisma } from '@prisma/client';

const { Decimal } = Prisma;

import { AppointmentService } from './appointment.service';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { DomainError } from '../../shared/errors/domain-error';

const USER = 'user-1';
const OTHER = 'user-2';
const ID = '11111111-1111-4111-8111-111111111111';

const row = (overrides: Partial<Appointment> = {}): Appointment => ({
  id: ID,
  userId: USER,
  clientId: null,
  procedureName: 'Anesthesia',
  startsAt: new Date('2026-09-20T10:00:00.000Z'),
  endsAt: null,
  location: 'Clinic A',
  amount: new Decimal('350.00'),
  patientName: 'Toby',
  ownerName: null,
  species: null,
  patientAgeYears: null,
  weightKg: null,
  notes: null,
  status: AppointmentStatus.SCHEDULED,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...overrides,
});

class FakeAppointmentRepository {
  private readonly rows = new Map<string, Appointment>();

  seed(appointment: Appointment) {
    this.rows.set(appointment.id, { ...appointment });
  }

  findById(id: string, userId: string): Promise<Appointment | null> {
    const appointment = this.rows.get(id);
    if (!appointment || appointment.userId !== userId || appointment.deletedAt)
      return Promise.resolve(null);
    return Promise.resolve({ ...appointment });
  }

  cancelIfScheduled(
    id: string,
    userId: string,
    notes: string,
  ): Promise<Appointment | null> {
    const appointment = this.rows.get(id);
    if (
      !appointment ||
      appointment.userId !== userId ||
      appointment.deletedAt ||
      appointment.status !== AppointmentStatus.SCHEDULED
    ) {
      return Promise.resolve(null);
    }
    const updated: Appointment = {
      ...appointment,
      status: AppointmentStatus.CANCELED,
      notes,
      updatedAt: new Date(),
    };
    this.rows.set(id, updated);
    return Promise.resolve({ ...updated });
  }
}

describe('AppointmentService', () => {
  let repository: FakeAppointmentRepository;
  let service: AppointmentService;

  beforeEach(() => {
    repository = new FakeAppointmentRepository();
    service = new AppointmentService(repository as never);
  });

  const dto = (): CancelAppointmentDto =>
    Object.assign(new CancelAppointmentDto(), {
      reason: 'Patient did not attend',
    });

  it('cancels a scheduled appointment owned by the user and stores the reason in notes', async () => {
    repository.seed(row());

    const result = await service.cancel(ID, USER, dto());

    expect(result.status).toBe(AppointmentStatus.CANCELED);
    expect(result.notes).toBe('Patient did not attend');
    expect(result).not.toHaveProperty('userId');
  });

  it('answers not found when the appointment belongs to another user', async () => {
    repository.seed(row({ userId: OTHER }));

    await expect(service.cancel(ID, USER, dto())).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
      kind: 'NOT_FOUND',
    });
  });

  it('answers not found when the appointment does not exist', async () => {
    await expect(service.cancel(ID, USER, dto())).rejects.toBeInstanceOf(
      DomainError,
    );
    await expect(service.cancel(ID, USER, dto())).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
    });
  });

  it('answers not found when the appointment was deleted', async () => {
    repository.seed(row({ deletedAt: new Date() }));

    await expect(service.cancel(ID, USER, dto())).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
    });
  });

  it.each([AppointmentStatus.COMPLETED, AppointmentStatus.CANCELED])(
    'rejects cancel when status is %s',
    async status => {
      repository.seed(row({ status }));

      await expect(service.cancel(ID, USER, dto())).rejects.toMatchObject({
        code: 'APPOINTMENT_NOT_SCHEDULED',
        kind: 'CONFLICT',
        details: { status },
      });
    },
  );
});
