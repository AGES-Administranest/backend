import { Appointment } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { AppointmentsRepository } from './appointments.repository';
import { AppointmentsService } from './appointments.service';
import { DomainError } from '../../shared/errors/domain-error';

const USER_ID = 'user-1';
const OTHER_USER_ID = 'user-2';

function buildAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: randomUUID(),
    userId: USER_ID,
    clientId: null,
    procedureName: 'Consulta de rotina',
    startsAt: new Date('2026-09-25T13:00:00.000Z'),
    endsAt: new Date('2026-09-25T14:00:00.000Z'),
    location: null,
    amount: null,
    patientName: null,
    ownerName: null,
    species: null,
    patientAgeYears: null,
    weightKg: null,
    notes: null,
    status: 'SCHEDULED',
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

/**
 * In-memory stand-in for `AppointmentsRepository`. It replicates the overlap
 * query (`startsAt < endsAt AND endsAt > startsAt`, same user, `SCHEDULED`,
 * not soft-deleted) instead of mocking it, so the tests exercise the actual
 * conflict semantics rather than a canned answer.
 */
class FakeAppointmentsRepository {
  private readonly rows = new Map<string, Appointment>();

  seed(appointment: Appointment): void {
    this.rows.set(appointment.id, appointment);
  }

  findById(id: string, userId: string): Promise<Appointment | null> {
    const row = this.rows.get(id);
    return Promise.resolve(
      row && row.userId === userId && !row.deletedAt ? row : null,
    );
  }

  findConflicting(
    userId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
  ): Promise<Appointment | null> {
    const match = [...this.rows.values()].find(
      row =>
        row.userId === userId &&
        row.status === 'SCHEDULED' &&
        !row.deletedAt &&
        row.id !== excludeId &&
        row.startsAt < endsAt &&
        row.endsAt !== null &&
        row.endsAt > startsAt,
    );
    return Promise.resolve(match ?? null);
  }

  create(
    data: Partial<Appointment> & { userId: string },
  ): Promise<Appointment> {
    const appointment = buildAppointment({ ...data, id: randomUUID() });
    this.rows.set(appointment.id, appointment);
    return Promise.resolve(appointment);
  }

  update(
    id: string,
    userId: string,
    data: Partial<Appointment>,
  ): Promise<Appointment | null> {
    const row = this.rows.get(id);
    if (!row || row.userId !== userId || row.deletedAt) {
      return Promise.resolve(null);
    }
    const updated = { ...row, ...data };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }
}

