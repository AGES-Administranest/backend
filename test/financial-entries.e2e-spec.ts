import { INestApplication } from '@nestjs/common';
import { EntryNature, EntryScope, EntrySource } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

import {
  bearer,
  createTestApp,
  mintTokens,
  TestUser,
} from './helpers/test-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';

interface EntryBody {
  id: string;
  description: string;
  source: EntrySource;
  origin: { type: EntrySource; id: string | null };
  category: { id: string; name: string };
}

describe('Financial entries (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let otherId: string;
  let categoryId: string;

  const owner: TestUser = {
    cognitoSub: `e2e-fin-entry-${randomUUID()}`,
    email: `e2e-fin-entry-${randomUUID()}@example.com`,
    name: 'E2E Financial Entries',
  };

  const other: TestUser = {
    cognitoSub: `e2e-fin-entry-other-${randomUUID()}`,
    email: `e2e-fin-entry-other-${randomUUID()}@example.com`,
    name: 'Other',
  };

  const server = () => app.getHttpServer();
  const now = new Date();
  const thisMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 10),
  );
  const earlier = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 2),
  );
  const lastMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10),
  );

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await mintTokens([owner, other]);

    const provision = async (user: TestUser) => {
      const session = await request(server())
        .post('/auth/session')
        .set('Authorization', bearer(user))
        .expect(200);
      return (session.body as { id: string }).id;
    };
    userId = await provision(owner);
    otherId = await provision(other);

    const category = await prisma.financialCategory.findFirstOrThrow({
      where: { userId: null, name: 'Professional fees' },
    });
    categoryId = category.id;

    await prisma.financialEntry.createMany({
      data: [
        {
          userId,
          nature: EntryNature.INCOME,
          scope: EntryScope.PROFESSIONAL,
          categoryId,
          description: 'Newer',
          amount: '20.00',
          accrualDate: thisMonth,
          source: EntrySource.MANUAL,
        },
        {
          userId,
          nature: EntryNature.INCOME,
          scope: EntryScope.PROFESSIONAL,
          categoryId,
          description: 'Older',
          amount: '10.00',
          accrualDate: earlier,
          source: EntrySource.MANUAL,
        },
        {
          userId,
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PERSONAL,
          categoryId,
          description: 'Last month',
          amount: '5.00',
          accrualDate: lastMonth,
          source: EntrySource.MANUAL,
        },
        {
          userId,
          nature: EntryNature.INCOME,
          scope: EntryScope.PROFESSIONAL,
          categoryId,
          description: 'Deleted',
          amount: '7.00',
          accrualDate: thisMonth,
          source: EntrySource.MANUAL,
          deletedAt: new Date(),
        },
        {
          userId: otherId,
          nature: EntryNature.INCOME,
          scope: EntryScope.PROFESSIONAL,
          categoryId,
          description: 'Theirs',
          amount: '9.00',
          accrualDate: thisMonth,
          source: EntrySource.MANUAL,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.financialEntry.deleteMany({
      where: { userId: { in: [userId, otherId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await app.close();
  });

  it('lists the current month for the authenticated user, newest first', async () => {
    const res = await request(server())
      .get('/financial-entries')
      .set('Authorization', bearer(owner))
      .expect(200);

    const body = res.body as EntryBody[];
    expect(body.map(entry => entry.description)).toEqual(['Newer', 'Older']);
    expect(body[0].origin).toEqual({ type: EntrySource.MANUAL, id: null });
    expect(body[0].category.id).toBe(categoryId);
    expect(body[0]).not.toHaveProperty('userId');
  });

  it('pages forward and filters by nature', async () => {
    const page = await request(server())
      .get('/financial-entries')
      .query({ page: 2, limit: 1, nature: EntryNature.INCOME })
      .set('Authorization', bearer(owner))
      .expect(200);

    expect((page.body as EntryBody[]).map(entry => entry.description)).toEqual([
      'Older',
    ]);
  });

  it('creates a manual entry, replays the same id, updates it and deletes it', async () => {
    const id = randomUUID();
    const payload = {
      id,
      nature: EntryNature.INCOME,
      description: 'Manual',
      amount: 15.5,
      accrualDate: thisMonth.toISOString(),
      categoryId,
    };

    const created = await request(server())
      .post('/financial-entries')
      .set('Authorization', bearer(owner))
      .send(payload)
      .expect(201);
    expect((created.body as EntryBody).origin).toEqual({
      type: EntrySource.MANUAL,
      id: null,
    });
    expect((created.body as EntryBody & { scope: string }).scope).toBe(
      EntryScope.PROFESSIONAL,
    );

    const replay = await request(server())
      .post('/financial-entries')
      .set('Authorization', bearer(owner))
      .send(payload)
      .expect(201);
    expect((replay.body as EntryBody).id).toBe(id);

    const patched = await request(server())
      .patch(`/financial-entries/${id}`)
      .set('Authorization', bearer(owner))
      .send({ description: 'Manual edited' })
      .expect(200);
    expect((patched.body as EntryBody).description).toBe('Manual edited');

    await request(server())
      .delete(`/financial-entries/${id}`)
      .set('Authorization', bearer(owner))
      .expect(204);

    const listed = await request(server())
      .get('/financial-entries')
      .set('Authorization', bearer(owner))
      .expect(200);
    expect((listed.body as EntryBody[]).map(entry => entry.id)).not.toContain(
      id,
    );
  });

  it('rejects a non-positive amount and a category of the wrong nature', async () => {
    await request(server())
      .post('/financial-entries')
      .set('Authorization', bearer(owner))
      .send({
        id: randomUUID(),
        nature: EntryNature.INCOME,
        description: 'Bad',
        amount: 0,
        accrualDate: thisMonth.toISOString(),
        categoryId,
      })
      .expect(400);

    const mismatch = await request(server())
      .post('/financial-entries')
      .set('Authorization', bearer(owner))
      .send({
        id: randomUUID(),
        nature: EntryNature.EXPENSE,
        description: 'Wrong category',
        amount: 10,
        accrualDate: thisMonth.toISOString(),
        categoryId,
      })
      .expect(400);
    expect(mismatch.body).toMatchObject({ code: 'FINANCIAL_CATEGORY_INVALID' });
  });
});
