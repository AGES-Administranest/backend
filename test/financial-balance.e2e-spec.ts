import { INestApplication } from '@nestjs/common';
import { EntryNature, EntryScope, EntrySource } from '@prisma/client';
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

interface BalanceBody {
  totalIncome: string;
  totalExpenses: string;
  professionalExpenses: string;
  personalExpenses: string;
  netBalance: string;
  expensesByCategory: {
    items: { category: string; subtotal: string }[];
    total: string;
  };
}

describe('Financial balance (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let otherId: string;
  let emptyId: string;
  let ids: Record<string, string>;

  const owner: TestUser = {
    cognitoSub: `e2e-fin-bal-${randomUUID()}`,
    email: `e2e-fin-bal-${randomUUID()}@example.com`,
    name: 'E2E Financial Balance',
  };
  const other: TestUser = {
    cognitoSub: `e2e-fin-bal-other-${randomUUID()}`,
    email: `e2e-fin-bal-other-${randomUUID()}@example.com`,
    name: 'Other',
  };
  const empty: TestUser = {
    cognitoSub: `e2e-fin-bal-empty-${randomUUID()}`,
    email: `e2e-fin-bal-empty-${randomUUID()}@example.com`,
    name: 'Empty',
  };

  const server = () => app.getHttpServer();
  const balance = async (user: TestUser, query: object = {}) =>
    (
      await request(server())
        .get('/financial-balance')
        .query(query)
        .set('Authorization', bearer(user))
        .expect(200)
    ).body as BalanceBody;

  const entry = (
    ownerId: string,
    categoryId: string,
    nature: EntryNature,
    scope: EntryScope,
    amount: string,
    accrualDate: string,
    extra: object = {},
  ) => ({
    userId: ownerId,
    nature,
    scope,
    categoryId,
    description: 'Entry',
    amount,
    accrualDate: new Date(accrualDate),
    source: EntrySource.MANUAL,
    ...extra,
  });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await ensureDefaultFinancialCategories(prisma);
    await mintTokens([owner, other, empty]);

    const provision = async (user: TestUser) => {
      const session = await request(server())
        .post('/auth/session')
        .set('Authorization', bearer(user))
        .expect(200);
      return (session.body as { id: string }).id;
    };
    userId = await provision(owner);
    otherId = await provision(other);
    emptyId = await provision(empty);

    const named = async (name: string, nature: EntryNature) =>
      (
        await prisma.financialCategory.findFirstOrThrow({
          where: { userId: null, name, nature },
        })
      ).id;

    ids = {
      fees: await named('Professional fees', EntryNature.INCOME),
      supplies: await named('Supplies', EntryNature.EXPENSE),
      travel: await named('Travel', EntryNature.EXPENSE),
      taxes: await named('Taxes and fees', EntryNature.EXPENSE),
      fixed: await named('Fixed costs', EntryNature.EXPENSE),
      other: await named('Other', EntryNature.EXPENSE),
    };

    const custom = await prisma.financialCategory.create({
      data: {
        userId,
        name: 'Custom',
        nature: EntryNature.EXPENSE,
        defaultScope: EntryScope.PERSONAL,
      },
    });

    await prisma.financialEntry.createMany({
      data: [
        entry(
          userId,
          ids.fees,
          EntryNature.INCOME,
          EntryScope.PROFESSIONAL,
          '1000.00',
          '2026-03-10T12:00Z',
        ),
        entry(
          userId,
          ids.supplies,
          EntryNature.EXPENSE,
          EntryScope.PROFESSIONAL,
          '100.10',
          '2026-03-12T12:00Z',
        ),
        entry(
          userId,
          ids.travel,
          EntryNature.EXPENSE,
          EntryScope.PROFESSIONAL,
          '40.00',
          '2026-03-15T12:00Z',
        ),
        entry(
          userId,
          ids.fixed,
          EntryNature.EXPENSE,
          EntryScope.PROFESSIONAL,
          '30.00',
          '2026-03-20T12:00Z',
        ),
        entry(
          userId,
          ids.taxes,
          EntryNature.EXPENSE,
          EntryScope.PERSONAL,
          '20.00',
          '2026-03-22T12:00Z',
        ),
        entry(
          userId,
          ids.other,
          EntryNature.EXPENSE,
          EntryScope.PROFESSIONAL,
          '4.00',
          '2026-03-25T12:00Z',
        ),
        entry(
          userId,
          custom.id,
          EntryNature.EXPENSE,
          EntryScope.PERSONAL,
          '5.15',
          '2026-03-26T12:00Z',
        ),
        entry(
          userId,
          ids.supplies,
          EntryNature.EXPENSE,
          EntryScope.PROFESSIONAL,
          '999.00',
          '2026-03-12T12:00Z',
          { deletedAt: new Date() },
        ),
        entry(
          userId,
          ids.fees,
          EntryNature.INCOME,
          EntryScope.PROFESSIONAL,
          '80.00',
          '2026-02-10T12:00Z',
        ),
        entry(
          otherId,
          ids.fees,
          EntryNature.INCOME,
          EntryScope.PROFESSIONAL,
          '500.00',
          '2026-03-10T12:00Z',
        ),
      ],
    });
  });

  afterAll(async () => {
    const idsToDrop = [userId, otherId, emptyId].filter(Boolean);
    if (idsToDrop.length > 0) {
      await prisma.financialEntry.deleteMany({
        where: { userId: { in: idsToDrop } },
      });
      await prisma.financialCategory.deleteMany({
        where: { userId: { in: idsToDrop } },
      });
      await prisma.user.deleteMany({ where: { id: { in: idsToDrop } } });
    }
    await app?.close();
  });

  it('summarizes March for the authenticated user and ignores deleted, other-month and other-user rows', async () => {
    const body = await balance(owner, { month: 3, year: 2026 });
    expect(body).toEqual({
      totalIncome: '1000.00',
      totalExpenses: '199.25',
      professionalExpenses: '174.10',
      personalExpenses: '25.15',
      netBalance: '800.75',
      expensesByCategory: {
        items: [
          { category: 'SUPPLIES', subtotal: '100.10' },
          { category: 'TRAVEL', subtotal: '40.00' },
          { category: 'FIXED_COSTS', subtotal: '30.00' },
          { category: 'TAXES_AND_FEES', subtotal: '20.00' },
          { category: 'OTHER', subtotal: '9.15' },
        ],
        total: '199.25',
      },
    });
  });

  it('does not leak another user entries', async () => {
    const body = await balance(other, { month: 3, year: 2026 });
    expect(body.totalIncome).toBe('500.00');
    expect(body.totalExpenses).toBe('0.00');
    expect(body.netBalance).toBe('500.00');
  });

  it('returns zeros for a user with no entries', async () => {
    await expect(balance(empty, { month: 3, year: 2026 })).resolves.toEqual({
      totalIncome: '0.00',
      totalExpenses: '0.00',
      professionalExpenses: '0.00',
      personalExpenses: '0.00',
      netBalance: '0.00',
      expensesByCategory: {
        items: [
          { category: 'SUPPLIES', subtotal: '0.00' },
          { category: 'TRAVEL', subtotal: '0.00' },
          { category: 'FIXED_COSTS', subtotal: '0.00' },
          { category: 'TAXES_AND_FEES', subtotal: '0.00' },
          { category: 'OTHER', subtotal: '0.00' },
        ],
        total: '0.00',
      },
    });
  });

  it('rejects an invalid month and a missing token', async () => {
    await request(server())
      .get('/financial-balance')
      .query({ month: 13, year: 2026 })
      .set('Authorization', bearer(owner))
      .expect(400);

    await request(server()).get('/financial-balance').expect(401);
  });
});