describe('AppointmentsService — detecção de conflito de horário', () => {
  let repository: FakeAppointmentsRepository;
  let service: AppointmentsService;

  beforeEach(() => {
    repository = new FakeAppointmentsRepository();
    service = new AppointmentsService(
      repository as unknown as AppointmentsRepository,
    );
  });

  const createDto = (startsAt: string, endsAt: string) => ({
    startsAt,
    endsAt,
    procedureName: 'Consulta',
  });

  describe('checkConflict', () => {
    it('finds no conflict against an empty schedule', async () => {
      await expect(
        service.checkConflict(
          USER_ID,
          new Date('2026-09-25T13:00:00.000Z'),
          new Date('2026-09-25T14:00:00.000Z'),
        ),
      ).resolves.toEqual({ conflict: false });
    });

    it('flags an overlapping interval and names the appointment it clashes with', async () => {
      const existing = buildAppointment({
        startsAt: new Date('2026-09-25T13:00:00.000Z'),
        endsAt: new Date('2026-09-25T14:00:00.000Z'),
      });
      repository.seed(existing);

      const result = await service.checkConflict(
        USER_ID,
        new Date('2026-09-25T13:30:00.000Z'),
        new Date('2026-09-25T14:30:00.000Z'),
      );

      expect(result).toEqual({
        conflict: true,
        conflictingAppointment: {
          id: existing.id,
          startsAt: existing.startsAt,
          endsAt: existing.endsAt,
          procedureName: existing.procedureName,
        },
      });
    });

    it('does not flag two appointments that only touch at the boundary', async () => {
      repository.seed(
        buildAppointment({
          startsAt: new Date('2026-09-25T13:00:00.000Z'),
          endsAt: new Date('2026-09-25T14:00:00.000Z'),
        }),
      );

      await expect(
        service.checkConflict(
          USER_ID,
          new Date('2026-09-25T14:00:00.000Z'),
          new Date('2026-09-25T15:00:00.000Z'),
        ),
      ).resolves.toEqual({ conflict: false });
    });

    it('ignores appointments that are not SCHEDULED', async () => {
      repository.seed(
        buildAppointment({
          status: 'CANCELED',
          startsAt: new Date('2026-09-25T13:00:00.000Z'),
          endsAt: new Date('2026-09-25T14:00:00.000Z'),
        }),
      );

      await expect(
        service.checkConflict(
          USER_ID,
          new Date('2026-09-25T13:00:00.000Z'),
          new Date('2026-09-25T14:00:00.000Z'),
        ),
      ).resolves.toEqual({ conflict: false });
    });

    it('ignores another account appointments (ADR-11)', async () => {
      repository.seed(
        buildAppointment({
          userId: OTHER_USER_ID,
          startsAt: new Date('2026-09-25T13:00:00.000Z'),
          endsAt: new Date('2026-09-25T14:00:00.000Z'),
        }),
      );

      await expect(
        service.checkConflict(
          USER_ID,
          new Date('2026-09-25T13:00:00.000Z'),
          new Date('2026-09-25T14:00:00.000Z'),
        ),
      ).resolves.toEqual({ conflict: false });
    });

    it('excludes the appointment being edited from its own check', async () => {
      const existing = buildAppointment({
        startsAt: new Date('2026-09-25T13:00:00.000Z'),
        endsAt: new Date('2026-09-25T14:00:00.000Z'),
      });
      repository.seed(existing);

      await expect(
        service.checkConflict(
          USER_ID,
          new Date('2026-09-25T13:00:00.000Z'),
          new Date('2026-09-25T14:00:00.000Z'),
          existing.id,
        ),
      ).resolves.toEqual({ conflict: false });
    });
  });

  describe('create', () => {
    it('rejects an overlapping appointment with 409 and the clashing appointment', async () => {
      const existing = await service.create(
        USER_ID,
        createDto('2026-09-25T13:00:00.000Z', '2026-09-25T14:00:00.000Z'),
      );

      await expect(
        service.create(
          USER_ID,
          createDto('2026-09-25T13:30:00.000Z', '2026-09-25T14:30:00.000Z'),
        ),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_TIME_CONFLICT',
        kind: 'CONFLICT',
        details: {
          conflict: true,
          conflictingAppointment: { id: existing.id },
        },
      });
    });

    it('allows a back-to-back appointment right after another ends', async () => {
      await service.create(
        USER_ID,
        createDto('2026-09-25T13:00:00.000Z', '2026-09-25T14:00:00.000Z'),
      );

      await expect(
        service.create(
          USER_ID,
          createDto('2026-09-25T14:00:00.000Z', '2026-09-25T15:00:00.000Z'),
        ),
      ).resolves.toMatchObject({ status: 'SCHEDULED' });
    });

    it('rejects an interval where endsAt is not after startsAt', async () => {
      await expect(
        service.create(
          USER_ID,
          createDto('2026-09-25T14:00:00.000Z', '2026-09-25T14:00:00.000Z'),
        ),
      ).rejects.toBeInstanceOf(DomainError);
    });
  });

  describe('update', () => {
    it('rejects moving an appointment into a slot another one already holds', async () => {
      const first = await service.create(
        USER_ID,
        createDto('2026-09-25T13:00:00.000Z', '2026-09-25T14:00:00.000Z'),
      );
      const second = await service.create(
        USER_ID,
        createDto('2026-09-25T15:00:00.000Z', '2026-09-25T16:00:00.000Z'),
      );

      await expect(
        service.update(second.id, USER_ID, {
          startsAt: '2026-09-25T13:30:00.000Z',
          endsAt: '2026-09-25T14:30:00.000Z',
        }),
      ).rejects.toMatchObject({
        code: 'APPOINTMENT_TIME_CONFLICT',
        details: { conflictingAppointment: { id: first.id } },
      });
    });

    it('does not conflict with itself when the interval is left unchanged', async () => {
      const appointment = await service.create(
        USER_ID,
        createDto('2026-09-25T13:00:00.000Z', '2026-09-25T14:00:00.000Z'),
      );

      await expect(
        service.update(appointment.id, USER_ID, {
          procedureName: 'Consulta de retorno',
        }),
      ).resolves.toMatchObject({ procedureName: 'Consulta de retorno' });
    });

    it('answers 404 for an appointment belonging to another account', async () => {
      const appointment = await service.create(
        USER_ID,
        createDto('2026-09-25T13:00:00.000Z', '2026-09-25T14:00:00.000Z'),
      );

      await expect(
        service.update(appointment.id, OTHER_USER_ID, {
          procedureName: 'Renomeado',
        }),
      ).rejects.toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });
    });
  });
});
