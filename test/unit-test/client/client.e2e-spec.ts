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

interface ClientBody {
  id: string;
  type: 'CLINIC' | 'INDIVIDUAL';
  name: string;
  city?: string | null;
}

describe('Client (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let otherId: string;

  const owner: TestUser = {
    cognitoSub: `e2e-client-${randomUUID()}`,
    email: `e2e-client-${randomUUID()}@example.com`,
    name: 'E2E Client Tester',
  };

  const other: TestUser = {
    cognitoSub: `e2e-client-other-${randomUUID()}`,
    email: `e2e-client-other-${randomUUID()}@example.com`,
    name: 'Other',
  };

  const server = () => app.getHttpServer();

  const createClient = async (
    user: TestUser,
    body: Record<string, unknown>,
  ): Promise<ClientBody> => {
    const res = await request(server())
      .post('/client')
      .set('Authorization', bearer(user))
      .send(body)
      .expect(201);
    return res.body as ClientBody;
  };

  const list = async (query: Record<string, string> = {}) => {
    const res = await request(server())
      .get('/client')
      .set('Authorization', bearer(owner))
      .query(query)
      .expect(200);
    return res.body as ClientBody[];
  };

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
    await prisma.client.deleteMany({
      where: { userId: { in: [userId, otherId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await app.close();
  });

  describe('POST /client', () => {
    it('creates a client (201) without leaking userId', async () => {
      const body = await createClient(owner, {
        type: 'CLINIC',
        name: 'Clinica criada e2e',
      });

      expect(body.id).toBeDefined();
      expect(body.type).toBe('CLINIC');
      expect(body).not.toHaveProperty('userId');
    });

    it('requires the type (400)', async () => {
      await request(server())
        .post('/client')
        .set('Authorization', bearer(owner))
        .send({ name: 'Sem tipo e2e' })
        .expect(400);
    });

    it('rejects an unknown type (400)', async () => {
      await request(server())
        .post('/client')
        .set('Authorization', bearer(owner))
        .send({ type: 'COMPANY', name: 'Tipo invalido e2e' })
        .expect(400);
    });

    it('rejects a duplicated name (409)', async () => {
      await createClient(owner, { type: 'INDIVIDUAL', name: 'Duplicado e2e' });

      await request(server())
        .post('/client')
        .set('Authorization', bearer(owner))
        .send({ type: 'INDIVIDUAL', name: 'Duplicado e2e' })
        .expect(409);
    });

    it('rejects a userId in the body (400) — the owner comes from the token', async () => {
      await request(server())
        .post('/client')
        .set('Authorization', bearer(owner))
        .send({ userId: otherId, type: 'CLINIC', name: 'Em nome do outro e2e' })
        .expect(400);
    });

    it('requires a token (401)', async () => {
      await request(server())
        .post('/client')
        .send({ type: 'CLINIC', name: 'Sem token e2e' })
        .expect(401);
    });
  });

  describe('GET /client', () => {
    beforeAll(async () => {
      await createClient(owner, { type: 'CLINIC', name: 'Filtro clinica e2e' });
      await createClient(owner, {
        type: 'INDIVIDUAL',
        name: 'Filtro pessoa e2e',
      });
      await createClient(other, { type: 'CLINIC', name: 'Do outro e2e' });
    });

    it('lists every type when no filter is given', async () => {
      const names = (await list()).map(c => c.name);

      expect(names).toEqual(
        expect.arrayContaining(['Filtro clinica e2e', 'Filtro pessoa e2e']),
      );
    });

    it('lists only clinics with type=CLINIC', async () => {
      const clients = await list({ type: 'CLINIC' });

      expect(clients.map(c => c.name)).toContain('Filtro clinica e2e');
      expect(clients.every(c => c.type === 'CLINIC')).toBe(true);
    });

    it('lists only individuals with type=INDIVIDUAL', async () => {
      const clients = await list({ type: 'INDIVIDUAL' });

      expect(clients.map(c => c.name)).toContain('Filtro pessoa e2e');
      expect(clients.every(c => c.type === 'INDIVIDUAL')).toBe(true);
    });

    it('rejects an unknown type (400)', async () => {
      await request(server())
        .get('/client')
        .set('Authorization', bearer(owner))
        .query({ type: 'COMPANY' })
        .expect(400);
    });

    it("does not return another user's clients (isolation — ADR-11)", async () => {
      const names = (await list()).map(c => c.name);

      expect(names).not.toContain('Do outro e2e');
    });

    it('requires a token (401)', async () => {
      await request(server()).get('/client').expect(401);
    });
  });

  describe('GET, PATCH and DELETE /client/:id', () => {
    it('finds a client by id', async () => {
      const created = await createClient(owner, {
        type: 'CLINIC',
        name: 'Busca por id e2e',
      });

      const res = await request(server())
        .get(`/client/${created.id}`)
        .set('Authorization', bearer(owner))
        .expect(200);

      expect((res.body as ClientBody).name).toBe('Busca por id e2e');
    });

    it('rejects an id that is not a UUID (400)', async () => {
      await request(server())
        .get('/client/not-a-uuid')
        .set('Authorization', bearer(owner))
        .expect(400);
    });

    it('updates a client', async () => {
      const created = await createClient(owner, {
        type: 'INDIVIDUAL',
        name: 'Atualizavel e2e',
      });

      const res = await request(server())
        .patch(`/client/${created.id}`)
        .set('Authorization', bearer(owner))
        .send({ city: 'Canoas' })
        .expect(200);

      const body = res.body as ClientBody;
      expect(body.city).toBe('Canoas');
      expect(body.name).toBe('Atualizavel e2e');
    });

    it("answers 404 for another user's client on every route", async () => {
      const foreign = await createClient(other, {
        type: 'CLINIC',
        name: 'Alheio e2e',
      });

      await request(server())
        .get(`/client/${foreign.id}`)
        .set('Authorization', bearer(owner))
        .expect(404);
      await request(server())
        .patch(`/client/${foreign.id}`)
        .set('Authorization', bearer(owner))
        .send({ city: 'Invadida' })
        .expect(404);
      await request(server())
        .delete(`/client/${foreign.id}`)
        .set('Authorization', bearer(owner))
        .expect(404);

      const untouched = await prisma.client.findUniqueOrThrow({
        where: { id: foreign.id },
      });
      expect(untouched.city).toBeNull();
      expect(untouched.deletedAt).toBeNull();
    });

    it('soft deletes a client and hides it everywhere afterwards', async () => {
      const created = await createClient(owner, {
        type: 'CLINIC',
        name: 'Excluivel e2e',
      });

      const res = await request(server())
        .delete(`/client/${created.id}`)
        .set('Authorization', bearer(owner))
        .expect(200);
      expect(res.body).toEqual({ id: created.id, name: 'Excluivel e2e' });

      const row = await prisma.client.findUniqueOrThrow({
        where: { id: created.id },
      });
      expect(row.active).toBe(false);
      expect(row.deletedAt).toBeInstanceOf(Date);

      await request(server())
        .get(`/client/${created.id}`)
        .set('Authorization', bearer(owner))
        .expect(404);
      await request(server())
        .patch(`/client/${created.id}`)
        .set('Authorization', bearer(owner))
        .send({ city: 'Canoas' })
        .expect(404);
      await request(server())
        .delete(`/client/${created.id}`)
        .set('Authorization', bearer(owner))
        .expect(404);
      expect((await list()).map(c => c.id)).not.toContain(created.id);
    });

    it('allows reusing the name of a deleted client', async () => {
      const created = await createClient(owner, {
        type: 'INDIVIDUAL',
        name: 'Nome reaproveitado e2e',
      });
      await request(server())
        .delete(`/client/${created.id}`)
        .set('Authorization', bearer(owner))
        .expect(200);

      await createClient(owner, {
        type: 'INDIVIDUAL',
        name: 'Nome reaproveitado e2e',
      });
    });
  });

  describe('tax id (CPF / CNPJ)', () => {
    const TOGETHER =
      'taxId and taxIdType must be sent together: both set, or both null to remove the tax id';

    const post = (user: TestUser, payload: Record<string, unknown>) =>
      request(server())
        .post('/client')
        .set('Authorization', bearer(user))
        .send(payload);

    const patch = (id: string, payload: Record<string, unknown>) =>
      request(server())
        .patch(`/client/${id}`)
        .set('Authorization', bearer(owner))
        .send(payload);

    const errorOf = (res: { body: unknown }) =>
      res.body as { code: string; details?: { fields: string[] } };

    const stored = (id: string) =>
      prisma.client.findUniqueOrThrow({ where: { id } });

    it('stores a CNPJ sent as digits only', async () => {
      const created = await createClient(owner, {
        type: 'CLINIC',
        name: 'CNPJ valido e2e',
        taxId: '11222333000181',
        taxIdType: 'CNPJ',
      });

      const row = await stored(created.id);
      expect(row.taxId).toBe('11222333000181');
      expect(row.taxIdType).toBe('CNPJ');
    });

    it('rejects a punctuated CNPJ (400) and says what it expects', async () => {
      const res = await post(owner, {
        type: 'CLINIC',
        name: 'CNPJ pontuado e2e',
        taxId: '11.222.333/0001-81',
        taxIdType: 'CNPJ',
      }).expect(400);

      expect(errorOf(res).code).toBe('VALIDATION_ERROR');
      expect(errorOf(res).details?.fields).toEqual([
        'taxId must have exactly 14 digits, with no punctuation, when taxIdType is CNPJ',
      ]);
    });

    it('rejects a CPF with the wrong number of digits (400)', async () => {
      const res = await post(owner, {
        type: 'INDIVIDUAL',
        name: 'CPF curto e2e',
        taxId: '1234567890',
        taxIdType: 'CPF',
      }).expect(400);

      expect(errorOf(res).details?.fields).toEqual([
        'taxId must have exactly 11 digits, with no punctuation, when taxIdType is CPF',
      ]);
    });

    it('rejects a tax id sent without its type (400)', async () => {
      const res = await post(owner, {
        type: 'CLINIC',
        name: 'CNPJ sem tipo e2e',
        taxId: '11222333000181',
      }).expect(400);

      expect(errorOf(res).details?.fields).toEqual([TOGETHER]);
    });

    it('rejects a CNPJ the owner already registered (409)', async () => {
      await createClient(owner, {
        type: 'CLINIC',
        name: 'Primeira com o CNPJ e2e',
        taxId: '22333444000192',
        taxIdType: 'CNPJ',
      });

      const res = await post(owner, {
        type: 'CLINIC',
        name: 'Segunda com o CNPJ e2e',
        taxId: '22333444000192',
        taxIdType: 'CNPJ',
      }).expect(409);

      expect(errorOf(res).code).toBe('DUPLICATED_CLIENT_TAX_ID');
    });

    it('lets another user register the same CNPJ (isolation — ADR-11)', async () => {
      await createClient(owner, {
        type: 'CLINIC',
        name: 'Clinica compartilhada e2e',
        taxId: '33444555000103',
        taxIdType: 'CNPJ',
      });

      await createClient(other, {
        type: 'CLINIC',
        name: 'Clinica compartilhada e2e',
        taxId: '33444555000103',
        taxIdType: 'CNPJ',
      });
    });

    it('frees the tax id of a deleted client', async () => {
      const first = await createClient(owner, {
        type: 'CLINIC',
        name: 'CNPJ liberado e2e',
        taxId: '44555666000114',
        taxIdType: 'CNPJ',
      });
      await request(server())
        .delete(`/client/${first.id}`)
        .set('Authorization', bearer(owner))
        .expect(200);

      await createClient(owner, {
        type: 'CLINIC',
        name: 'CNPJ recadastrado e2e',
        taxId: '44555666000114',
        taxIdType: 'CNPJ',
      });
    });

    it('rejects giving a client a CPF another of the owner’s clients holds (409)', async () => {
      await createClient(owner, {
        type: 'INDIVIDUAL',
        name: 'Dono do CPF e2e',
        taxId: '12345678909',
        taxIdType: 'CPF',
      });
      const second = await createClient(owner, {
        type: 'INDIVIDUAL',
        name: 'Quer o mesmo CPF e2e',
      });

      const res = await patch(second.id, {
        taxId: '12345678909',
        taxIdType: 'CPF',
      }).expect(409);

      expect(errorOf(res).code).toBe('DUPLICATED_CLIENT_TAX_ID');
      expect((await stored(second.id)).taxId).toBeNull();
    });

    it('saves a client again with its own tax id', async () => {
      const created = await createClient(owner, {
        type: 'CLINIC',
        name: 'Mantem o CNPJ e2e',
        taxId: '55666777000125',
        taxIdType: 'CNPJ',
      });

      await patch(created.id, {
        taxId: '55666777000125',
        taxIdType: 'CNPJ',
        city: 'Canoas',
      }).expect(200);
    });

    it('removes the tax id when both fields are sent as null', async () => {
      const created = await createClient(owner, {
        type: 'CLINIC',
        name: 'Remove o CNPJ e2e',
        taxId: '66777888000136',
        taxIdType: 'CNPJ',
      });

      await patch(created.id, { taxId: null, taxIdType: null }).expect(200);

      const row = await stored(created.id);
      expect(row.taxId).toBeNull();
      expect(row.taxIdType).toBeNull();
    });

    it('rejects a lone taxId: null, which would leave the type behind (400)', async () => {
      const created = await createClient(owner, {
        type: 'CLINIC',
        name: 'CNPJ pela metade e2e',
        taxId: '77888999000147',
        taxIdType: 'CNPJ',
      });

      const res = await patch(created.id, { taxId: null }).expect(400);

      expect(errorOf(res).details?.fields).toEqual([TOGETHER]);
      expect((await stored(created.id)).taxId).toBe('77888999000147');
    });
  });
});
