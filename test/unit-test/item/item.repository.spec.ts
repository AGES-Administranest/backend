import { ItemRepository } from '../../../src/modules/item/item.repository';

describe('ItemRepository', () => {
  let prisma: {
    item: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let repository: ItemRepository;

  beforeEach(() => {
    prisma = {
      item: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue({ id: 'item-1' }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      // Owner-scoped writes run inside a transaction; the callback gets the
      // same mock as its client.
      $transaction: jest.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
    };
    repository = new ItemRepository(prisma as never);
  });

  describe('nearest lot', () => {
    it('asks only for the first lot still holding stock, earliest first', async () => {
      await repository.findMany();

      const [args] = prisma.item.findMany.mock.calls[0] as [
        { include: Record<string, unknown> },
      ];

      expect(args.include).toEqual({
        lots: {
          where: {
            expirationDate: { not: null },
            currentQuantity: { gt: 0 },
          },
          orderBy: { expirationDate: 'asc' },
          take: 1,
          select: { expirationDate: true },
        },
      });
    });

    it.each([
      ['findById', () => repository.findById('item-1', 'user-1'), 'findFirst'],
      ['create', () => repository.create({ name: 'x' } as never), 'create'],
      [
        'update',
        () => repository.update('item-1', 'user-1', { name: 'x' }),
        'update',
      ],
    ])('travels on %s too', async (_label, call, method) => {
      await call();

      const [args] = prisma.item[method as 'findFirst'].mock.calls[0] as [
        { include?: unknown },
      ];

      expect(args.include).toBeDefined();
    });

    it('keeps paging and ordering arguments untouched', async () => {
      await repository.findMany({ userId: 'user-1' }, { name: 'asc' }, 20, 10);

      const [args] = prisma.item.findMany.mock.calls[0] as [
        Record<string, unknown>,
      ];

      expect(args).toMatchObject({
        where: { userId: 'user-1' },
        orderBy: { name: 'asc' },
        skip: 20,
        take: 10,
      });
    });
  });
});
