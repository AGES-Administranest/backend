import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import {
  asUser,
  body,
  createTestApp,
  resetDatabase,
  TEST_USER_HEADER,
  TestUser,
} from './helpers/test-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * The provisioning endpoints against a real Postgres.
 *
 * The unit specs already cover the branching with a fake repository. What only
 * a real database can show is here: that the upsert is genuinely idempotent
 * under concurrency, that the unique indexes behave as the code assumes, and
 * that the columns the migration added actually persist what is written.
 */
describe('auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;

  const ana: TestUser = {
    cognitoSub: 'sub-ana',
    email: 'ana@example.com',
    name: 'Ana Souza',
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    http = app.getHttpServer() as App;
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(async () => {
    await app.close();
  });

  const countUsers = () => prisma.user.count();

  describe('POST /auth/session', () => {
    it('rejects a request with no authenticated user', async () => {
      const response = await request(http).post('/auth/session').expect(401);

      expect(body(response)).toMatchObject({ code: 'NAO_AUTENTICADO' });
      expect(await countUsers()).toBe(0);
    });

    it('creates the mirror on first login', async () => {
      const response = await request(http)
        .post('/auth/session')
        .set(TEST_USER_HEADER, asUser(ana))
        .expect(200);

      expect(body(response)).toMatchObject({
        cognitoSub: 'sub-ana',
        email: 'ana@example.com',
        name: 'Ana Souza',
        termsAcceptedAt: null,
        termsVersion: null,
      });
      expect(await countUsers()).toBe(1);
    });

    it('is idempotent across repeated logins', async () => {
      const first = await request(http)
        .post('/auth/session')
        .set(TEST_USER_HEADER, asUser(ana))
        .expect(200);

      const second = await request(http)
        .post('/auth/session')
        .set(TEST_USER_HEADER, asUser(ana))
        .expect(200);

      expect(body(second).id).toBe(body(first).id);
      expect(await countUsers()).toBe(1);
    });

    it('stays at one row when two logins race for the same new sub', async () => {
      // The reason the repository uses a single `upsert` instead of a read
      // followed by a write. A fake repository cannot fail this test.
      const responses = await Promise.all(
        Array.from({ length: 8 }, () =>
          request(http)
            .post('/auth/session')
            .set(TEST_USER_HEADER, asUser(ana)),
        ),
      );

      expect(await countUsers()).toBe(1);

      // Losing the race is retryable. What it must never be is the conflict
      // that tells the app a human has to intervene.
      for (const response of responses) {
        expect(body(response).code).not.toBe('USUARIO_EMAIL_JA_CADASTRADO');
      }
      expect(responses.some(r => r.status === 200)).toBe(true);
    });

    it('refreshes the mirrored e-mail from the token', async () => {
      await request(http)
        .post('/auth/session')
        .set(TEST_USER_HEADER, asUser(ana))
        .expect(200);

      const response = await request(http)
        .post('/auth/session')
        .set(
          TEST_USER_HEADER,
          asUser({ ...ana, email: 'ana.souza@example.com' }),
        )
        .expect(200);

      expect(body(response).email).toBe('ana.souza@example.com');
      expect(await countUsers()).toBe(1);
    });

    it('keeps the stored name when the token carries no name claim', async () => {
      await request(http)
        .post('/auth/session')
        .set(TEST_USER_HEADER, asUser(ana))
        .expect(200);

      const response = await request(http)
        .post('/auth/session')
        .set(
          TEST_USER_HEADER,
          asUser({ cognitoSub: ana.cognitoSub, email: ana.email }),
        )
        .expect(200);

      expect(body(response).name).toBe('Ana Souza');
    });

    it('falls back to the e-mail as name when creating without one', async () => {
      const response = await request(http)
        .post('/auth/session')
        .set(
          TEST_USER_HEADER,
          asUser({ cognitoSub: 'sub-bare', email: 'bare@example.com' }),
        )
        .expect(200);

      expect(body(response).name).toBe('bare@example.com');
    });

    it('conflicts when the e-mail already belongs to another sub', async () => {
      await request(http)
        .post('/auth/session')
        .set(TEST_USER_HEADER, asUser(ana))
        .expect(200);

      const response = await request(http)
        .post('/auth/session')
        .set(
          TEST_USER_HEADER,
          asUser({ cognitoSub: 'sub-other', email: ana.email, name: 'Other' }),
        )
        .expect(409);

      expect(body(response)).toMatchObject({
        code: 'USUARIO_EMAIL_JA_CADASTRADO',
      });
      expect(await countUsers()).toBe(1);
    });
  });

  describe('POST /auth/terms', () => {
    const accept = (user: TestUser, body: Record<string, unknown>) =>
      request(http)
        .post('/auth/terms')
        .set(TEST_USER_HEADER, asUser(user))
        .send(body);

    it('rejects a request with no authenticated user', async () => {
      const response = await request(http)
        .post('/auth/terms')
        .send({ termsVersion: '2026-09-01' })
        .expect(401);

      expect(body(response)).toMatchObject({ code: 'NAO_AUTENTICADO' });
    });

    it('answers 404 with its own code when the mirror does not exist', async () => {
      const response = await accept(ana, { termsVersion: '2026-09-01' }).expect(
        404,
      );

      expect(body(response)).toMatchObject({
        code: 'USUARIO_NAO_PROVISIONADO',
      });
    });

    it('persists the date and the version', async () => {
      await request(http)
        .post('/auth/session')
        .set(TEST_USER_HEADER, asUser(ana))
        .expect(200);

      const before = new Date();
      const response = await accept(ana, { termsVersion: '2026-09-01' }).expect(
        200,
      );

      expect(body(response).termsVersion).toBe('2026-09-01');

      const stored = await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: ana.cognitoSub },
      });
      expect(stored.termsVersion).toBe('2026-09-01');
      expect(stored.termsAcceptedAt).not.toBeNull();
      expect(stored.termsAcceptedAt!.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      );
      expect(stored.privacyAcceptedAt).toEqual(stored.termsAcceptedAt);
    });

    it('records the newer version when the text changes', async () => {
      await request(http)
        .post('/auth/session')
        .set(TEST_USER_HEADER, asUser(ana))
        .expect(200);

      await accept(ana, { termsVersion: '2026-09-01' }).expect(200);
      const response = await accept(ana, { termsVersion: '2027-01-15' }).expect(
        200,
      );

      expect(body(response).termsVersion).toBe('2027-01-15');
    });

    it('rejects a missing termsVersion with the shared error shape', async () => {
      await request(http)
        .post('/auth/session')
        .set(TEST_USER_HEADER, asUser(ana))
        .expect(200);

      const response = await accept(ana, {}).expect(400);

      expect(body(response)).toMatchObject({ code: 'VALIDACAO_INVALIDA' });
      const details = body(response).details as { fields: string[] };
      expect(details.fields.join(' ')).toContain('termsVersion');
    });

    it('rejects an unknown field instead of ignoring it', async () => {
      // `forbidNonWhitelisted` is what makes a typo in the app a loud 400
      // rather than a silently dropped value.
      await request(http)
        .post('/auth/session')
        .set(TEST_USER_HEADER, asUser(ana))
        .expect(200);

      const response = await accept(ana, {
        termsVersion: '2026-09-01',
        acceptedEverything: true,
      }).expect(400);

      expect(body(response)).toMatchObject({ code: 'VALIDACAO_INVALIDA' });
    });
  });

  describe('isolation between users', () => {
    it('never lets one account write consent onto another', async () => {
      const bruno: TestUser = {
        cognitoSub: 'sub-bruno',
        email: 'bruno@example.com',
        name: 'Bruno Lima',
      };

      for (const user of [ana, bruno]) {
        await request(http)
          .post('/auth/session')
          .set(TEST_USER_HEADER, asUser(user))
          .expect(200);
      }

      await request(http)
        .post('/auth/terms')
        .set(TEST_USER_HEADER, asUser(ana))
        .send({ termsVersion: '2026-09-01' })
        .expect(200);

      const stored = await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: bruno.cognitoSub },
      });
      expect(stored.termsAcceptedAt).toBeNull();
      expect(stored.termsVersion).toBeNull();
    });
  });
});
