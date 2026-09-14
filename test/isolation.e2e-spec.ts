import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import {
  bearer,
  body,
  createTestApp,
  mintTokens,
  resetDatabase,
  TestUser,
} from './helpers/test-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * The test ADR-11 asks for by name:
 *
 *   "um teste automatizado por módulo que cria dados de dois usuários e
 *    verifica que um não enxerga o outro. Se vocês só escreverem um tipo de
 *    teste no projeto inteiro, que seja esse."
 *
 * Two real accounts, each authenticating as itself. Every case checks the
 * status *and* re-reads the record as its owner, because a 404 on its own does
 * not prove the write was refused — an endpoint could answer 404 and still have
 * changed the row.
 *
 * Not found, never forbidden: 403 would confirm the record exists, which turns
 * the endpoint into a way to discover other people's ids.
 */
describe('isolation between accounts (ADR-11) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;

  const ana: TestUser = {
    cognitoSub: 'sub-isolation-ana',
    email: 'ana.isolation@example.com',
    name: 'Ana Souza',
  };

  const bruno: TestUser = {
    cognitoSub: 'sub-isolation-bruno',
    email: 'bruno.isolation@example.com',
    name: 'Bruno Lima',
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    http = app.getHttpServer() as App;
    await mintTokens([ana, bruno]);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    for (const user of [ana, bruno]) {
      await request(http)
        .post('/auth/session')
        .set('Authorization', bearer(user))
        .expect(200);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const createItem = async (user: TestUser, name: string): Promise<string> => {
    const response = await request(http)
      .post('/item')
      .set('Authorization', bearer(user))
      .send({ category: 'MEDICATION', unit: 'AMPOULE', name })
      .expect(201);

    return body(response).id as string;
  };

  /** Reads an item as its owner, to prove an attempted write changed nothing. */
  const readAsOwner = async (user: TestUser, itemId: string) => {
    const response = await request(http)
      .get(`/item/${itemId}`)
      .set('Authorization', bearer(user))
      .expect(200);

    return body(response);
  };

  describe('item', () => {
    it('does not list another account items', async () => {
      await createItem(ana, 'Dipirona da Ana');
      await createItem(bruno, 'Cetamina do Bruno');

      const response = await request(http)
        .get('/item')
        .set('Authorization', bearer(bruno))
        .expect(200);

      const names = (response.body as { name: string }[]).map(i => i.name);
      expect(names).toEqual(['Cetamina do Bruno']);
    });

    it('answers 404, not 403, when reading another account item', async () => {
      const anaItem = await createItem(ana, 'Dipirona da Ana');

      const response = await request(http)
        .get(`/item/${anaItem}`)
        .set('Authorization', bearer(bruno))
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    });

    it('refuses to update another account item, and leaves it untouched', async () => {
      const anaItem = await createItem(ana, 'Dipirona da Ana');

      await request(http)
        .patch(`/item/${anaItem}`)
        .set('Authorization', bearer(bruno))
        .send({ name: 'Renomeado pelo Bruno' })
        .expect(404);

      // The assertion that catches a `where: { id }` update: the status alone
      // would look right even if the row had already been written.
      expect((await readAsOwner(ana, anaItem)).name).toBe('Dipirona da Ana');
    });

    it('refuses to delete another account item, and leaves it active', async () => {
      const anaItem = await createItem(ana, 'Dipirona da Ana');

      await request(http)
        .delete(`/item/${anaItem}`)
        .set('Authorization', bearer(bruno))
        .expect(404);

      expect((await readAsOwner(ana, anaItem)).active).toBe(true);
    });

    it('refuses to add stock to another account item, and moves no quantity', async () => {
      const anaItem = await createItem(ana, 'Dipirona da Ana');

      await request(http)
        .post(`/item/${anaItem}/lot`)
        .set('Authorization', bearer(bruno))
        .send({ quantity: 10, unitCost: 5 })
        .expect(404);

      expect((await readAsOwner(ana, anaItem)).currentQuantity).toBe('0');
      expect(await prisma.stockMovement.count()).toBe(0);
    });

    it('cannot reassign an item by sending a userId', async () => {
      const brunoItem = await createItem(bruno, 'Cetamina do Bruno');
      const anaRow = await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: ana.cognitoSub },
      });

      // `userId` is not in the DTO any more, and `forbidNonWhitelisted` makes
      // sending it a 400 rather than a silent transfer of the record.
      await request(http)
        .patch(`/item/${brunoItem}`)
        .set('Authorization', bearer(bruno))
        .send({ userId: anaRow.id })
        .expect(400);

      const stored = await prisma.item.findUniqueOrThrow({
        where: { id: brunoItem },
      });
      expect(stored.userId).not.toBe(anaRow.id);
    });
  });

  describe('stock-movements', () => {
    const today = () => new Date().toISOString();

    it('refuses an adjustment on another account item, and moves no quantity', async () => {
      const anaItem = await createItem(ana, 'Dipirona da Ana');
      await request(http)
        .post('/stock-movement/purchase')
        .set('Authorization', bearer(ana))
        .send({ itemId: anaItem, quantity: 10, unitValue: 5, date: today() })
        .expect(201);

      const response = await request(http)
        .post('/stock-movement/adjustment')
        .set('Authorization', bearer(bruno))
        .send({ itemId: anaItem, quantity: 3, reason: 'LOSS' })
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'ITEM_NOT_FOUND' });
      expect((await readAsOwner(ana, anaItem)).currentQuantity).toBe('10');
      expect(await prisma.stockMovement.count()).toBe(1);
    });

    it('refuses a purchase into another account item, and moves no quantity', async () => {
      const anaItem = await createItem(ana, 'Dipirona da Ana');

      const response = await request(http)
        .post('/stock-movement/purchase')
        .set('Authorization', bearer(bruno))
        .send({ itemId: anaItem, quantity: 10, unitValue: 5, date: today() })
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'ITEM_NOT_FOUND' });
      expect((await readAsOwner(ana, anaItem)).currentQuantity).toBe('0');
      expect(await prisma.stockMovement.count()).toBe(0);
    });

    it('treats another account supplier as one that does not exist', async () => {
      const brunoItem = await createItem(bruno, 'Cetamina do Bruno');
      const supplier = await request(http)
        .post('/supplier')
        .set('Authorization', bearer(ana))
        .send({ name: 'Distribuidora da Ana' })
        .expect(201);

      // Same answer as a random id, so the response cannot confirm that the
      // supplier exists in someone else's account.
      const response = await request(http)
        .post('/stock-movement/purchase')
        .set('Authorization', bearer(bruno))
        .send({
          itemId: brunoItem,
          supplierId: body(supplier).id,
          quantity: 10,
          unitValue: 5,
          date: today(),
        })
        .expect(422);

      expect(body(response)).toMatchObject({ code: 'SUPPLIER_NOT_FOUND' });
      expect(await prisma.stockMovement.count()).toBe(0);
    });
  });

  describe('users', () => {
    it('keeps each account terms consent to itself', async () => {
      await request(http)
        .post('/auth/terms')
        .set('Authorization', bearer(ana))
        .send({ termsVersion: '2026-09-01' })
        .expect(200);

      const stored = await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: bruno.cognitoSub },
      });
      expect(stored.termsAcceptedAt).toBeNull();
    });

    // `GET /users` still returns every account, and `GET /users/:id` still
    // reads any of them. Both are behind the guard now, so this is no longer
    // open to the world — but it is open to every authenticated account, which
    // ADR-11 does not allow. Scoping them is a published-API change (see the
    // open questions on the PR), so it is deliberately not done here, and this
    // is the test that will assert it once the shape is decided.
    it.todo('does not let one account read another through /users');
  });
});
