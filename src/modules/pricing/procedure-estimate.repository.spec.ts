import { ProcedureEstimateRepository } from './procedure-estimate.repository';

describe('ProcedureEstimateRepository', () => {
  let prisma: {
    client: { findFirst: jest.Mock };
    item: { findMany: jest.Mock };
  };
  let repository: ProcedureEstimateRepository;

  beforeEach(() => {
    prisma = {
      client: { findFirst: jest.fn().mockResolvedValue(null) },
      item: { findMany: jest.fn().mockResolvedValue([]) },
    };
    repository = new ProcedureEstimateRepository(prisma as never);
  });

  it('looks the client up scoped to the owner, skipping deleted ones', async () => {
    await repository.clientExists('user-1', 'client-1');

    expect(prisma.client.findFirst).toHaveBeenCalledWith({
      where: { id: 'client-1', userId: 'user-1', deletedAt: null },
      select: { id: true },
    });
  });

  it('tells whether the client exists', async () => {
    expect(await repository.clientExists('user-1', 'client-1')).toBe(false);

    prisma.client.findFirst.mockResolvedValueOnce({ id: 'client-1' });
    expect(await repository.clientExists('user-1', 'client-1')).toBe(true);
  });

  it('reads the unit costs of the owner’s live items', async () => {
    await repository.findItemCosts('user-1', ['item-1', 'item-2']);

    expect(prisma.item.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['item-1', 'item-2'] },
        userId: 'user-1',
        deletedAt: null,
      },
      select: { id: true, defaultUnitCost: true },
    });
  });
});
