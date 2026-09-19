import { AppointmentStatus, Species } from '@prisma/client';

import { AppointmentService } from '../../../src/modules/appointment/appointment.service';
import { CreateAppointmentDto } from '../../../src/modules/appointment/dto/create-appointment.dto';
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

describe('AppointmentService', () => {
  let repository: {
    findMany: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  let service: AppointmentService;

  beforeEach(() => {
    repository = {
      findMany: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };
    service = new AppointmentService(repository as never);
  });

  it('creates scheduled records and preserves the status transition field', async () => {
    const dto = Object.assign(new CreateAppointmentDto(), {
      startsAt: new Date('2026-09-19T10:00:00.000Z'),
      status: AppointmentStatus.COMPLETED,
    });
    repository.create.mockResolvedValue(appointment({ status: AppointmentStatus.COMPLETED }));

    const result = await service.create('user-1', dto);

    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', status: AppointmentStatus.COMPLETED }),
    );
    expect(result.status).toBe(AppointmentStatus.COMPLETED);
    expect(result).not.toHaveProperty('userId');
  });

  it('reports another user appointment as not found', async () => {
    repository.findById.mockResolvedValue(null);

    await expect(service.findOne('appointment-1', 'user-2')).rejects.toMatchObject({
      code: 'APPOINTMENT_NOT_FOUND',
    } satisfies Partial<DomainError>);
  });
});