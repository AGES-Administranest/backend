import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/infra/prisma/prisma.service';
import { AllExceptionsFilter } from '../../../src/shared/filters/all-exceptions.filter';

interface SupplierBody {
  id: string;
  name: string;
  email?: string | null;
}

describe('Supplier (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;

  const server = () => app.getHttpServer();

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
        cognitoSub: `e2e-supplier-${randomUUID()}`,
        email: `e2e-supplier-${randomUUID()}@example.com`,
        name: 'E2E Supplier Tester',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.supplier.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
  });

  describe('POST /supplier', () => {
    it('creates a supplier (201) without leaking userId', async () => {
      const res = await request(server())
        .post('/supplier')
        .send({
          userId,
          name: 'Distribuidora e2e',
          email: 'vendas@e2e.com.br',
        })
        .expect(201);

      const body = res.body as SupplierBody;
      expect(body.id).toBeDefined();
      expect(body.email).toBe('vendas@e2e.com.br');
      expect(body).not.toHaveProperty('userId');
    });

    it('rejects a duplicated name (409)', async () => {
      await request(server())
        .post('/supplier')
        .send({ userId, name: 'Duplicada e2e' })
        .expect(201);

      await request(server())
        .post('/supplier')
        .send({ userId, name: 'Duplicada e2e' })
        .expect(409);
    });

    it('rejects an invalid payload (400)', async () => {
      await request(server())
        .post('/supplier')
        .send({ userId, name: 'x' })
        .expect(400);
    });

    it('rejects a userId with no matching record (422)', async () => {
      await request(server())
        .post('/supplier')
        .send({ userId: randomUUID(), name: 'Sem dono e2e' })
        .expect(422);
    });
  });

  describe('GET /supplier', () => {
    it('lists the suppliers sorted by name', async () => {
      await request(server())
        .post('/supplier')
        .send({ userId, name: 'Zz ultima e2e' })
        .expect(201);
      await request(server())
        .post('/supplier')
        .send({ userId, name: 'Aa primeira e2e' })
        .expect(201);

      const res = await request(server())
        .get('/supplier')
        .query({ userId })
        .expect(200);

      const names = (res.body as SupplierBody[]).map(s => s.name);
      expect(names.indexOf('Aa primeira e2e')).toBeLessThan(
        names.indexOf('Zz ultima e2e'),
      );
    });

    it('searches by name', async () => {
      await request(server())
        .post('/supplier')
        .send({ userId, name: 'Buscavel e2e' })
        .expect(201);

      const res = await request(server())
        .get('/supplier')
        .query({ userId, search: 'Buscavel' })
        .expect(200);

      const names = (res.body as SupplierBody[]).map(s => s.name);
      expect(names).toContain('Buscavel e2e');
      expect(names.every(name => name.includes('Buscavel'))).toBe(true);
    });

    it("does not return another user's suppliers (isolation — ADR-11)", async () => {
      const other = await prisma.user.create({
        data: {
          cognitoSub: `e2e-supplier-other-${randomUUID()}`,
          email: `e2e-supplier-other-${randomUUID()}@example.com`,
          name: 'Other',
        },
      });
      await prisma.supplier.create({
        data: { userId: other.id, name: 'Do outro usuario e2e' },
      });

      const res = await request(server())
        .get('/supplier')
        .query({ userId })
        .expect(200);

      const names = (res.body as SupplierBody[]).map(s => s.name);
      expect(names).not.toContain('Do outro usuario e2e');

      await prisma.supplier.deleteMany({ where: { userId: other.id } });
      await prisma.user.delete({ where: { id: other.id } });
    });

    it('requires userId (400)', async () => {
      await request(server()).get('/supplier').expect(400);
    });
  });
});
