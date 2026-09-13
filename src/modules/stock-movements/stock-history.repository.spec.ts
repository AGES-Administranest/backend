import { Prisma, StockMovementSource, StockMovementType } from '@prisma/client';

import {
  buildHistoryWhere,
  StockHistoryRepository,
} from './stock-history.repository';

const USER_ID = 'user-1';
const ITEM_ID = 'item-1';

describe('buildHistoryWhere', () => {
  it('always scopes by user and excludes soft-deleted rows, and nothing else', () => {
    // toStrictEqual: an `itemId: undefined` key would be a different object.
    expect(buildHistoryWhere(USER_ID, {})).toStrictEqual({
      userId: USER_ID,
      deletedAt: null,
    });
  });

  it('adds item, direction and origin only when given', () => {
    expect(
      buildHistoryWhere(USER_ID, {
        itemId: ITEM_ID,
        type: StockMovementType.OUTBOUND,
        source: StockMovementSource.APPOINTMENT,
      }),
    ).toStrictEqual({
      userId: USER_ID,
      deletedAt: null,
      itemId: ITEM_ID,
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.APPOINTMENT,
    });
  });

  it('bounds occurredAt with only the ends that were given', () => {
    const from = new Date('2026-09-01T00:00:00.000Z');
    const to = new Date('2026-09-30T23:59:59.999Z');

    expect(buildHistoryWhere(USER_ID, { from }).occurredAt).toStrictEqual({
      gte: from,
    });
    expect(buildHistoryWhere(USER_ID, { to }).occurredAt).toStrictEqual({
      lte: to,
    });
    expect(buildHistoryWhere(USER_ID, { from, to }).occurredAt).toStrictEqual({
      gte: from,
      lte: to,
    });
  });
});

describe('StockHistoryRepository', () => {
  let prisma: {
    stockMovement: {
      findMany: jest.Mock;
      count: jest.Mock;
      groupBy: jest.Mock;
    };
  };
  let repository: StockHistoryRepository;

  beforeEach(() => {
    prisma = {
      stockMovement: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    repository = new StockHistoryRepository(prisma as never);
  });

  it('turns page 3 of 20 into skip 40 / take 20, newest first with id as tiebreak', async () => {
    await repository.findPage(USER_ID, {}, { page: 3, limit: 20 });

    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 40,
        take: 20,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      }),
    );
  });

  it('counts with exactly the same where as the page', async () => {
    const filter = { itemId: ITEM_ID, type: StockMovementType.INBOUND };

    await repository.findPage(USER_ID, filter, { page: 1, limit: 20 });
    await repository.count(USER_ID, filter);

    const [pageArgs] = prisma.stockMovement.findMany.mock.calls[0] as [
      { where: unknown },
    ];
    const [countArgs] = prisma.stockMovement.count.mock.calls[0] as [
      { where: unknown },
    ];
    expect(countArgs.where).toStrictEqual(pageArgs.where);
  });

  describe('sumQuantityByTypeBefore', () => {
    it('maps the grouped sums to inbound/outbound, null for a missing direction', async () => {
      prisma.stockMovement.groupBy.mockResolvedValue([
        {
          type: StockMovementType.INBOUND,
          _sum: { quantity: new Prisma.Decimal(10) },
        },
      ]);

      const sums = await repository.sumQuantityByTypeBefore(
        USER_ID,
        ITEM_ID,
        new Date('2026-09-01T00:00:00.000Z'),
      );

      expect(sums.inbound?.toFixed()).toBe('10');
      expect(sums.outbound).toBeNull();
    });

    it('only looks at the user, the item, live rows and dates strictly before the period', async () => {
      const before = new Date('2026-09-01T00:00:00.000Z');

      await repository.sumQuantityByTypeBefore(USER_ID, ITEM_ID, before);

      expect(prisma.stockMovement.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          by: ['type'],
          where: {
            userId: USER_ID,
            itemId: ITEM_ID,
            deletedAt: null,
            occurredAt: { lt: before },
          },
          _sum: { quantity: true },
        }),
      );
    });
  });
});
