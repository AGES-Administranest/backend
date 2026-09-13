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

interface ItemBody {
  id: string;
  name: string;
  category?: string;
  unit?: string;
  currentQuantity?: string;
  nearestExpiration?: string | null;
}

interface ErrorBody {
  code: string;
  details?: { fields?: string[] };
}

describe('Item (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;

  const owner: TestUser = {
    cognitoSub: `e2e-item-${randomUUID()}`,
    email: `e2e-item-${randomUUID()}@example.com`,
    name: 'E2E Item Tester',
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await mintTokens([owner]);

    // The mirror is created the way the app creates it, rather than written
    // straight to the table: these routes are behind the guard now, and the
    // id they scope to is the one the guard resolves from the token.
    const session = await request(app.getHttpServer())
      .post('/auth/session')
      .set('Authorization', bearer(owner))
      .expect(200);
    userId = (session.body as { id: string }).id;
  });

  afterAll(async () => {
    await prisma.itemLot.deleteMany({ where: { item: { userId } } });
    await prisma.item.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  const server = () => app.getHttpServer();
  const itemBody = (res: request.Response) => res.body as ItemBody;
  const errorBody = (res: request.Response) => res.body as ErrorBody;
  const listBody = (res: request.Response) => res.body as ItemBody[];

  describe('POST /item', () => {
    it('cria um item (201) sem expor userId na resposta', async () => {
      const res = await request(server())
        .post('/item')
        .set('Authorization', bearer(owner))
        .send({
          category: 'MEDICATION',
          unit: 'AMPOULE',
          name: 'Dipirona injetável e2e',
        })
        .expect(201);

      expect(itemBody(res)).toMatchObject({
        name: 'Dipirona injetável e2e',
        category: 'MEDICATION',
        unit: 'AMPOULE',
      });
      expect(res.body).not.toHaveProperty('userId');
    });

    it('rejeita payload inválido (400) com a lista de campos', async () => {
      const res = await request(server())
        .post('/item')
        .set('Authorization', bearer(owner))
        .send({ category: 'INVALID', unit: 'AMPOULE', name: 'A' })
        .expect(400);

      const body = errorBody(res);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details?.fields).toEqual(
        expect.arrayContaining([
          expect.stringContaining('category'),
          expect.stringContaining('name'),
        ]),
      );
    });

    it('rejeita presentação duplicada (409)', async () => {
      await request(server())
        .post('/item')
        .set('Authorization', bearer(owner))
        .send({
          category: 'MEDICATION',
          unit: 'VIAL',
          name: 'Item duplicado e2e',
        })
        .expect(201);

      const res = await request(server())
        .post('/item')
        .set('Authorization', bearer(owner))
        .send({
          category: 'MEDICATION',
          unit: 'VIAL',
          name: 'Item duplicado e2e',
        })
        .expect(409);

      expect(errorBody(res).code).toBe('DUPLICATED_ITEM_PRESENTATION');
    });

    it('rejeita um userId enviado no corpo em vez de o aceitar', async () => {
      // The owner comes from the token now. `forbidNonWhitelisted` turns an
      // app that still sends the old field into a loud 400 rather than
      // silently ignoring it — which is the point: the value would have been
      // a way to write into somebody else's account.
      const res = await request(server())
        .post('/item')
        .set('Authorization', bearer(owner))
        .send({
          userId: randomUUID(),
          category: 'MEDICATION',
          unit: 'AMPOULE',
          name: 'Item fantasma e2e',
        })
        .expect(400);

      expect(errorBody(res).code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /item', () => {
    it('busca por nome e filtra por categoria (200)', async () => {
      await request(server())
        .post('/item')
        .set('Authorization', bearer(owner))
        .send({
          category: 'MEDICATION',
          unit: 'AMPOULE',
          name: 'Cetamina e2e listagem',
        })
        .expect(201);

      const res = await request(server())
        .get('/item')
        .set('Authorization', bearer(owner))
        .query({ search: 'Cetamina e2e', category: 'MEDICATION' })
        .expect(200);

      expect(listBody(res)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Cetamina e2e listagem' }),
        ]),
      );
    });

    it('ignora um userId na query — a listagem é sempre do dono do token', async () => {
      // Previously `userId` was a query parameter, so changing it read another
      // account's inventory. It is rejected outright now.
      await request(server())
        .get('/item')
        .set('Authorization', bearer(owner))
        .query({ userId: randomUUID() })
        .expect(400);
    });

    it('não inativos não aparecem na listagem (soft delete)', async () => {
      const created = await request(server())
        .post('/item')
        .set('Authorization', bearer(owner))
        .send({
          category: 'DISPOSABLE',
          unit: 'UNIT',
          name: 'Item inativo e2e listagem',
        })
        .expect(201);

      await request(server())
        .delete(`/item/${itemBody(created).id}`)
        .set('Authorization', bearer(owner))
        .expect(200);

      const res = await request(server())
        .get('/item')
        .set('Authorization', bearer(owner))
        .query({ search: 'Item inativo e2e listagem' })
        .expect(200);

      expect(listBody(res)).toHaveLength(0);

      const withInactive = await request(server())
        .get('/item')
        .set('Authorization', bearer(owner))
        .query({ search: 'Item inativo e2e listagem', active: false })
        .expect(200);

      expect(listBody(withInactive)).toHaveLength(1);
    });

    it('respeita o limit como teto de resultados', async () => {
      const res = await request(server())
        .get('/item')
        .set('Authorization', bearer(owner))
        .query({ page: 1, limit: 1 })
        .expect(200);

      expect(listBody(res)).toHaveLength(1);
    });

    it('busca com menos de 2 caracteres é ignorada (retorna tudo)', async () => {
      const all = await request(server())
        .get('/item')
        .set('Authorization', bearer(owner))
        .query({})
        .expect(200);
      const filtered = await request(server())
        .get('/item')
        .set('Authorization', bearer(owner))
        .query({ search: 'a' })
        .expect(200);

      expect(listBody(filtered)).toHaveLength(listBody(all).length);
    });

    it('401 sem token — a listagem não é acessível sem autenticação', async () => {
      await request(server()).get('/item').expect(401);
    });
  });

  describe('nearestExpiration', () => {
    const lot = (
      itemId: string,
      expirationDate: string | null,
      currentQuantity: number,
    ) =>
      prisma.itemLot.create({
        data: {
          itemId,
          expirationDate: expirationDate ? new Date(expirationDate) : null,
          unitCost: 10,
          currentQuantity,
          receivedOn: new Date('2026-01-01'),
        },
      });

    const createItem = async (name: string) => {
      const item = await prisma.item.create({
        data: {
          userId,
          name,
          category: 'MEDICATION',
          unit: 'AMPOULE',
        },
      });
      return item.id;
    };

    const listed = async (name: string) => {
      const res = await request(server())
        .get('/item')
        .set('Authorization', bearer(owner))
        .query({ search: name })
        .expect(200);
      return (res.body as ItemBody[]).find(item => item.name === name);
    };

    it('returns the earliest expiration among the lots still in stock', async () => {
      const id = await createItem('Nearest e2e ordering');
      await lot(id, '2028-05-10', 5);
      await lot(id, '2027-03-31', 5);
      await lot(id, '2029-01-01', 5);

      const item = await listed('Nearest e2e ordering');

      expect(item?.nearestExpiration).toBe('2027-03-31');
    });

    it('ignores lots that ran out of stock', async () => {
      const id = await createItem('Nearest e2e empty lot');
      await lot(id, '2026-02-01', 0);
      await lot(id, '2030-09-09', 4);

      const item = await listed('Nearest e2e empty lot');

      expect(item?.nearestExpiration).toBe('2030-09-09');
    });

    it('is null when no lot carries an expiration', async () => {
      const id = await createItem('Nearest e2e no date');
      await lot(id, null, 7);

      const item = await listed('Nearest e2e no date');

      expect(item?.nearestExpiration).toBeNull();
    });

    it('is null for an item with no lots at all', async () => {
      await createItem('Nearest e2e no lots');

      const item = await listed('Nearest e2e no lots');

      expect(item?.nearestExpiration).toBeNull();
    });
  });

  describe('GET /item/:id', () => {
    it('busca um item (200)', async () => {
      const created = await request(server())
        .post('/item')
        .set('Authorization', bearer(owner))
        .send({
          category: 'DISPOSABLE',
          unit: 'UNIT',
          name: 'Seringa e2e',
        })
        .expect(201);

      const res = await request(server())
        .get(`/item/${itemBody(created).id}`)
        .set('Authorization', bearer(owner))
        .expect(200);

      expect(itemBody(res).name).toBe('Seringa e2e');
    });

    it('404 quando o item não existe', async () => {
      const res = await request(server())
        .get(`/item/${randomUUID()}`)
        .set('Authorization', bearer(owner))
        .expect(404);

      expect(errorBody(res).code).toBe('ITEM_NOT_FOUND');
    });
  });

  describe('PATCH /item/:id', () => {
    it('atualiza parcialmente (200)', async () => {
      const created = await request(server())
        .post('/item')
        .set('Authorization', bearer(owner))
        .send({
          category: 'ANESTHETIC',
          unit: 'ML',
          name: 'Anestésico e2e',
        })
        .expect(201);

      const res = await request(server())
        .patch(`/item/${itemBody(created).id}`)
        .set('Authorization', bearer(owner))
        .send({ currentQuantity: 5 })
        .expect(200);

      const body = itemBody(res);
      expect(body.currentQuantity).toBe('5');
      expect(body.name).toBe('Anestésico e2e');
    });

    it('404 quando o item não existe', async () => {
      const res = await request(server())
        .patch(`/item/${randomUUID()}`)
        .set('Authorization', bearer(owner))
        .send({ currentQuantity: 1 })
        .expect(404);

      expect(errorBody(res).code).toBe('ITEM_NOT_FOUND');
    });
  });

  describe('DELETE /item/:id', () => {
    it('inativa o item e devolve id+name (200)', async () => {
      const created = await request(server())
        .post('/item')
        .set('Authorization', bearer(owner))
        .send({
          category: 'DISPOSABLE',
          unit: 'BOX',
          name: 'Item pra deletar e2e',
        })
        .expect(201);

      const res = await request(server())
        .delete(`/item/${itemBody(created).id}`)
        .set('Authorization', bearer(owner))
        .expect(200);

      expect(res.body).toEqual({
        id: itemBody(created).id,
        name: 'Item pra deletar e2e',
      });
    });

    it('404 quando o item não existe', async () => {
      const res = await request(server())
        .delete(`/item/${randomUUID()}`)
        .set('Authorization', bearer(owner))
        .expect(404);

      expect(errorBody(res).code).toBe('ITEM_NOT_FOUND');
    });
  });
});
