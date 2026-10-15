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
  isDefault: boolean;
}

describe('Financial categories (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let otherId: string;
  let leavingId: string;

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

  const leaving: TestUser = {
    cognitoSub: `e2e-fin-cat-leaving-${randomUUID()}`,
    email: `e2e-fin-cat-leaving-${randomUUID()}@example.com`,
    name: 'Leaving',
  };

  const server = () => app.getHttpServer();

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await ensureDefaultFinancialCategories(prisma);
    await mintTokens([owner, other, leaving]);

    const provision = async (user: TestUser) => {
      const session = await request(server())
        .post('/auth/session')
        .set('Authorization', bearer(user))
        .expect(200);
      return (session.body as { id: string }).id;
    };
    userId = await provision(owner);
    otherId = await provision(other);
    leavingId = await provision(leaving);
  });

  afterAll(async () => {
    const ids = [userId, otherId, leavingId];
    // Entries, then categories, then users: each foreign key is RESTRICT.
    await prisma.financialEntry.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.financialCategory.deleteMany({
      where: { userId: { in: ids } },
    });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
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
    expect(body.find(category => category.name === 'Mine')).toMatchObject({
      isDefault: false,
    });
    expect(
      body
        .filter(category => category.name !== 'Mine')
        .every(category => category.isDefault),
    ).toBe(true);
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

  describe('POST /financial-categories', () => {
    const create = (payload: Record<string, unknown>, user = owner) =>
      request(server())
        .post('/financial-categories')
        .set('Authorization', bearer(user))
        .send(payload);

    const defaultId = async (name: string, nature: EntryNature) =>
      (
        await prisma.financialCategory.findFirstOrThrow({
          where: { userId: null, name, nature },
        })
      ).id;

    const streetFood = {
      id: randomUUID(),
      name: '  Comida   de rua ',
      nature: EntryNature.EXPENSE,
      defaultScope: EntryScope.PERSONAL,
    };

    it('creates a category of the caller and lists it as not default', async () => {
      const res = await create(streetFood).expect(201);

      expect(res.body).toEqual({
        id: streetFood.id,
        name: 'Comida de rua',
        nature: EntryNature.EXPENSE,
        defaultScope: EntryScope.PERSONAL,
        isDefault: false,
      });
      const stored = await prisma.financialCategory.findUniqueOrThrow({
        where: { id: streetFood.id },
      });
      expect(stored.userId).toBe(userId);

      const list = await request(server())
        .get('/financial-categories')
        .query({ nature: EntryNature.EXPENSE })
        .set('Authorization', bearer(owner))
        .expect(200);
      expect(list.body as CategoryBody[]).toContainEqual(res.body);
    });

    it('returns the same category when the same request is sent again', async () => {
      const res = await create(streetFood).expect(201);

      expect(res.body).toMatchObject({
        id: streetFood.id,
        name: 'Comida de rua',
      });
      expect(
        await prisma.financialCategory.count({
          where: { userId, name: 'Comida de rua' },
        }),
      ).toBe(1);
    });

    it('lets an entry use the new category', async () => {
      await request(server())
        .post('/financial-entries')
        .set('Authorization', bearer(owner))
        .send({
          id: randomUUID(),
          nature: EntryNature.EXPENSE,
          description: 'Lunch',
          amount: 32.5,
          accrualDate: new Date().toISOString(),
          categoryId: streetFood.id,
        })
        .expect(201);
    });

    it.each(['comida de rua', 'COMIDA DE RÚA', ' Comída  de Rua'])(
      'refuses %j and points at the category that already has the name',
      async name => {
        const res = await create({
          ...streetFood,
          id: randomUUID(),
          name,
        }).expect(409);

        expect(res.body).toMatchObject({
          code: 'FINANCIAL_CATEGORY_DUPLICATED',
          details: { id: streetFood.id },
        });
      },
    );

    it('refuses the name of a default of the same nature', async () => {
      const res = await create({
        ...streetFood,
        id: randomUUID(),
        name: 'other',
      }).expect(409);

      expect(res.body).toMatchObject({
        code: 'FINANCIAL_CATEGORY_DUPLICATED',
        details: { id: await defaultId('Other', EntryNature.EXPENSE) },
      });
    });

    it('accepts the same name in the other nature', async () => {
      const res = await create({
        ...streetFood,
        id: randomUUID(),
        nature: EntryNature.INCOME,
      }).expect(201);

      expect(res.body).toMatchObject({
        nature: EntryNature.INCOME,
        isDefault: false,
      });
    });

    // Defaults are stored in English and translated only by the app, so the
    // server cannot tell that "Outros" is the default "Other". The app's
    // category field matches the translated label and never sends it.
    it('accepts "Outros", because defaults are compared by their stored names', async () => {
      await create({ ...streetFood, id: randomUUID(), name: 'Outros' }).expect(
        201,
      );
    });

    it('refuses an id that already belongs to another category', async () => {
      const res = await create({
        ...streetFood,
        name: 'Papelaria',
      }).expect(409);

      expect(res.body).toMatchObject({
        code: 'FINANCIAL_CATEGORY_ID_CONFLICT',
      });
    });

    it('refuses the id of a default', async () => {
      const res = await create({
        ...streetFood,
        id: await defaultId('Supplies', EntryNature.EXPENSE),
        name: 'Supplies',
      }).expect(409);

      expect(res.body).toMatchObject({
        code: 'FINANCIAL_CATEGORY_ID_CONFLICT',
      });
    });

    it.each([
      ['an empty name', { name: '' }],
      ['a name with only spaces', { name: '    ' }],
      ['a name over 40 characters', { name: 'a'.repeat(41) }],
      ['an id that is not a UUID', { id: 'category-1' }],
      ['an unknown nature', { nature: 'TRANSFER' }],
      ['an unknown scope', { defaultScope: 'SHARED' }],
      ['an owner in the body', { userId: randomUUID() }],
    ])('answers 400 for %s', async (_case, overrides) => {
      const res = await create({
        ...streetFood,
        id: randomUUID(),
        name: 'Valid name',
        ...overrides,
      }).expect(400);

      expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it('answers 401 without a token', async () => {
      const res = await request(server())
        .post('/financial-categories')
        .send({ ...streetFood, id: randomUUID(), name: 'No token' })
        .expect(401);

      expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('refuses to delete a user who owns a category, so it never becomes a default', async () => {
      const id = randomUUID();
      await create(
        { ...streetFood, id, name: 'Kept by its owner' },
        leaving,
      ).expect(201);

      // With ON DELETE SET NULL the delete went through and the category
      // turned into a default (user_id NULL) that every other user saw.
      await expect(
        prisma.user.delete({ where: { id: leavingId } }),
      ).rejects.toMatchObject({
        code: 'P2003',
        message: expect.stringContaining(
          'financial_category_user_id_fkey',
        ) as string,
      });

      const stored = await prisma.financialCategory.findUniqueOrThrow({
        where: { id },
      });
      expect(stored.userId).toBe(leavingId);

      // Category first, then the user, which nothing holds back any more.
      await prisma.financialCategory.delete({ where: { id } });
      await prisma.user.delete({ where: { id: leavingId } });
    });
  });
});
