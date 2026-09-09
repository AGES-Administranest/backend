import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/infra/prisma/prisma.service';
import { AllExceptionsFilter } from '../../../src/shared/filters/all-exceptions.filter';

interface ItemLotBody {
  id: string;
  itemId: string;
  currentQuantity: string;
  expirationDate: string | null;
}

interface ErrorBody {
  code: string;
}

describe('ItemLot (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let otherUserId: string;
  let itemId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    const user = await prisma.user.create({
      data: {
        cognitoSub: `e2e-item-lot-${randomUUID()}`,
        email: `e2e-item-lot-${randomUUID()}@example.com`,
        name: 'E2E ItemLot Tester',
      },
    });
    userId = user.id;

    const other = await prisma.user.create({
      data: {
        cognitoSub: `e2e-item-lot-other-${randomUUID()}`,
        email: `e2e-item-lot-other-${randomUUID()}@example.com`,
        name: 'E2E ItemLot Other',
      },
    });
    otherUserId = other.id;

    const item = await prisma.item.create({
      data: {
        userId,
        category: 'MEDICATION',
        unit: 'AMPOULE',
        name: 'Dipirona injetável e2e lot',
        defaultUnitCost: 10,
      },
    });
    itemId = item.id;
  });

  afterAll(async () => {
    await prisma.stockMovement.deleteMany({
      where: { userId: { in: [userId, otherUserId] } },
    });
    await prisma.itemLot.deleteMany({ where: { itemId } });
    await prisma.item.deleteMany({
      where: { userId: { in: [userId, otherUserId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await app.close();
  });

  const server = () => app.getHttpServer();
  const lotBody = (res: request.Response) => res.body as ItemLotBody;
  const errorBody = (res: request.Response) => res.body as ErrorBody;

  describe('POST /item/:itemId/lot', () => {
    it('cria um novo lote quando não há validade cadastrada (201)', async () => {
      const res = await request(server())
        .post(`/item/${itemId}/lot`)
        .send({ userId, quantity: 5, expirationDate: '2026-12-31' })
        .expect(201);

      expect(lotBody(res)).toMatchObject({
        itemId,
        currentQuantity: '5',
        expirationDate: '2026-12-31T00:00:00.000Z',
      });
    });

    it('soma na mesma remessa quando a validade é idêntica (201)', async () => {
      const res = await request(server())
        .post(`/item/${itemId}/lot`)
        .send({ userId, quantity: 3, expirationDate: '2026-12-31' })
        .expect(201);

      expect(lotBody(res).currentQuantity).toBe('8');
    });

    it('cria um novo lote quando a validade é diferente (201)', async () => {
      const res = await request(server())
        .post(`/item/${itemId}/lot`)
        .send({ userId, quantity: 2, expirationDate: '2027-06-30' })
        .expect(201);

      expect(lotBody(res)).toMatchObject({
        itemId,
        currentQuantity: '2',
        expirationDate: '2027-06-30T00:00:00.000Z',
      });
    });

    it('404 quando o item não existe', async () => {
      const res = await request(server())
        .post(`/item/${randomUUID()}/lot`)
        .send({ userId, quantity: 1 })
        .expect(404);

      expect(errorBody(res).code).toBe('ITEM_NOT_FOUND');
    });

    it('404 quando o item pertence a outro usuário (isolamento — ADR-11)', async () => {
      const res = await request(server())
        .post(`/item/${itemId}/lot`)
        .send({ userId: otherUserId, quantity: 1 })
        .expect(404);

      expect(errorBody(res).code).toBe('ITEM_NOT_FOUND');
    });

    it('400 quando falta unitCost e o item não tem defaultUnitCost', async () => {
      const bareItem = await prisma.item.create({
        data: {
          userId,
          category: 'DISPOSABLE',
          unit: 'UNIT',
          name: 'Seringa e2e lot sem custo',
        },
      });

      const res = await request(server())
        .post(`/item/${bareItem.id}/lot`)
        .send({ userId, quantity: 1 })
        .expect(400);

      expect(errorBody(res).code).toBe('ITEM_LOT_UNIT_COST_REQUIRED');
    });
  });
});
