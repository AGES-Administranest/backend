import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

import { PrismaService } from '../../../src/infra/prisma/prisma.service';
import {
  bearer,
  body,
  createTestApp,
  mintTokens,
  TestUser,
} from '../../helpers/test-app';

interface SupplierBody {
  id: string;
  name: string;
  taxId?: string | null;
  email?: string | null;
  notes?: string | null;
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
    await prisma.purchaseInvoice.deleteMany({
      where: { userId: { in: [userId, otherId] } },
    });
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
        .send({
          name: 'Distribuidora e2e',
          email: 'vendas@e2e.com.br',
          taxId: '11.222.333/0001-81',
          taxIdType: 'CNPJ',
          notes: 'Order monthly',
        })
        .expect(201);

      const body = res.body as SupplierBody;
      expect(body.id).toBeDefined();
      expect(body.email).toBe('vendas@e2e.com.br');
      expect(body.taxId).toBe('11222333000181');
      expect(body.notes).toBe('Order monthly');
      expect(body).not.toHaveProperty('userId');
    });

    it('allows suppliers with the same name', async () => {
      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({ name: 'Same supplier name e2e' })
        .expect(201);

      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({ name: 'Same supplier name e2e' })
        .expect(201);
    });

    it('rejects a duplicate CNPJ after normalizing its mask', async () => {
      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({
          name: 'First CNPJ supplier e2e',
          taxId: '22.333.444/0001-81',
          taxIdType: 'CNPJ',
        })
        .expect(201);

      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({
          name: 'Second CNPJ supplier e2e',
          taxId: '22333444000181',
          taxIdType: 'CNPJ',
        })
        .expect(409);

      await request(server())
        .post('/supplier')
        .set('Authorization', bearer(other))
        .send({
          name: 'Other user CNPJ supplier e2e',
          taxId: '22333444000181',
          taxIdType: 'CNPJ',
        })
        .expect(201);
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

  describe('GET/PATCH/DELETE /supplier/:id', () => {
    const createSupplier = async (name: string) => {
      const response = await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({ name })
        .expect(201);
      return (response.body as SupplierBody).id;
    };

    it('reads and updates an owned supplier', async () => {
      const id = await createSupplier('Editable supplier e2e');

      const read = await request(server())
        .get(`/supplier/${id}`)
        .set('Authorization', bearer(owner))
        .expect(200);
      expect(read.body).toMatchObject({ id, active: true });
      expect(read.body).not.toHaveProperty('userId');

      const updated = await request(server())
        .patch(`/supplier/${id}`)
        .set('Authorization', bearer(owner))
        .send({ name: 'Updated supplier e2e', notes: 'Updated notes' })
        .expect(200);
      expect(updated.body).toMatchObject({
        id,
        name: 'Updated supplier e2e',
        notes: 'Updated notes',
      });
    });

    it('returns 404 for another user supplier on read, update and inactivation', async () => {
      const response = await request(server())
        .post('/supplier')
        .set('Authorization', bearer(other))
        .send({ name: 'Private supplier e2e' })
        .expect(201);
      const id = (response.body as SupplierBody).id;

      await request(server())
        .get(`/supplier/${id}`)
        .set('Authorization', bearer(owner))
        .expect(404);
      await request(server())
        .patch(`/supplier/${id}`)
        .set('Authorization', bearer(owner))
        .send({ name: 'Attempted update' })
        .expect(404);
      await request(server())
        .delete(`/supplier/${id}`)
        .set('Authorization', bearer(owner))
        .expect(404);
    });

    it('inactivates idempotently and keeps the supplier readable by id', async () => {
      const id = await createSupplier('Inactive supplier e2e');

      const firstDelete = await request(server())
        .delete(`/supplier/${id}`)
        .set('Authorization', bearer(owner))
        .expect(200);
      expect(firstDelete.body).toMatchObject({ id, active: false });

      const secondDelete = await request(server())
        .delete(`/supplier/${id}`)
        .set('Authorization', bearer(owner))
        .expect(200);
      expect(secondDelete.body).toMatchObject({ id, active: false });

      const read = await request(server())
        .get(`/supplier/${id}`)
        .set('Authorization', bearer(owner))
        .expect(200);
      expect(read.body).toMatchObject({ id, active: false });

      const activeList = await request(server())
        .get('/supplier')
        .set('Authorization', bearer(owner))
        .expect(200);
      expect(
        (activeList.body as SupplierBody[]).some(
          supplier => supplier.id === id,
        ),
      ).toBe(false);

      const inactiveList = await request(server())
        .get('/supplier')
        .set('Authorization', bearer(owner))
        .query({ active: false })
        .expect(200);
      expect(
        (inactiveList.body as SupplierBody[]).some(
          supplier => supplier.id === id,
        ),
      ).toBe(true);
    });
  });

  describe('GET /supplier/:id/purchase-invoices', () => {
    const createSupplier = async (name: string) => {
      const response = await request(server())
        .post('/supplier')
        .set('Authorization', bearer(owner))
        .send({ name })
        .expect(201);
      return (response.body as SupplierBody).id;
    };

    const createInvoice = (
      supplierId: string,
      values: {
        issueDate: string;
        number: string;
        totalAmount: number;
        status?: 'CONFIRMED' | 'DRAFT' | 'CANCELLED';
      },
    ) =>
      prisma.purchaseInvoice.create({
        data: {
          userId,
          supplierId,
          issueDate: new Date(`${values.issueDate}T00:00:00.000Z`),
          number: values.number,
          totalAmount: values.totalAmount,
          status: values.status ?? 'CONFIRMED',
        },
      });

    it('lists confirmed invoices by issue date with inclusive filters and pagination, including inactive suppliers', async () => {
      const supplierId = await createSupplier('Invoice history supplier e2e');
      const februaryInvoice = await createInvoice(supplierId, {
        issueDate: '2026-02-01',
        number: '200',
        totalAmount: 34.5,
      });
      const marchInvoice = await createInvoice(supplierId, {
        issueDate: '2026-03-31',
        number: '300',
        totalAmount: 80,
      });
      await createInvoice(supplierId, {
        issueDate: '2026-04-01',
        number: '400',
        totalAmount: 99,
      });
      await createInvoice(supplierId, {
        issueDate: '2026-03-15',
        number: 'draft',
        totalAmount: 1,
        status: 'DRAFT',
      });
      await createInvoice(supplierId, {
        issueDate: '2026-03-20',
        number: 'cancelled',
        totalAmount: 2,
        status: 'CANCELLED',
      });

      await request(server())
        .delete(`/supplier/${supplierId}`)
        .set('Authorization', bearer(owner))
        .expect(200);

      const firstPage = await request(server())
        .get(`/supplier/${supplierId}/purchase-invoices`)
        .set('Authorization', bearer(owner))
        .query({ from: '2026-02-01', to: '2026-03-31', page: 1, limit: 1 })
        .expect(200);
      expect(body(firstPage)).toEqual([
        {
          id: marchInvoice.id,
          issueDate: '2026-03-31',
          number: '300',
          totalAmount: 80,
        },
      ]);

      const secondPage = await request(server())
        .get(`/supplier/${supplierId}/purchase-invoices`)
        .set('Authorization', bearer(owner))
        .query({ from: '2026-02-01', to: '2026-03-31', page: 2, limit: 1 })
        .expect(200);
      expect(body(secondPage)).toEqual([
        {
          id: februaryInvoice.id,
          issueDate: '2026-02-01',
          number: '200',
          totalAmount: 34.5,
        },
      ]);
    });

    it('does not expose another user supplier invoice history', async () => {
      const response = await request(server())
        .post('/supplier')
        .set('Authorization', bearer(other))
        .send({ name: 'Private invoice supplier e2e' })
        .expect(201);
      const supplierId = (response.body as SupplierBody).id;

      await request(server())
        .get(`/supplier/${supplierId}/purchase-invoices`)
        .set('Authorization', bearer(owner))
        .expect(404);
    });
  });
});
