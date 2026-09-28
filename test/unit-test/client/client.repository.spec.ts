import { ClientRepository } from '../../../src/modules/client/client.repository';

describe('ClientRepository', () => {
  let prisma: {
    client: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repository: ClientRepository;

  beforeEach(() => {
    prisma = {
      client: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'client-1' }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({ id: 'client-1' }),
      },
      // Owner-scoped writes run inside a transaction; the callback gets the
      // same mock as its client.
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    repository = new ClientRepository(prisma as never);
  });

  describe('reads', () => {
    it('never lists deleted clients', async () => {
      await repository.findMany({ userId: 'user-1', type: 'CLINIC' });

      expect(prisma.client.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', type: 'CLINIC', deletedAt: null },
        orderBy: { name: 'asc' },
      });
    });

    it('does not let the caller override the deletedAt filter', async () => {
      await repository.findMany({ userId: 'user-1', deletedAt: { not: null } });

      const [args] = prisma.client.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where.deletedAt).toBeNull();
    });

    it('finds by id scoped to the owner and skipping deleted clients', async () => {
      await repository.findById('client-1', 'user-1');

      expect(prisma.client.findFirst).toHaveBeenCalledWith({
        where: { id: 'client-1', userId: 'user-1', deletedAt: null },
      });
    });

    it('ignores deleted clients when checking for a duplicated name', async () => {
      await repository.findByName('user-1', 'Clínica');

      const [args] = prisma.client.findFirst.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toMatchObject({
        userId: 'user-1',
        name: 'Clínica',
        deletedAt: null,
      });
    });
  });

  describe('update', () => {
    it('checks ownership and writes inside one transaction', async () => {
      await repository.update('client-1', 'user-1', { city: 'Canoas' });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.client.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'client-1', userId: 'user-1', deletedAt: null },
        }),
      );
      expect(prisma.client.update).toHaveBeenCalledWith({
        where: { id: 'client-1' },
        data: { city: 'Canoas' },
      });
    });

    it('returns null without writing when the client is not the owner’s', async () => {
      prisma.client.findFirst.mockResolvedValue(null);

      const result = await repository.update('client-1', 'user-2', {
        city: 'Canoas',
      });

      expect(result).toBeNull();
      expect(prisma.client.update).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('soft deletes: deactivates and stamps deletedAt', async () => {
      await repository.delete('client-1', 'user-1');

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      const [args] = prisma.client.update.mock.calls[0] as [
        { where: unknown; data: { active: boolean; deletedAt: unknown } },
      ];
      expect(args.where).toEqual({ id: 'client-1' });
      expect(args.data.active).toBe(false);
      expect(args.data.deletedAt).toBeInstanceOf(Date);
    });

    it('returns null without writing when the client is missing or already deleted', async () => {
      prisma.client.findFirst.mockResolvedValue(null);

      const result = await repository.delete('client-1', 'user-1');

      expect(result).toBeNull();
      expect(prisma.client.update).not.toHaveBeenCalled();
    });
  });
});
