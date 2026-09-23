import { AppointmentStatus, Prisma } from '@prisma/client';

import { AppointmentsRepository } from '../../../src/modules/appointments/appointments.repository';

describe('AppointmentsRepository', () => {
  let prisma: {
    appointment: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    client: { findFirst: jest.Mock };
    financialCategory: { findFirst: jest.Mock };
    financialEntry: { create: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let repository: AppointmentsRepository;

  beforeEach(() => {
    const storedAppointment = {
      id: 'appointment-1',
      userId: 'user-1',
      procedureName: 'Dental cleaning',
      startsAt: new Date('2026-09-19T10:00:00.000Z'),
      amount: new Prisma.Decimal(250),
      status: AppointmentStatus.SCHEDULED,
      financialEntry: null,
    };
    prisma = {
      appointment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(storedAppointment),
        create: jest.fn().mockResolvedValue(storedAppointment),
        update: jest.fn().mockImplementation(
          ({ data }: { data: Prisma.AppointmentUncheckedUpdateInput }) =>
            Promise.resolve({ ...storedAppointment, ...data }),
        ),
      },
      client: { findFirst: jest.fn() },
      financialCategory: { findFirst: jest.fn().mockResolvedValue({ id: 'category-1' }) },
      financialEntry: {
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    repository = new AppointmentsRepository(prisma as never);
  });

  it('scopes listing to the owner and excludes soft-deleted records', async () => {
    await repository.findMany({ userId: 'user-1', deletedAt: null }, 0, 20);

    expect(prisma.appointment.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null },
      orderBy: { startsAt: 'asc' },
      skip: 0,
      take: 20,
    });
  });

  it('checks ownership before updating', async () => {
    await repository.update('appointment-1', 'user-1', {
      status: AppointmentStatus.SCHEDULED,
    });

    expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
      where: { id: 'appointment-1', userId: 'user-1', deletedAt: null },
      include: { financialEntry: true },
    });
    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appointment-1' },
      data: { status: AppointmentStatus.SCHEDULED },
    });
  });

  it('creates the financial entry when an appointment is completed', async () => {
    await repository.update('appointment-1', 'user-1', {
      status: AppointmentStatus.COMPLETED,
    });

    expect(prisma.financialEntry.create).toHaveBeenCalledTimes(1);
    const [createCall] = prisma.financialEntry.create.mock.calls as [
      [{ data: Prisma.FinancialEntryUncheckedCreateInput }],
    ];

    expect(createCall[0].data).toMatchObject({
      userId: 'user-1',
      categoryId: 'category-1',
      amount: new Prisma.Decimal(250),
      source: 'APPOINTMENT',
      appointmentId: 'appointment-1',
    });
  });
});