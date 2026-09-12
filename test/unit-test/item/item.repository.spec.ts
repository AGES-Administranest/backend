import { ItemRepository } from '../../../src/modules/item/item.repository';

describe('ItemRepository', () => {
  let prisma: {
    item: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };
  let repository: ItemRepository;

  beforeEach(() => {
    prisma = {
      item: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
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
      ['findById', () => repository.findById('item-1'), 'findUnique'],
      ['create', () => repository.create({ name: 'x' } as never), 'create'],
      ['update', () => repository.update('item-1', { name: 'x' }), 'update'],
    ])('travels on %s too', async (_label, call, method) => {
      await call();

      const [args] = prisma.item[method as 'findUnique'].mock.calls[0] as [
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
