import { INestApplication } from '@nestjs/common';
import { EntryNature, EntryScope } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

import { ensureDefaultFinancialCategories } from './helpers/default-financial-categories';
import {
  bearer,
  createTestApp,
  mintTokens,
  TestUser,
} from './helpers/test-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';

interface CategoryBody {
  id: string;
  name: string;
  nature: EntryNature;
  defaultScope: EntryScope;
}

describe('Financial categories (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let otherId: string;

  const owner: TestUser = {
    cognitoSub: `e2e-fin-cat-${randomUUID()}`,
    email: `e2e-fin-cat-${randomUUID()}@example.com`,
    name: 'E2E Financial Categories',
  };

  const other: TestUser = {
    cognitoSub: `e2e-fin-cat-other-${randomUUID()}`,
    email: `e2e-fin-cat-other-${randomUUID()}@example.com`,
    name: 'Other',
  };

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await ensureDefaultFinancialCategories(prisma);
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
  });

  afterAll(async () => {
    await prisma.financialCategory.deleteMany({
      where: { userId: { in: [userId, otherId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    await app.close();
  });

  it('returns active defaults and the user category, not another user or an inactive one', async () => {
    await prisma.financialCategory.create({
      data: {
        userId,
        name: 'Mine',
        nature: EntryNature.EXPENSE,
        defaultScope: EntryScope.PERSONAL,
      },
    });
    await prisma.financialCategory.create({
      data: {
        userId,
        name: 'Hidden',
        nature: EntryNature.EXPENSE,
        defaultScope: EntryScope.PERSONAL,
        active: false,
      },
    });
    await prisma.financialCategory.create({
      data: {
        userId: otherId,
        name: 'Theirs',
        nature: EntryNature.EXPENSE,
        defaultScope: EntryScope.PERSONAL,
      },
    });

    const res = await request(server())
      .get('/financial-categories')
      .set('Authorization', bearer(owner))
      .expect(200);

    const body = res.body as CategoryBody[];
    const names = body.map(category => category.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Professional fees',
        'Supplies',
        'Travel',
        'Taxes and fees',
        'Fixed costs',
        'Other',
        'Mine',
      ]),
    );
    expect(names).not.toContain('Hidden');
    expect(names).not.toContain('Theirs');
    expect(body.every(category => !('userId' in category))).toBe(true);
    expect(body.filter(category => category.name === 'Other')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nature: EntryNature.EXPENSE,
          defaultScope: EntryScope.PROFESSIONAL,
        }),
        expect.objectContaining({
          nature: EntryNature.INCOME,
          defaultScope: EntryScope.PERSONAL,
        }),
      ]),
    );
  });

  it('filters by nature', async () => {
    const res = await request(server())
      .get('/financial-categories')
      .query({ nature: EntryNature.INCOME })
      .set('Authorization', bearer(owner))
      .expect(200);

    const body = res.body as CategoryBody[];
    expect(body.every(category => category.nature === EntryNature.INCOME)).toBe(
      true,
    );
    expect(body.map(category => category.name)).toEqual(
      expect.arrayContaining(['Professional fees', 'Other']),
    );
    expect(body.map(category => category.name)).not.toContain('Supplies');
  });
});
