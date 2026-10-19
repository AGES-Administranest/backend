import { AppointmentStatus } from '@prisma/client';

import { AppointmentsRepository } from '../../../src/modules/appointments/appointments.repository';

describe('AppointmentsRepository.cancel', () => {
  const canceled = {
    id: 'appointment-1',
    userId: 'user-1',
    status: AppointmentStatus.CANCELED,
    notes: 'Patient did not attend',
  };

  let prisma: {
    appointment: { updateMany: jest.Mock; findFirst: jest.Mock };
  };
  let repository: AppointmentsRepository;

  beforeEach(() => {
    prisma = {
      appointment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(canceled),
      },
    };
    repository = new AppointmentsRepository(prisma as never);
  });

  it('only moves a SCHEDULED, non-deleted appointment of the owner', async () => {
    const result = await repository.cancel(
      'appointment-1',
      'user-1',
      'Patient did not attend',
    );

    expect(prisma.appointment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'appointment-1',
        userId: 'user-1',
        status: AppointmentStatus.SCHEDULED,
        deletedAt: null,
      },
      data: {
        status: AppointmentStatus.CANCELED,
        notes: 'Patient did not attend',
      },
    });
    expect(result).toEqual(canceled);
    expect(prisma.appointment.findFirst).toHaveBeenCalledTimes(1);
  });

  it('writes nothing else when no SCHEDULED appointment matched', async () => {
    prisma.appointment.updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.cancel(
      'appointment-1',
      'user-1',
      'Patient did not attend',
    );

    expect(result).toBeNull();
    expect(prisma.appointment.findFirst).not.toHaveBeenCalled();
  });
});
