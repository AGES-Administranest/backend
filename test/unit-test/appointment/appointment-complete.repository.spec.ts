import { AppointmentStatus, Prisma } from '@prisma/client';

import { AppointmentsRepository } from '../../../src/modules/appointments/appointments.repository';

describe('AppointmentsRepository.complete', () => {
  const completed = {
    id: 'appointment-1',
    userId: 'user-1',
    procedureName: 'Dental cleaning',
    startsAt: new Date('2026-09-19T10:00:00.000Z'),
    amount: new Prisma.Decimal(250),
    status: AppointmentStatus.COMPLETED,
  };
  const storedEntry = {
    id: 'financial-entry-1',
    appointmentId: 'appointment-1',
  };

  let prisma: {
    appointment: { updateMany: jest.Mock; findUniqueOrThrow: jest.Mock };
    financialCategory: { findFirst: jest.Mock };
    financialEntry: {
      create: jest.Mock;
      update: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repository: AppointmentsRepository;

  beforeEach(() => {
    prisma = {
      appointment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ ...completed, financialEntry: null }),
      },
      financialCategory: {
        findFirst: jest.fn().mockResolvedValue({ id: 'category-1' }),
      },
      financialEntry: {
        create: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn().mockResolvedValue(storedEntry),
      },
      // The callback gets the same mock as its client.
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    repository = new AppointmentsRepository(prisma as never);
  });

  it('only moves a SCHEDULED, non-deleted appointment of the owner', async () => {
    await repository.complete('appointment-1', 'user-1', 250, {
      patientName: 'Maya',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.appointment.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'appointment-1',
        userId: 'user-1',
        status: AppointmentStatus.SCHEDULED,
        deletedAt: null,
      },
      data: {
        patientName: 'Maya',
        amount: 250,
        status: AppointmentStatus.COMPLETED,
      },
    });
  });

  it('writes nothing else when no SCHEDULED appointment matched', async () => {
    prisma.appointment.updateMany.mockResolvedValue({ count: 0 });

    const result = await repository.complete(
      'appointment-1',
      'user-1',
      250,
      {},
    );

    expect(result).toBeNull();
    expect(prisma.appointment.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(prisma.financialEntry.create).not.toHaveBeenCalled();
    expect(prisma.financialEntry.update).not.toHaveBeenCalled();
  });

  it('posts the revenue entry for the completed appointment', async () => {
    await repository.complete('appointment-1', 'user-1', 250, {});

    expect(prisma.financialEntry.create).toHaveBeenCalledTimes(1);
    const [createCall] = prisma.financialEntry.create.mock.calls as [
      [{ data: Prisma.FinancialEntryUncheckedCreateInput }],
    ];
    expect(createCall[0].data).toMatchObject({
      userId: 'user-1',
      categoryId: 'category-1',
      nature: 'INCOME',
      scope: 'PROFESSIONAL',
      description: 'Dental cleaning',
      amount: new Prisma.Decimal(250),
      accrualDate: completed.startsAt,
      source: 'APPOINTMENT',
      appointmentId: 'appointment-1',
    });
  });

  it('revives a soft-deleted entry instead of inserting a second one', async () => {
    prisma.appointment.findUniqueOrThrow.mockResolvedValue({
      ...completed,
      financialEntry: { id: 'old-entry' },
    });

    await repository.complete('appointment-1', 'user-1', 250, {});

    expect(prisma.financialEntry.create).not.toHaveBeenCalled();
    expect(prisma.financialEntry.update).toHaveBeenCalledWith({
      where: { id: 'old-entry' },
      data: expect.objectContaining({
        deletedAt: null,
        amount: new Prisma.Decimal(250),
      }) as unknown,
    });
  });

  it('returns the appointment without the relation, plus the stored entry', async () => {
    const result = await repository.complete(
      'appointment-1',
      'user-1',
      250,
      {},
    );

    expect(result?.appointment).toEqual(completed);
    expect(result?.appointment).not.toHaveProperty('financialEntry');
    expect(result?.financialEntry).toBe(storedEntry);
    expect(prisma.financialEntry.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { appointmentId: 'appointment-1' },
    });
  });

  it('fails when the revenue category is missing', async () => {
    prisma.financialCategory.findFirst.mockResolvedValue(null);

    await expect(
      repository.complete('appointment-1', 'user-1', 250, {}),
    ).rejects.toThrow('Professional fees category is not seeded');
    expect(prisma.financialEntry.create).not.toHaveBeenCalled();
  });
});
