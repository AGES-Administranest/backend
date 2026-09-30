import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

import { PrismaService } from '../../../src/infra/prisma/prisma.service';
import {
  bearer,
  createTestApp,
  mintTokens,
  TestUser,
} from '../../helpers/test-app';

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

  const owner: TestUser = {
    cognitoSub: `e2e-item-lot-${randomUUID()}`,
    email: `e2e-item-lot-${randomUUID()}@example.com`,
    name: 'E2E ItemLot Tester',
  };

  const stranger: TestUser = {
    cognitoSub: `e2e-item-lot-other-${randomUUID()}`,
    email: `e2e-item-lot-other-${randomUUID()}@example.com`,
    name: 'E2E ItemLot Other',
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await mintTokens([owner, stranger]);

    const provision = async (user: TestUser) => {
      const session = await request(app.getHttpServer())
        .post('/auth/session')
        .set('Authorization', bearer(user))
        .expect(200);
      return (session.body as { id: string }).id;
    };

    userId = await provision(owner);
    otherUserId = await provision(stranger);

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
    await prisma.user.deleteMany({
      where: { id: { in: [userId, otherUserId] } },
    });
    await app.close();
  });

  const server = () => app.getHttpServer();
  const lotBody = (res: request.Response) => res.body as ItemLotBody;
  const errorBody = (res: request.Response) => res.body as ErrorBody;

  describe('POST /item/:itemId/lot', () => {
    it('cria um novo lote quando não há validade cadastrada (201)', async () => {
      const res = await request(server())
        .post(`/item/${itemId}/lot`)
        .set('Authorization', bearer(owner))
        .send({ quantity: 5, expirationDate: '2026-12-31' })
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
        .set('Authorization', bearer(owner))
        .send({ quantity: 3, expirationDate: '2026-12-31' })
        .expect(201);

      expect(lotBody(res).currentQuantity).toBe('8');
    });

    it('cria um novo lote quando a validade é diferente (201)', async () => {
      const res = await request(server())
        .post(`/item/${itemId}/lot`)
        .set('Authorization', bearer(owner))
        .send({ quantity: 2, expirationDate: '2027-06-30' })
        .expect(201);

      expect(lotBody(res)).toMatchObject({
        itemId,
        currentQuantity: '2',
        expirationDate: '2027-06-30T00:00:00.000Z',
      });
    });

    it('goes through the stock ledger instead of writing the movement itself', async () => {
      // The whole point of the central service (ADR-10): receiving a lot is a
      // stock movement, so it has to leave the same trail as any other one.
      const movements = await prisma.stockMovement.findMany({
        where: { userId, itemId },
        orderBy: { createdAt: 'asc' },
      });

      expect(movements).toHaveLength(3);
      expect(movements.every(m => m.type === 'INBOUND')).toBe(true);
      expect(movements.every(m => m.source === 'MANUAL_PURCHASE')).toBe(true);
      // Each movement points at the lot it filled.
      expect(movements.every(m => m.lotId !== null)).toBe(true);
    });

    it('leaves the cached balance equal to the sum of the ledger', async () => {
      const movements = await prisma.stockMovement.findMany({
        where: { userId, itemId, deletedAt: null },
      });
      const fromLedger = movements.reduce(
        (total, movement) =>
          movement.type === 'INBOUND'
            ? total + movement.quantity.toNumber()
            : total - movement.quantity.toNumber(),
        0,
      );
      const item = await prisma.item.findUniqueOrThrow({
        where: { id: itemId },
      });

      expect(item.currentQuantity.toNumber()).toBe(fromLedger);
      expect(fromLedger).toBe(10); // 5 + 3 + 2
    });

    it('404 quando o item não existe', async () => {
      const res = await request(server())
        .post(`/item/${randomUUID()}/lot`)
        .set('Authorization', bearer(owner))
        .send({ quantity: 1 })
        .expect(404);

      expect(errorBody(res).code).toBe('ITEM_NOT_FOUND');
    });

    it('404 quando o item pertence a outro usuário (isolamento — ADR-11)', async () => {
      // A real second account, authenticated as itself. It used to be enough to
      // put someone else's id in the body; now the only identity available is
      // the one the token carries, and the item simply does not exist for it.
      const res = await request(server())
        .post(`/item/${itemId}/lot`)
        .set('Authorization', bearer(stranger))
        .send({ quantity: 1 })
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
        .set('Authorization', bearer(owner))
        .send({ quantity: 1 })
        .expect(400);

      expect(errorBody(res).code).toBe('ITEM_LOT_UNIT_COST_REQUIRED');
    });
  });
});
