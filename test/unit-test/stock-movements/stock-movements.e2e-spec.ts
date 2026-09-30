import { INestApplication } from '@nestjs/common';
import { StockMovementSource, StockMovementType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

import { PrismaService } from '../../../src/infra/prisma/prisma.service';
import {
  StockMovementEntity,
  StockMovementResultEntity,
  StockMovementsService,
  StockSummaryEntity,
  StockSyncPullEntity,
  StockSyncPushEntity,
} from '../../../src/modules/stock-movements';
import {
  bearer,
  createTestApp,
  mintTokens,
  TestUser,
} from '../../helpers/test-app';

/**
 * The parts of the ledger a fake repository cannot prove: the row lock, the
 * transaction boundary, and the fact that the balance and the history still
 * agree after real concurrent writes.
 */
describe('Stock ledger against a real Postgres (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let stockMovements: StockMovementsService;
  let userId: string;
  let itemId: string;
  let secondItemId: string;

  const owner: TestUser = {
    cognitoSub: `e2e-stock-${randomUUID()}`,
    email: `e2e-stock-${randomUUID()}@example.com`,
    name: 'E2E Stock Tester',
  };

  const server = () => app.getHttpServer();
  const auth = () => bearer(owner);

  const createItem = async (name: string): Promise<string> => {
    const response = await request(server())
      .post('/item')
      .set('Authorization', auth())
      .send({ category: 'MEDICATION', unit: 'AMPOULE', name })
      .expect(201);
    return (response.body as { id: string }).id;
  };

  /** Balance summed from the ledger itself — the number the cache must match. */
  const ledgerBalance = async (id: string): Promise<number> => {
    const movements = await prisma.stockMovement.findMany({
      where: { userId, itemId: id, deletedAt: null },
    });
    return movements.reduce(
      (total, movement) =>
        movement.type === StockMovementType.INBOUND
          ? total + movement.quantity.toNumber()
          : total - movement.quantity.toNumber(),
      0,
    );
  };

  const cachedBalance = async (id: string): Promise<number> => {
    const item = await prisma.item.findUniqueOrThrow({ where: { id } });
    return item.currentQuantity.toNumber();
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    stockMovements = app.get(StockMovementsService);
    await mintTokens([owner]);

    // The mirror and the items are created through the API, so the id the
    // ledger is scoped by is the one the guard resolves from the token.
    const session = await request(server())
      .post('/auth/session')
      .set('Authorization', auth())
      .expect(200);
    userId = (session.body as { id: string }).id;

    itemId = await createItem(`Propofol e2e ${randomUUID()}`);
    secondItemId = await createItem(`Midazolam e2e ${randomUUID()}`);
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { userId } });
    await prisma.item.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  describe('concurrency', () => {
    it('does not lose an outbound under concurrent writes to the same item', async () => {
      await request(server())
        .post('/stock-movement/purchase')
        .set('Authorization', auth())
        .send({
          itemId,
          quantity: 1000,
          unitValue: 10,
          date: new Date().toISOString(),
        })
        .expect(201);

      const concurrentOutbounds = 25;
      await Promise.all(
        Array.from({ length: concurrentOutbounds }, () =>
          stockMovements.record(userId, {
            itemId,
            type: StockMovementType.OUTBOUND,
            source: StockMovementSource.MANUAL_ADJUSTMENT,
            adjustmentReason: 'BREAKAGE',
            quantity: 1,
            unitCost: 10,
            occurredAt: new Date(),
          }),
        ),
      );

      expect(await cachedBalance(itemId)).toBe(1000 - concurrentOutbounds);
      // The criterion that matters: the cache equals the sum of the history.
      expect(await cachedBalance(itemId)).toBe(await ledgerBalance(itemId));
    });

    it('does not lose an adjustment sent concurrently through the API', async () => {
      const before = await cachedBalance(itemId);
      const concurrent = 8;

      await Promise.all(
        Array.from({ length: concurrent }, () =>
          request(server())
            .post('/stock-movement/adjustment')
            .set('Authorization', auth())
            .send({ itemId, quantity: 1, reason: 'loss' })
            .expect(201),
        ),
      );

      expect(await cachedBalance(itemId)).toBe(before - concurrent);
      expect(await cachedBalance(itemId)).toBe(await ledgerBalance(itemId));
    });
  });

  describe('POST /stock-movement/adjustment', () => {
    it('accepts exactly the payload the app sends', async () => {
      const response = await request(server())
        .post('/stock-movement/adjustment')
        .set('Authorization', auth())
        // No date, no unit cost, no direction: the server decides all three.
        .send({ itemId, quantity: 2, reason: 'breakage', notes: null })
        .expect(201);

      const body = response.body as StockMovementResultEntity;
      expect(body.movement.type).toBe(StockMovementType.OUTBOUND);
      expect(body.movement.source).toBe(StockMovementSource.MANUAL_ADJUSTMENT);
      expect(body.movement.adjustmentReason).toBe('BREAKAGE');
      expect(body.movement.itemName).toContain('Propofol');
    });

    it('blocks an outbound bigger than the balance and says what is left', async () => {
      const available = await cachedBalance(secondItemId);

      const response = await request(server())
        .post('/stock-movement/adjustment')
        .set('Authorization', auth())
        .send({ itemId: secondItemId, quantity: available + 5, reason: 'loss' })
        .expect(409);

      expect(response.body).toMatchObject({
        code: 'INSUFFICIENT_STOCK',
        details: { available: String(available) },
      });
    });

    it("answers ITEM_NOT_FOUND for an item that is not the caller's", async () => {
      const response = await request(server())
        .post('/stock-movement/adjustment')
        .set('Authorization', auth())
        .send({ itemId: randomUUID(), quantity: 1, reason: 'loss' })
        .expect(404);

      expect(response.body).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    });
  });

  describe('GET /stock-movement', () => {
    it('lists the history newest first, with the item already joined', async () => {
      const response = await request(server())
        .get('/stock-movement')
        .query({ itemId })
        .set('Authorization', auth())
        .expect(200);

      const movements = response.body as StockMovementEntity[];
      expect(movements.length).toBeGreaterThan(0);

      const [newest] = movements;
      expect(newest.itemName).toContain('Propofol');
      expect(newest.unit).toBe('AMPOULE');
      // Quantity is a positive magnitude and the cost is per unit: the app
      // derives the sign from `type` and multiplies to get the line total.
      expect(Number(newest.quantity)).toBeGreaterThan(0);
      expect(newest.occurredAt).toMatch(/Z$/);

      const timestamps = movements.map(m => new Date(m.occurredAt).getTime());
      expect([...timestamps].sort((a, b) => b - a)).toEqual(timestamps);
    });

    it('filters by period on the server', async () => {
      const empty = await request(server())
        .get('/stock-movement')
        .query({ periodStart: '2000-01-01', periodEnd: '2000-12-31' })
        .set('Authorization', auth())
        .expect(200);
      expect(empty.body).toEqual([]);

      const today = new Date().toISOString().slice(0, 10);
      const found = await request(server())
        .get('/stock-movement')
        .query({ periodStart: today, periodEnd: today })
        .set('Authorization', auth())
        .expect(200);
      expect((found.body as StockMovementEntity[]).length).toBeGreaterThan(0);
    });

    it('rejects a limit above the cap instead of truncating in silence', async () => {
      await request(server())
        .get('/stock-movement')
        .query({ limit: 500 })
        .set('Authorization', auth())
        .expect(400);
    });
  });

  describe('recordBatch', () => {
    it('writes every movement of the batch or none of them', async () => {
      await request(server())
        .post('/stock-movement/purchase')
        .set('Authorization', auth())
        .send({
          itemId: secondItemId,
          quantity: 10,
          unitValue: 5,
          date: new Date().toISOString(),
        })
        .expect(201);

      const firstBefore = await cachedBalance(itemId);
      const secondBefore = await cachedBalance(secondItemId);

      await expect(
        stockMovements.recordBatch(userId, [
          {
            itemId,
            type: StockMovementType.OUTBOUND,
            source: StockMovementSource.MANUAL_ADJUSTMENT,
            adjustmentReason: 'LOSS',
            quantity: 1,
            unitCost: 10,
            occurredAt: new Date(),
          },
          {
            itemId: secondItemId,
            type: StockMovementType.OUTBOUND,
            source: StockMovementSource.MANUAL_ADJUSTMENT,
            adjustmentReason: 'LOSS',
            // More than the item has: the whole batch must roll back.
            quantity: secondBefore + 1,
            unitCost: 5,
            occurredAt: new Date(),
          },
        ]),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });

      expect(await cachedBalance(itemId)).toBe(firstBefore);
      expect(await cachedBalance(secondItemId)).toBe(secondBefore);
      expect(await cachedBalance(itemId)).toBe(await ledgerBalance(itemId));
    });

    it('commits both items when the batch holds together', async () => {
      const firstBefore = await cachedBalance(itemId);
      const secondBefore = await cachedBalance(secondItemId);

      const results = await stockMovements.recordBatch(userId, [
        {
          itemId,
          type: StockMovementType.OUTBOUND,
          source: StockMovementSource.MANUAL_ADJUSTMENT,
          adjustmentReason: 'LOSS',
          quantity: 2,
          unitCost: 10,
          occurredAt: new Date(),
        },
        {
          itemId: secondItemId,
          type: StockMovementType.OUTBOUND,
          source: StockMovementSource.MANUAL_ADJUSTMENT,
          adjustmentReason: 'LOSS',
          quantity: 3,
          unitCost: 5,
          occurredAt: new Date(),
        },
      ]);

      expect(results).toHaveLength(2);
      expect(await cachedBalance(itemId)).toBe(firstBefore - 2);
      expect(await cachedBalance(secondItemId)).toBe(secondBefore - 3);
    });
  });

  describe('US10 loop: a reversal into the red, then a count', () => {
    it('flags the item, refuses an ordinary outbound, and clears on the count', async () => {
      const countedItemId = await createItem(`Cetamina e2e ${randomUUID()}`);

      await stockMovements.record(
        userId,
        {
          itemId: countedItemId,
          type: StockMovementType.OUTBOUND,
          source: StockMovementSource.CORRECTION_REVERSAL,
          quantity: 3,
          unitCost: 10,
          occurredAt: new Date(),
        },
        { allowNegativeBalance: true },
      );

      const flagged = await prisma.item.findUniqueOrThrow({
        where: { id: countedItemId },
      });
      expect(flagged.needsAdjustment).toBe(true);
      expect(flagged.currentQuantity.toNumber()).toBe(-3);

      // Nothing left to take out: an ordinary adjustment cannot fix this.
      await request(server())
        .post('/stock-movement/adjustment')
        .set('Authorization', auth())
        .send({ itemId: countedItemId, quantity: 1, reason: 'loss' })
        .expect(409);

      const counted = await request(server())
        .post('/stock-movement/count')
        .set('Authorization', auth())
        .send({ itemId: countedItemId, countedQuantity: 4 })
        .expect(201);

      const body = counted.body as StockMovementResultEntity;
      expect(body.movement.type).toBe(StockMovementType.INBOUND);
      expect(Number(body.movement.quantity)).toBe(7);
      expect(body.needsAdjustment).toBe(false);
      expect(await cachedBalance(countedItemId)).toBe(4);
      expect(await ledgerBalance(countedItemId)).toBe(4);
    });
  });
  describe('GET /stock-movement/summary', () => {
    const today = () => new Date().toISOString().slice(0, 10);

    it('answers the period totals with the money', async () => {
      const response = await request(server())
        .get('/stock-movement/summary')
        .query({ periodStart: '2026-01-01', periodEnd: today() })
        .set('Authorization', auth())
        .expect(200);

      const body = response.body as StockSummaryEntity;
      expect(Number(body.inbound.quantity)).toBeGreaterThan(0);
      expect(Number(body.outbound.quantity)).toBeGreaterThan(0);
      // Decimals travel as strings here too.
      expect(typeof body.inbound.value).toBe('string');
      expect(body.item).toBeNull();
    });

    it('adds the per-item block, opening from the ledger', async () => {
      const response = await request(server())
        .get('/stock-movement/summary')
        .query({ periodStart: '2026-01-01', periodEnd: today(), itemId })
        .set('Authorization', auth())
        .expect(200);

      const item = (response.body as StockSummaryEntity).item;
      expect(item).not.toBeNull();
      expect(item!.itemId).toBe(itemId);

      // The block has to reconcile against the movements it reports.
      const closes =
        Number(item!.openingBalance) +
        Number(item!.inbound.quantity) -
        Number(item!.outbound.quantity);
      expect(closes).toBe(Number(item!.closingBalance));
      // And against the ledger itself.
      expect(Number(item!.closingBalance)).toBe(await ledgerBalance(itemId));
    });

    it('requires the period and refuses an inverted one', async () => {
      await request(server())
        .get('/stock-movement/summary')
        .set('Authorization', auth())
        .expect(400);

      await request(server())
        .get('/stock-movement/summary')
        .query({ periodStart: '2026-12-31', periodEnd: '2026-01-01' })
        .set('Authorization', auth())
        .expect(400);
    });

    it('refuses without a token', async () => {
      await request(server())
        .get('/stock-movement/summary')
        .query({ periodStart: '2026-01-01', periodEnd: today() })
        .expect(401);
    });
  });

  describe('offline sync through the routes', () => {
    /** A movement exactly as a device would put it on the wire. */
    const deviceMovement = (
      id: string,
      quantity: number,
      occurredAt: string,
    ) => ({
      id,
      itemId: secondItemId,
      type: 'OUTBOUND',
      source: 'MANUAL_ADJUSTMENT',
      adjustmentReason: 'LOSS',
      quantity,
      unitCost: 5,
      occurredAt,
    });

    const pushSync = (movements: unknown[]) =>
      request(server())
        .post('/stock-movement/sync')
        .set('Authorization', auth())
        .send({ movements });

    it('re-sending a batch does not take the stock out twice', async () => {
      await request(server())
        .post('/stock-movement/purchase')
        .set('Authorization', auth())
        .send({
          itemId: secondItemId,
          quantity: 30,
          unitValue: 5,
          date: new Date().toISOString(),
        })
        .expect(201);

      const before = await cachedBalance(secondItemId);
      const movements = [
        deviceMovement(randomUUID(), 2, '2026-09-10T08:00:00.000Z'),
        deviceMovement(randomUUID(), 3, '2026-09-10T09:00:00.000Z'),
      ];

      const first = await pushSync(movements).expect(201);
      expect((first.body as StockSyncPushEntity).applied).toHaveLength(2);
      expect(await cachedBalance(secondItemId)).toBe(before - 5);

      // The primary key is what makes this safe — the assertion a fake
      // repository cannot make on the project's behalf.
      const retry = await pushSync(movements).expect(201);
      const retryBody = retry.body as StockSyncPushEntity;
      expect(retryBody.applied).toEqual([]);
      expect(retryBody.duplicated).toHaveLength(2);
      expect(await cachedBalance(secondItemId)).toBe(before - 5);
      expect(await cachedBalance(secondItemId)).toBe(
        await ledgerBalance(secondItemId),
      );
    });

    it('keeps the device ids it was given', async () => {
      const id = randomUUID();
      await pushSync([
        deviceMovement(id, 1, '2026-09-11T08:00:00.000Z'),
      ]).expect(201);

      const stored = await prisma.stockMovement.findUnique({ where: { id } });
      expect(stored).not.toBeNull();
    });

    it('applies in chronological order regardless of arrival order', async () => {
      const [first, second] = [randomUUID(), randomUUID()];
      const response = await pushSync([
        deviceMovement(second, 1, '2026-09-14T10:00:00.000Z'),
        deviceMovement(first, 1, '2026-09-13T10:00:00.000Z'),
      ]).expect(201);

      const applied = (response.body as StockSyncPushEntity).applied;
      expect(applied.map(m => m.id)).toEqual([first, second]);
    });

    it('keeps an offline consumption the stock no longer covers', async () => {
      const spent = await createItem(`Cetamina sync ${randomUUID()}`);
      const response = await pushSync([
        {
          ...deviceMovement(randomUUID(), 4, '2026-09-15T10:00:00.000Z'),
          itemId: spent,
        },
      ]).expect(201);

      const body = response.body as StockSyncPushEntity;
      expect(body.applied).toHaveLength(1);
      expect(body.needsAdjustment).toEqual([spent]);
      expect(await cachedBalance(spent)).toBe(-4);
    });

    it('refuses an origin that needs the network (US10)', async () => {
      const response = await pushSync([
        {
          ...deviceMovement(randomUUID(), 1, '2026-09-16T10:00:00.000Z'),
          type: 'INBOUND',
          source: 'ORDER_IMPORT',
          adjustmentReason: undefined,
        },
      ]).expect(400);

      expect(response.body).toMatchObject({
        code: 'STOCK_SYNC_SOURCE_NOT_ALLOWED',
      });
    });

    it('rejects a malformed movement inside the batch', async () => {
      await pushSync([
        {
          ...deviceMovement(randomUUID(), 1, '2026-09-17T10:00:00.000Z'),
          id: 'not-a-uuid',
        },
      ]).expect(400);

      await pushSync([]).expect(400);
    });

    it('hands back a delta and a cursor that does not replay it forever', async () => {
      const cursor = new Date();
      const id = randomUUID();
      await pushSync([
        deviceMovement(id, 1, '2026-09-12T08:00:00.000Z'),
      ]).expect(201);

      const delta = await request(server())
        .get('/stock-movement/sync')
        .query({ since: cursor.toISOString() })
        .set('Authorization', auth())
        .expect(200);

      const body = delta.body as StockSyncPullEntity;
      expect(body.movements.map(m => m.id)).toContain(id);
      expect(body.balances.map(b => b.itemId)).toContain(secondItemId);

      // Pulling again past the returned cursor must not hand out the same row,
      // beyond the deliberate overlap window.
      const next = await request(server())
        .get('/stock-movement/sync')
        .query({
          since: new Date(
            new Date(body.cursor).getTime() + 10_000,
          ).toISOString(),
        })
        .set('Authorization', auth())
        .expect(200);

      expect(
        (next.body as StockSyncPullEntity).movements.map(m => m.id),
      ).not.toContain(id);
    });

    it('pages through pushes that land within one overlap window', async () => {
      // Three full pushes in a row: 600 rows inside the 5 s overlap, more than
      // one 500-row page. Each push shares one created_at.
      const ids: string[] = [];
      const start = new Date();
      for (let push = 0; push < 3; push++) {
        const batch = Array.from({ length: 200 }, (_, i) => {
          const id = randomUUID();
          ids.push(id);
          return deviceMovement(
            id,
            0.001,
            new Date(start.getTime() - 60_000 + push * 200 + i).toISOString(),
          );
        });
        await pushSync(batch).expect(201);
      }

      const seen = new Set<string>();
      let query: Record<string, string> = {
        since: new Date(start.getTime() - 1000).toISOString(),
      };
      let rounds = 0;
      for (; rounds < 10; rounds++) {
        const res = await request(server())
          .get('/stock-movement/sync')
          .query(query)
          .set('Authorization', auth())
          .expect(200);
        const body = res.body as StockSyncPullEntity;
        body.movements.forEach(m => seen.add(m.id));
        if (!body.hasMore) break;
        query = {
          since: new Date(body.cursor).toISOString(),
          afterId: body.afterId!,
        };
      }

      expect(rounds).toBeLessThan(10);
      expect(ids.every(id => seen.has(id))).toBe(true);
    });

    it('requires the cursor on the pull', async () => {
      await request(server())
        .get('/stock-movement/sync')
        .set('Authorization', auth())
        .expect(400);
    });
  });

  describe('auth and ownership', () => {
    it('refuses every route without a token (401), never an empty list', async () => {
      await request(server()).get('/stock-movement').expect(401);
      await request(server())
        .post('/stock-movement/adjustment')
        .send({ itemId, quantity: 1, reason: 'loss' })
        .expect(401);
      await request(server())
        .post('/stock-movement/count')
        .send({ itemId, countedQuantity: 1 })
        .expect(401);
    });

    it('refuses a userId in the payload (400)', async () => {
      // `forbidNonWhitelisted`: the owner comes from the token, never the body.
      await request(server())
        .post('/stock-movement/adjustment')
        .set('Authorization', auth())
        .send({ itemId, quantity: 1, reason: 'loss', userId: randomUUID() })
        .expect(400);
    });

    it("refuses a supplier that is not the caller's (422)", async () => {
      const response = await request(server())
        .post('/stock-movement/purchase')
        .set('Authorization', auth())
        .send({
          itemId,
          quantity: 1,
          unitValue: 10,
          date: new Date().toISOString(),
          supplierId: randomUUID(),
        })
        .expect(422);

      expect(response.body).toMatchObject({ code: 'SUPPLIER_NOT_FOUND' });
    });
  });
});
