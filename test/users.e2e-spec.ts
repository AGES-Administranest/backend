import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { body, createTestApp, resetDatabase } from './helpers/test-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * The reference module end to end: controller, service, repository, the global
 * ValidationPipe and AllExceptionsFilter, against a real Postgres.
 *
 * It is the module the README tells people to copy, so the behaviour they will
 * copy is worth pinning — including the two places where it is currently wrong
 * (see the soft-delete case at the bottom).
 */
describe('users (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;

  const ana = {
    name: 'Ana Souza',
    email: 'ana@example.com',
    cognitoSub: 'sub-ana',
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    http = app.getHttpServer() as App;
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(async () => {
    await app.close();
  });

  const create = (payload: Record<string, unknown>) =>
    request(http).post('/users').send(payload);

  describe('POST /users', () => {
    it('creates a user', async () => {
      const response = await create(ana).expect(201);

      expect(body(response)).toMatchObject({
        name: 'Ana Souza',
        email: 'ana@example.com',
        cognitoSub: 'sub-ana',
        deletedAt: null,
      });
      expect(body(response).id).toEqual(expect.any(String));
    });

    it('conflicts on a duplicate e-mail', async () => {
      await create(ana).expect(201);

      const response = await create({ ...ana, cognitoSub: 'sub-other' }).expect(
        409,
      );

      expect(body(response)).toMatchObject({
        code: 'USER_EMAIL_ALREADY_REGISTERED',
      });
    });

    it('conflicts on a duplicate cognitoSub', async () => {
      await create(ana).expect(201);

      // Same code as the e-mail case today. Worth pinning: if a distinct code
      // is ever introduced, this test is what makes the change deliberate.
      await create({ ...ana, email: 'other@example.com' }).expect(409);
    });

    it('rejects an invalid e-mail, naming the field', async () => {
      const response = await create({ ...ana, email: 'not-an-email' }).expect(
        400,
      );

      expect(body(response)).toMatchObject({ code: 'VALIDATION_ERROR' });
      const details = body(response).details as { fields: string[] };
      expect(details.fields.join(' ')).toContain('email');
    });

    it('rejects a field that is not in the DTO instead of dropping it', async () => {
      await create({ ...ana, isAdmin: true }).expect(400);
    });

    it('rejects a name below the minimum length', async () => {
      await create({ ...ana, name: 'A' }).expect(400);
    });
  });

  describe('GET /users', () => {
    it('lists newest first', async () => {
      await create(ana).expect(201);
      await create({
        name: 'Bruno Lima',
        email: 'bruno@example.com',
        cognitoSub: 'sub-bruno',
      }).expect(201);

      const response = await request(http).get('/users').expect(200);
      const users = response.body as { email: string }[];

      expect(users).toHaveLength(2);
      expect(users[0].email).toBe('bruno@example.com');
    });

    it('is an empty list, not a 404, when there is nobody', async () => {
      const response = await request(http).get('/users').expect(200);
      expect(response.body).toEqual([]);
    });
  });

  describe('GET /users/:id', () => {
    it('returns the user', async () => {
      const created = await create(ana).expect(201);
      const id = body(created).id as string;

      const response = await request(http).get(`/users/${id}`).expect(200);
      expect(body(response).email).toBe('ana@example.com');
    });

    it('answers 404 for an id that does not exist', async () => {
      const response = await request(http)
        .get('/users/6f3b7c1e-0000-4000-8000-000000000000')
        .expect(404);

      expect(body(response)).toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });

    it('answers 400 for an id that is not a uuid', async () => {
      // ParseUUIDPipe throws before the service is ever reached; the filter
      // still shapes it like every other error.
      const response = await request(http).get('/users/not-a-uuid').expect(400);
      expect(body(response).code).toBe('INVALID_REQUEST');
    });
  });

  describe('PATCH /users/:id', () => {
    it('updates only what was sent', async () => {
      const created = await create(ana).expect(201);
      const id = body(created).id as string;

      const response = await request(http)
        .patch(`/users/${id}`)
        .send({ name: 'Ana S. Souza' })
        .expect(200);

      expect(body(response).name).toBe('Ana S. Souza');
      expect(body(response).email).toBe('ana@example.com');
    });

    it('answers 404 for an id that does not exist', async () => {
      const response = await request(http)
        .patch('/users/6f3b7c1e-0000-4000-8000-000000000000')
        .send({ name: 'Ghost' })
        .expect(404);

      expect(body(response).code).toBe('USER_NOT_FOUND');
    });

    it('conflicts when the new e-mail belongs to someone else', async () => {
      await create(ana).expect(201);
      const other = await create({
        name: 'Bruno Lima',
        email: 'bruno@example.com',
        cognitoSub: 'sub-bruno',
      }).expect(201);

      const response = await request(http)
        .patch(`/users/${body(other).id as string}`)
        .send({ email: ana.email })
        .expect(409);

      expect(body(response).code).toBe('USER_EMAIL_ALREADY_REGISTERED');
    });
  });

  describe('DELETE /users/:id', () => {
    it('removes the user and answers 204', async () => {
      const created = await create(ana).expect(201);
      const id = body(created).id as string;

      await request(http).delete(`/users/${id}`).expect(204);
      await request(http).get(`/users/${id}`).expect(404);
    });

    it('answers 404 for an id that does not exist', async () => {
      const response = await request(http)
        .delete('/users/6f3b7c1e-0000-4000-8000-000000000000')
        .expect(404);

      expect(body(response).code).toBe('USER_NOT_FOUND');
    });

    it('deletes the row for real, despite the model having deleted_at', async () => {
      // Documenting the known gap, not endorsing it: every model carries
      // `deleted_at`, but this repository still issues a hard DELETE. When soft
      // delete lands, this test is the one that must change — and it will fail
      // loudly rather than letting the behaviour drift silently.
      const created = await create(ana).expect(201);
      const id = body(created).id as string;

      await request(http).delete(`/users/${id}`).expect(204);

      expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
      expect(await prisma.user.count()).toBe(0);
    });
  });
});
