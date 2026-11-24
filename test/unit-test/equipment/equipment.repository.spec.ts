import { EquipmentRepository } from '../../../src/modules/equipment/equipment.repository';
import { periodFromIsoDates } from '../../../src/shared/dates/period';

const OWNED = { id: 'equipment-1', userId: 'user-1', deletedAt: null };

describe('EquipmentRepository', () => {
  let equipment: Record<string, jest.Mock>;
  let supplier: { findFirst: jest.Mock };
  let repository: EquipmentRepository;

  beforeEach(() => {
    equipment = {
      count: jest.fn().mockResolvedValue(1),
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue({ id: OWNED.id }),
      create: jest.fn().mockResolvedValue({ id: OWNED.id }),
      update: jest.fn().mockResolvedValue({ id: OWNED.id }),
    };
    supplier = { findFirst: jest.fn().mockResolvedValue(null) };
    const prisma = {
      equipment,
      supplier,
      $transaction: (work: (tx: unknown) => unknown) => work({ equipment }),
    };
    repository = new EquipmentRepository(prisma as never);
  });

  it('counts what was acquired in the period, active or not', async () => {
    await repository.countAcquiredInPeriod(
      'user-1',
      periodFromIsoDates('2026-10-01', '2026-10-31'),
    );

    expect(equipment.count).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        deletedAt: null,
        acquisitionDate: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lt: new Date('2026-11-01T00:00:00.000Z'),
        },
      },
    });
  });

  it('never lists deleted equipment, whatever the filter', async () => {
    await repository.findMany({ userId: 'user-1', active: true });

    expect(equipment.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', active: true, deletedAt: null },
      orderBy: { name: 'asc' },
    });
  });

  it('finds equipment and active suppliers only for the owner', async () => {
    await repository.findById(OWNED.id, OWNED.userId);
    await repository.findActiveSupplier('user-1', 'supplier-1');

    expect(equipment.findFirst).toHaveBeenCalledWith({ where: OWNED });
    expect(supplier.findFirst).toHaveBeenCalledWith({
      where: { id: 'supplier-1', userId: 'user-1', active: true },
    });
  });

  it('creates equipment', async () => {
    const data = { name: 'Monitor' } as never;

    await repository.create(data);

    expect(equipment.create).toHaveBeenCalledWith({ data });
  });

  it('updates and deactivates after checking the owner', async () => {
    await repository.update(OWNED.id, OWNED.userId, { name: 'New' });
    await repository.deactivate(OWNED.id, OWNED.userId);

    expect(equipment.findFirst).toHaveBeenCalledWith({
      where: OWNED,
      select: { id: true },
    });
    expect(equipment.update).toHaveBeenNthCalledWith(1, {
      where: { id: OWNED.id },
      data: { name: 'New' },
    });
    expect(equipment.update).toHaveBeenNthCalledWith(2, {
      where: { id: OWNED.id },
      data: { active: false },
    });
  });

  it('writes nothing to equipment of someone else', async () => {
    equipment.findFirst.mockResolvedValue(null);

    await expect(
      repository.update(OWNED.id, 'user-2', { name: 'New' }),
    ).resolves.toBeNull();
    await expect(repository.deactivate(OWNED.id, 'user-2')).resolves.toBeNull();
    expect(equipment.update).not.toHaveBeenCalled();
  });
});
