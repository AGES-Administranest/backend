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
      expect(body.code).toBe('VALIDACAO_INVALIDA');
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

      expect(errorBody(res).code).toBe('ITEM_PRESENTACAO_DUPLICADA');
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

      expect(errorBody(res).code).toBe('ITEM_REFERENCIA_INVALIDA');
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

      expect(errorBody(res).code).toBe('ITEM_NAO_ENCONTRADO');
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

      expect(errorBody(res).code).toBe('ITEM_NAO_ENCONTRADO');
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

      expect(errorBody(res).code).toBe('ITEM_NAO_ENCONTRADO');
    });
  });
});
