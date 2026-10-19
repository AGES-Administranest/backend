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

interface SupplierBody {
  id: string;
  name: string;
  email?: string | null;
}

describe('Supplier (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let otherId: string;

  const owner: TestUser = {
    cognitoSub: `e2e-supplier-${randomUUID()}`,
    email: `e2e-supplier-${randomUUID()}@example.com`,
    name: 'E2E Supplier Tester',
  };

  const other: TestUser = {
    cognitoSub: `e2e-supplier-other-${randomUUID()}`,
    email: `e2e-supplier-other-${randomUUID()}@example.com`,
    name: 'Other',
  };

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await mintTokens([owner, other]);

    // Provisioned through the app, so the id the routes scope to is the one
    // the guard resolves from the token.
    const provision = async (user: TestUser) => {
      const session = await request(server())
        .post('/auth/session')
        .set('Authorization', bearer(user))
        .expect(200);
      return (session.body as { id: string }).id;
    };
    userId = await provision(owner);
    otherId = await provision(other);
  });

  afterAll(async () => {
    await prisma.supplier.deleteMany({
      where: { userId: { in: [userId, otherId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await app.close();
  });

  describe('POST /supplier', () => {
    it('creates a supplier (201) without leaking userId', async () => {
      const res = await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({ name: 'Distribuidora e2e', email: 'vendas@e2e.com.br' })
        .expect(201);

      const body = res.body as SupplierBody;
      expect(body.id).toBeDefined();
      expect(body.email).toBe('vendas@e2e.com.br');
      expect(body).not.toHaveProperty('userId');
    });

    it('rejects a duplicated name (409)', async () => {
      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({ name: 'Duplicada e2e' })
        .expect(201);

      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({ name: 'Duplicada e2e' })
        .expect(409);
    });

    it('rejects an invalid payload (400)', async () => {
      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({ name: 'x' })
        .expect(400);
    });

    it('rejects a userId in the body (400) — the owner comes from the token', async () => {
      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({ userId: otherId, name: 'Em nome do outro e2e' })
        .expect(400);
    });

    it('requires a token (401)', async () => {
      await request(server())
        .post('/supplier')
        .send({ name: 'Sem token e2e' })
        .expect(401);
    });
  });

  describe('GET /supplier', () => {
    it('lists the suppliers sorted by name', async () => {
      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({ name: 'Zz ultima e2e' })
        .expect(201);
      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({ name: 'Aa primeira e2e' })
        .expect(201);

      const res = await request(server())
        .get('/supplier')
        .set('Authorization', bearer(owner))
        .expect(200);

      const names = (res.body as SupplierBody[]).map(s => s.name);
      expect(names.indexOf('Aa primeira e2e')).toBeLessThan(
        names.indexOf('Zz ultima e2e'),
      );
    });

    it('searches by name', async () => {
      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({ name: 'Buscavel e2e' })
        .expect(201);

      const res = await request(server())
        .get('/supplier')
        .set('Authorization', bearer(owner))
        .query({ search: 'Buscavel' })
        .expect(200);

      const names = (res.body as SupplierBody[]).map(s => s.name);
      expect(names).toContain('Buscavel e2e');
      expect(names.every(name => name.includes('Buscavel'))).toBe(true);
    });

    it("does not return another user's suppliers (isolation — ADR-11)", async () => {
      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(other))
        .send({ name: 'Do outro usuario e2e' })
        .expect(201);

      const res = await request(server())
        .get('/supplier')
        .set('Authorization', bearer(owner))
        .expect(200);

      const names = (res.body as SupplierBody[]).map(s => s.name);
      expect(names).not.toContain('Do outro usuario e2e');
    });

    it('rejects a userId in the query (400)', async () => {
      await request(server())
        .get('/supplier')
        .set('Authorization', bearer(owner))
        .query({ userId: otherId })
        .expect(400);
    });

    it('requires a token (401)', async () => {
      await request(server()).get('/supplier').expect(401);
    });
  });
});
