import { SupplierRepository } from '../../../src/modules/supplier/supplier.repository';

describe('SupplierRepository', () => {
  let prisma: {
    supplier: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repository: SupplierRepository;

  beforeEach(() => {
    prisma = {
      supplier: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'supplier-1' }),
        update: jest.fn().mockResolvedValue({ id: 'supplier-1' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ id: 'supplier-1', active: false }),
      },
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    repository = new SupplierRepository(prisma as never);
  });

  it('lists only non-deleted rows in the requested order and page', async () => {
    await repository.findMany({ userId: 'user-1', active: true }, 0, 100);

    expect(prisma.supplier.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', active: true, deletedAt: null },
      orderBy: { name: 'asc' },
      skip: 0,
      take: 100,
    });
  });

  it('reads by id scoped to the owner, including inactive suppliers', async () => {
    await repository.findById('supplier-1', 'user-1');

    expect(prisma.supplier.findFirst).toHaveBeenCalledWith({
      where: { id: 'supplier-1', userId: 'user-1', deletedAt: null },
    });
  });

  it('does not update a supplier owned by another user', async () => {
    prisma.supplier.findFirst.mockResolvedValue(null);

    await expect(
      repository.update('supplier-1', 'user-2', { name: 'New name' }),
    ).resolves.toBeNull();
    expect(prisma.supplier.update).not.toHaveBeenCalled();
  });

  it('inactivates without deleting the supplier', async () => {
    await repository.deactivate('supplier-1', 'user-1');

    expect(prisma.supplier.updateMany).toHaveBeenCalledWith({
      where: { id: 'supplier-1', userId: 'user-1', deletedAt: null },
      data: { active: false },
    });
    expect(prisma.supplier.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'supplier-1' },
    });
  });

  it('returns null when the user does not own the supplier to inactivate', async () => {
    prisma.supplier.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.deactivate('supplier-1', 'user-2'),
    ).resolves.toBeNull();
    expect(prisma.supplier.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
