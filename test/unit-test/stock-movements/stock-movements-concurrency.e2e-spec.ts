import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { StockMovementSource, StockMovementType } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/infra/prisma/prisma.service';
import { StockMovementsService } from '../../../src/modules/stock-movements';

describe('StockMovementsService concurrency (e2e, real Postgres)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let stockMovementsService: StockMovementsService;
  let userId: string;
  let itemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    prisma = moduleFixture.get(PrismaService);
    stockMovementsService = moduleFixture.get(StockMovementsService);

    const user = await prisma.user.create({
      data: {
        cognitoSub: `e2e-concurrency-${randomUUID()}`,
        email: `e2e-concurrency-${randomUUID()}@example.com`,
        name: 'E2E Concurrency Tester',
      },
    });
    userId = user.id;

    const item = await prisma.item.create({
      data: {
        userId,
        category: 'MEDICATION',
        unit: 'UNIT',
        name: 'Item de concorrência e2e',
      },
    });
    itemId = item.id;

    await stockMovementsService.record(userId, {
      itemId,
      type: StockMovementType.INBOUND,
      source: StockMovementSource.MANUAL_PURCHASE,
      quantity: 1000,
      unitCost: 10,
      occurredAt: new Date(),
    });
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
});
