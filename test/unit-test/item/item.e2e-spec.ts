import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/infra/prisma/prisma.service';
import { AllExceptionsFilter } from '../../../src/shared/filters/all-exceptions.filter';

interface ItemBody {
  id: string;
  name: string;
  category?: string;
  unit?: string;
  currentQuantity?: string;
}

interface ErrorBody {
  code: string;
  details?: { campos?: string[] };
}

describe('Item (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;

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
        cognitoSub: `e2e-item-${randomUUID()}`,
        email: `e2e-item-${randomUUID()}@example.com`,
        name: 'E2E Item Tester',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
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
        .send({
          userId,
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
        .send({ userId, category: 'INVALID', unit: 'AMPOULE', name: 'A' })
        .expect(400);

      const body = errorBody(res);
      expect(body.code).toBe('VALIDATION_ERROR');
      expect(body.details?.campos).toEqual(
        expect.arrayContaining([
          expect.stringContaining('category'),
          expect.stringContaining('name'),
        ]),
      );
    });

    it('rejeita presentação duplicada (409)', async () => {
      await request(server())
        .post('/item')
        .send({
          userId,
          category: 'MEDICATION',
          unit: 'VIAL',
          name: 'Item duplicado e2e',
        })
        .expect(201);

      const res = await request(server())
        .post('/item')
        .send({
          userId,
          category: 'MEDICATION',
          unit: 'VIAL',
          name: 'Item duplicado e2e',
        })
        .expect(409);

      expect(errorBody(res).code).toBe('DUPLICATED_ITEM_PRESENTATION');
    });

    it('rejeita userId que não corresponde a um registro (422)', async () => {
      const res = await request(server())
        .post('/item')
        .send({
          userId: randomUUID(),
          category: 'MEDICATION',
          unit: 'AMPOULE',
          name: 'Item fantasma e2e',
        })
        .expect(422);

      expect(errorBody(res).code).toBe('INVALID_REFERENCE');
    });
  });

  describe('GET /item', () => {
    it('busca por nome e filtra por categoria (200)', async () => {
      await request(server())
        .post('/item')
        .send({
          userId,
          category: 'MEDICATION',
          unit: 'AMPOULE',
          name: 'Cetamina e2e listagem',
        })
        .expect(201);

      const res = await request(server())
        .get('/item')
        .query({ userId, search: 'Cetamina e2e', category: 'MEDICATION' })
        .expect(200);

      expect(listBody(res)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Cetamina e2e listagem' }),
        ]),
      );
    });

    it('não retorna itens de outro usuário (isolamento — ADR-11)', async () => {
      const other = await prisma.user.create({
        data: {
          cognitoSub: `e2e-item-other-${randomUUID()}`,
          email: `e2e-item-other-${randomUUID()}@example.com`,
          name: 'E2E Item Other',
        },
      });

      const res = await request(server())
        .get('/item')
        .query({ userId: other.id })
        .expect(200);

      expect(listBody(res)).toHaveLength(0);

      await prisma.user.delete({ where: { id: other.id } });
    });

    it('não inativos não aparecem na listagem (soft delete)', async () => {
      const created = await request(server())
        .post('/item')
        .send({
          userId,
          category: 'DISPOSABLE',
          unit: 'UNIT',
          name: 'Item inativo e2e listagem',
        })
        .expect(201);

      await request(server())
        .delete(`/item/${itemBody(created).id}`)
        .expect(200);

      const res = await request(server())
        .get('/item')
        .query({ userId, search: 'Item inativo e2e listagem' })
        .expect(200);

      expect(listBody(res)).toHaveLength(0);

      const withInactive = await request(server())
        .get('/item')
        .query({ userId, search: 'Item inativo e2e listagem', active: false })
        .expect(200);

      expect(listBody(withInactive)).toHaveLength(1);
    });

    it('respeita o limit como teto de resultados', async () => {
      const res = await request(server())
        .get('/item')
        .query({ userId, page: 1, limit: 1 })
        .expect(200);

      expect(listBody(res)).toHaveLength(1);
    });

    it('busca com menos de 2 caracteres é ignorada (retorna tudo)', async () => {
      const all = await request(server())
        .get('/item')
        .query({ userId })
        .expect(200);
      const filtered = await request(server())
        .get('/item')
        .query({ userId, search: 'a' })
        .expect(200);

      expect(listBody(filtered)).toHaveLength(listBody(all).length);
    });

    it('400 quando userId não é informado', async () => {
      await request(server()).get('/item').expect(400);
    });
  });

  describe('GET /item/:id', () => {
    it('busca um item (200)', async () => {
      const created = await request(server())
        .post('/item')
        .send({
          userId,
          category: 'DISPOSABLE',
          unit: 'UNIT',
          name: 'Seringa e2e',
        })
        .expect(201);

      const res = await request(server())
        .get(`/item/${itemBody(created).id}`)
        .expect(200);

      expect(itemBody(res).name).toBe('Seringa e2e');
    });

    it('404 quando o item não existe', async () => {
      const res = await request(server())
        .get(`/item/${randomUUID()}`)
        .expect(404);

      expect(errorBody(res).code).toBe('ITEM_NOT_FOUND');
    });
  });

  describe('PATCH /item/:id', () => {
    it('atualiza parcialmente (200)', async () => {
      const created = await request(server())
        .post('/item')
        .send({
          userId,
          category: 'ANESTHETIC',
          unit: 'ML',
          name: 'Anestésico e2e',
        })
        .expect(201);

      const res = await request(server())
        .patch(`/item/${itemBody(created).id}`)
        .send({ currentQuantity: 5 })
        .expect(200);

      const body = itemBody(res);
      expect(body.currentQuantity).toBe('5');
      expect(body.name).toBe('Anestésico e2e');
    });

    it('404 quando o item não existe', async () => {
      const res = await request(server())
        .patch(`/item/${randomUUID()}`)
        .send({ currentQuantity: 1 })
        .expect(404);

      expect(errorBody(res).code).toBe('ITEM_NOT_FOUND');
    });
  });

  describe('DELETE /item/:id', () => {
    it('inativa o item e devolve id+name (200)', async () => {
      const created = await request(server())
        .post('/item')
        .send({
          userId,
          category: 'DISPOSABLE',
          unit: 'BOX',
          name: 'Item pra deletar e2e',
        })
        .expect(201);

      const res = await request(server())
        .delete(`/item/${itemBody(created).id}`)
        .expect(200);

      expect(res.body).toEqual({
        id: itemBody(created).id,
        name: 'Item pra deletar e2e',
      });
    });

    it('404 quando o item não existe', async () => {
      const res = await request(server())
        .delete(`/item/${randomUUID()}`)
        .expect(404);

      expect(errorBody(res).code).toBe('ITEM_NOT_FOUND');
    });
  });
});
