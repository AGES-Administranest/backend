import { AppointmentRepository } from '../../../src/modules/appointment/appointment.repository';

describe('AppointmentRepository', () => {
  let prisma: {
    appointment: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repository: AppointmentRepository;

  beforeEach(() => {
    prisma = {
      appointment: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'appointment-1' }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    repository = new AppointmentRepository(prisma as never);
  });

  it('scopes listing to the owner and excludes soft-deleted records', async () => {
    await repository.findMany({ userId: 'user-1', deletedAt: null });

    expect(prisma.appointment.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', deletedAt: null },
      orderBy: { startsAt: 'asc' },
      skip: undefined,
      take: undefined,
    });
  });

  it('checks ownership before updating', async () => {
    await repository.update('appointment-1', 'user-1', { status: 'COMPLETED' });

    expect(prisma.appointment.findFirst).toHaveBeenCalledWith({
      where: { id: 'appointment-1', userId: 'user-1', deletedAt: null },
      select: { id: true },
    });
    expect(prisma.appointment.update).toHaveBeenCalledWith({
      where: { id: 'appointment-1' },
      data: { status: 'COMPLETED' },
    });
  });
});