import { Prisma, StockMovementType } from '@prisma/client';

import {
  MOVEMENT_HISTORY_INCLUDE,
  StockMovementsRepository,
} from '../../../src/modules/stock-movements/stock-movements.repository';
import { periodFromIsoDates } from '../../../src/shared/dates/period';

const USER = 'user-1';
const ITEM = 'item-1';
const OLD = new Date('2026-10-01T12:00:00.000Z');
const decimal = (value: number) => new Prisma.Decimal(value);

const client = () => ({
  stockMovement: {
    count: jest.fn().mockResolvedValue(4),
    create: jest.fn().mockResolvedValue({ id: 'movement-1' }),
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    groupBy: jest.fn().mockResolvedValue([]),
  },
  item: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({}),
  },
  itemLot: {
    findFirst: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    create: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
  },
  supplier: { findFirst: jest.fn().mockResolvedValue(null) },
  appointment: { findFirst: jest.fn().mockResolvedValue(null) },
  purchaseOrder: { findFirst: jest.fn().mockResolvedValue(null) },
  $queryRaw: jest.fn().mockResolvedValue([]),
  $transaction: jest.fn(),
});

describe('StockMovementsRepository', () => {
  let prisma: ReturnType<typeof client>;
  let tx: ReturnType<typeof client>;
  let repository: StockMovementsRepository;

  beforeEach(() => {
    prisma = client();
    tx = client();
    prisma.$transaction.mockImplementation(
      (work: (inside: unknown) => unknown) => work(tx),
    );
    repository = new StockMovementsRepository(prisma as never);
  });

  it('counts a period by when the movement happened on the device', async () => {
    const period = periodFromIsoDates('2026-10-01', '2026-10-31');

    await expect(repository.countInPeriod(USER, period)).resolves.toBe(4);
    expect(prisma.stockMovement.count).toHaveBeenCalledWith({
      where: {
        userId: USER,
        deletedAt: null,
        occurredAt: {
          gte: new Date('2026-10-01T03:00:00.000Z'),
          lt: new Date('2026-11-01T03:00:00.000Z'),
        },
      },
    });
  });

  it('creates a movement with its origins joined', async () => {
    const data = { userId: USER } as never;

    await repository.create(data);
    await repository.create(data, tx as never);

    const call = { data, include: MOVEMENT_HISTORY_INCLUDE };
    expect(prisma.stockMovement.create).toHaveBeenCalledTimes(1);
    expect(prisma.stockMovement.create).toHaveBeenCalledWith(call);
    expect(tx.stockMovement.create).toHaveBeenCalledWith(call);
  });

  it('tells whose ids the ledger already holds, whoever owns them', async () => {
    await repository.findOwnersOfIds(['a', 'b']);

    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['a', 'b'] } },
      select: { id: true, userId: true },
    });
  });

  it('pulls the delta by when the server stored the movement', async () => {
    await repository.findCreatedAfter(USER, OLD, 50);

    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith({
      where: { userId: USER, deletedAt: null, createdAt: { gt: OLD } },
      include: MOVEMENT_HISTORY_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 50,
    });
  });

  describe('findCreatedAfterMovement', () => {
    it('answers null when the anchor is not a movement of the user', async () => {
      await expect(
        repository.findCreatedAfterMovement(USER, 'anchor', 10),
      ).resolves.toBeNull();

      expect(prisma.stockMovement.findFirst).toHaveBeenCalledWith({
        where: { id: 'anchor', userId: USER },
        select: { id: true },
      });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('answers an empty page without reading rows back', async () => {
      prisma.stockMovement.findFirst.mockResolvedValue({ id: 'anchor' });

      await expect(
        repository.findCreatedAfterMovement(USER, 'anchor', 10),
      ).resolves.toEqual([]);
      expect(prisma.stockMovement.findMany).not.toHaveBeenCalled();
    });

    it('keeps the order the database answered', async () => {
      prisma.stockMovement.findFirst.mockResolvedValue({ id: 'anchor' });
      prisma.$queryRaw.mockResolvedValue([{ id: 'b' }, { id: 'a' }]);
      prisma.stockMovement.findMany.mockResolvedValue([
        { id: 'a' },
        { id: 'b' },
      ]);

      await expect(
        repository.findCreatedAfterMovement(USER, 'anchor', 10),
      ).resolves.toEqual([{ id: 'b' }, { id: 'a' }]);
    });
  });

  it('reads the cached balances of the items of the user', async () => {
    await repository.findItemBalances(USER, ['a']);

    expect(prisma.item.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER, id: { in: ['a'] } } }),
    );
  });

  it('answers when the item last received stock, or null', async () => {
    await expect(
      repository.latestInboundOccurredAt(USER, ITEM),
    ).resolves.toBeNull();

    tx.stockMovement.findFirst.mockResolvedValue({ occurredAt: OLD });
    await expect(
      repository.latestInboundOccurredAt(USER, ITEM, tx as never),
    ).resolves.toBe(OLD);
    expect(tx.stockMovement.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: USER,
          itemId: ITEM,
          deletedAt: null,
          type: StockMovementType.INBOUND,
        },
        orderBy: { occurredAt: 'desc' },
      }),
    );
  });

  describe('balances', () => {
    const totals = [
      { type: StockMovementType.INBOUND, _sum: { quantity: decimal(10) } },
      { type: StockMovementType.OUTBOUND, _sum: { quantity: decimal(12.5) } },
    ];

    it('is what came in minus what went out, and may be negative', async () => {
      prisma.stockMovement.groupBy.mockResolvedValue(totals);

      const balance = await repository.balanceOf(USER, ITEM);

      expect(balance.toNumber()).toBe(-2.5);
      expect(prisma.stockMovement.groupBy).toHaveBeenCalledWith({
        by: ['type'],
        where: { userId: USER, itemId: ITEM, deletedAt: null },
        _sum: { quantity: true },
      });
    });

    it('is zero for an item without movements or without quantities', async () => {
      expect((await repository.balanceOf(USER, ITEM)).toNumber()).toBe(0);

      const empty = [
        { type: StockMovementType.INBOUND, _sum: { quantity: null } },
      ];
      tx.stockMovement.groupBy.mockResolvedValue(empty);
      prisma.stockMovement.groupBy.mockResolvedValue(empty);
      expect(
        (await repository.balanceOf(USER, ITEM, tx as never)).toNumber(),
      ).toBe(0);
      expect((await repository.balanceBefore(USER, ITEM, OLD)).toNumber()).toBe(
        0,
      );
    });

    it('before a date ignores what happened from that date on', async () => {
      prisma.stockMovement.groupBy.mockResolvedValue(totals);

      const balance = await repository.balanceBefore(USER, ITEM, OLD);

      expect(balance.toNumber()).toBe(-2.5);
      expect(prisma.stockMovement.groupBy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: USER,
            itemId: ITEM,
            deletedAt: null,
            occurredAt: { lt: OLD },
          },
        }),
      );
    });
  });

  it('reads the history of one item oldest first', async () => {
    await repository.findMovementsByItem(USER, ITEM);

    expect(prisma.stockMovement.findMany).toHaveBeenCalledWith({
      where: { userId: USER, itemId: ITEM },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('pages the history newest first and sums all of it', async () => {
    const where = { userId: USER };

    await repository.findHistory(where, 20, 10);
    await repository.findForSummary(where);

    expect(prisma.stockMovement.findMany).toHaveBeenNthCalledWith(1, {
      where,
      include: MOVEMENT_HISTORY_INCLUDE,
      orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
      skip: 20,
      take: 10,
    });
    expect(prisma.stockMovement.findMany).toHaveBeenNthCalledWith(2, {
      where,
      include: MOVEMENT_HISTORY_INCLUDE,
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('finds a live item only for its owner', async () => {
    await repository.findItemById(USER, ITEM);

    expect(prisma.item.findFirst).toHaveBeenCalledWith({
      where: { id: ITEM, userId: USER, deletedAt: null },
    });
  });

  it.each([
    ['supplierExists', 'supplier'],
    ['appointmentExists', 'appointment'],
    ['purchaseOrderExists', 'purchaseOrder'],
  ] as const)('%s only sees live rows of the user', async (method, model) => {
    tx[model].findFirst.mockResolvedValue({ id: 'ref-1' });

    await expect(repository[method](USER, 'ref-1')).resolves.toBe(false);
    await expect(repository[method](USER, 'ref-1', tx as never)).resolves.toBe(
      true,
    );
    expect(prisma[model].findFirst).toHaveBeenCalledWith({
      where: { id: 'ref-1', userId: USER, deletedAt: null },
      select: { id: true },
    });
  });

  it('knows a lot belongs to an item through the item', async () => {
    tx.itemLot.findFirst.mockResolvedValue({ id: 'lot-1' });

    await expect(repository.lotBelongsToItem(ITEM, 'lot-1')).resolves.toBe(
      false,
    );
    await expect(
      repository.lotBelongsToItem(ITEM, 'lot-1', tx as never),
    ).resolves.toBe(true);
    expect(tx.itemLot.findFirst).toHaveBeenCalledWith({
      where: { id: 'lot-1', itemId: ITEM },
      select: { id: true },
    });
  });

  it('lists the lots and opens an empty one', async () => {
    await repository.findLots(ITEM);
    await repository.createEmptyLot(ITEM, {
      unitCost: decimal(3),
      receivedOn: OLD,
    });

    expect(prisma.itemLot.findMany).toHaveBeenCalledWith({
      where: { itemId: ITEM },
    });
    expect(prisma.itemLot.create).toHaveBeenCalledWith({
      data: {
        itemId: ITEM,
        unitCost: decimal(3),
        receivedOn: OLD,
        currentQuantity: 0,
      },
    });
  });

  it.each([
    [StockMovementType.INBOUND, 'increment'],
    [StockMovementType.OUTBOUND, 'decrement'],
  ])('moves the quantity of a lot: %s is an %s', async (type, operation) => {
    await repository.moveLotQuantity('lot-1', type, decimal(2));

    expect(prisma.itemLot.update).toHaveBeenCalledWith({
      where: { id: 'lot-1' },
      data: { currentQuantity: { [operation]: decimal(2) } },
    });
  });

  it('uses the transaction it is given for every write', async () => {
    const inside = tx as never;

    await repository.findOwnersOfIds([], inside);
    await repository.findMovementsByItem(USER, ITEM, inside);
    await repository.findLots(ITEM, inside);
    await repository.createEmptyLot(
      ITEM,
      { unitCost: decimal(1), receivedOn: OLD },
      inside,
    );
    await repository.moveLotQuantity(
      'lot-1',
      StockMovementType.INBOUND,
      decimal(1),
      inside,
    );
    await repository.updateItem(ITEM, { needsAdjustment: true }, inside);

    expect(tx.item.update).toHaveBeenCalledWith({
      where: { id: ITEM },
      data: { needsAdjustment: true },
    });
    for (const model of ['stockMovement', 'item', 'itemLot'] as const) {
      for (const query of Object.values(prisma[model])) {
        expect(query).not.toHaveBeenCalled();
      }
    }
  });

  it('updates an item outside a transaction when none is given', async () => {
    await repository.updateItem(ITEM, { needsAdjustment: false });

    expect(prisma.item.update).toHaveBeenCalledTimes(1);
  });

  it('locks each item once and hands them over by id', async () => {
    tx.$queryRaw.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const work = jest.fn().mockResolvedValue('done');

    await expect(
      repository.withLockedItems(['b', 'a', 'b'], work),
    ).resolves.toBe('done');

    const [template, , ids] = tx.$queryRaw.mock.calls[0] as [
      string[],
      unknown,
      Prisma.Sql,
    ];
    expect(template.join('')).toMatch(/ORDER BY id\s+FOR UPDATE/);
    expect(ids.values).toEqual(['b', 'a']);
    expect(work).toHaveBeenCalledWith(
      tx,
      new Map([
        ['a', { id: 'a' }],
        ['b', { id: 'b' }],
      ]),
    );
  });
});
