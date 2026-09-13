import { INestApplication } from '@nestjs/common';
import { StockMovementSource, StockMovementType } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

import { PrismaService } from '../../../src/infra/prisma/prisma.service';
import { StockMovementsService } from '../../../src/modules/stock-movements';
import {
  bearer,
  createTestApp,
  mintTokens,
  TestUser,
} from '../../helpers/test-app';

describe('StockMovementsService concurrency (e2e, real Postgres)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let stockMovementsService: StockMovementsService;
  let userId: string;
  let itemId: string;

  const owner: TestUser = {
    cognitoSub: `e2e-concurrency-${randomUUID()}`,
    email: `e2e-concurrency-${randomUUID()}@example.com`,
    name: 'E2E Concurrency Tester',
  };

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    stockMovementsService = app.get(StockMovementsService);
    await mintTokens([owner]);

    // The mirror and the item are created through the API, so the id the
    // ledger is scoped by is the one the guard resolves from the token.
    const session = await request(server())
      .post('/auth/session')
      .set('Authorization', bearer(owner))
      .expect(200);
    userId = (session.body as { id: string }).id;

    const item = await request(server())
      .post('/item')
      .set('Authorization', bearer(owner))
      .send({
        category: 'MEDICATION',
        unit: 'UNIT',
        name: 'Item de concorrência e2e',
      })
      .expect(201);
    itemId = (item.body as { id: string }).id;

    await request(server())
      .post('/stock-movements/purchases')
      .set('Authorization', bearer(owner))
      .send({
        itemId,
        quantity: 1000,
        unitValue: 10,
        date: new Date().toISOString(),
      })
      .expect(201);
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({ where: { userId } });
    await prisma.item.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  it('does not lose an outbound movement under concurrent writes to the same item', async () => {
    const concurrentOutbounds = 50;

    await Promise.all(
      Array.from({ length: concurrentOutbounds }, () =>
        stockMovementsService.record(userId, {
          itemId,
          type: StockMovementType.OUTBOUND,
          source: StockMovementSource.MANUAL_ADJUSTMENT,
          adjustmentReason: 'OTHER',
          quantity: 1,
          unitCost: 10,
          occurredAt: new Date(),
        }),
      ),
    );

    const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    const movements = await prisma.stockMovement.findMany({
      where: { userId, itemId },
    });

    expect(movements).toHaveLength(concurrentOutbounds + 1);
    expect(item.currentQuantity.toNumber()).toBe(1000 - concurrentOutbounds);
  });

  it('does not lose an adjustment sent concurrently through the API', async () => {
    const before = await prisma.item.findUniqueOrThrow({
      where: { id: itemId },
    });
    const concurrentAdjustments = 8;

    await Promise.all(
      Array.from({ length: concurrentAdjustments }, () =>
        request(server())
          .post('/stock-movements/adjustments')
          .set('Authorization', bearer(owner))
          .send({
            itemId,
            quantity: 1,
            adjustmentReason: 'LOSS',
            date: new Date().toISOString(),
          })
          .expect(201),
      ),
    );

    const after = await prisma.item.findUniqueOrThrow({
      where: { id: itemId },
    });
    expect(after.currentQuantity.toNumber()).toBe(
      before.currentQuantity.toNumber() - concurrentAdjustments,
    );
  });

  it('refuses the routes without a token (401)', async () => {
    await request(server())
      .post('/stock-movements/adjustments')
      .send({
        itemId,
        quantity: 1,
        adjustmentReason: 'LOSS',
        date: new Date().toISOString(),
      })
      .expect(401);
  });

  it('refuses a userId in the payload (400)', async () => {
    // `forbidNonWhitelisted`: the owner comes from the token, never the body.
    await request(server())
      .post('/stock-movements/purchases')
      .set('Authorization', bearer(owner))
      .send({
        itemId,
        quantity: 1,
        unitValue: 10,
        date: new Date().toISOString(),
        userId: randomUUID(),
      })
      .expect(400);
  });
});
