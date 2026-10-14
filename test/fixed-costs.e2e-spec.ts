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

interface SummaryBody {
  professionalExpenses: string;
  personalExpenses: string;
  depreciation: string;
  transport: string;
  total: string;
}

interface StatementBody {
  scope: EntryScope;
  amount: string;
}

describe('Fixed costs summary (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let otherId: string;
  let emptyId: string;
  let categoryId: string;

  const owner: TestUser = {
    cognitoSub: `e2e-fixed-${randomUUID()}`,
    email: `e2e-fixed-${randomUUID()}@example.com`,
    name: 'E2E Fixed Costs',
  };
  const other: TestUser = {
    cognitoSub: `e2e-fixed-other-${randomUUID()}`,
    email: `e2e-fixed-other-${randomUUID()}@example.com`,
    name: 'Other',
  };
  const empty: TestUser = {
    cognitoSub: `e2e-fixed-empty-${randomUUID()}`,
    email: `e2e-fixed-empty-${randomUUID()}@example.com`,
    name: 'Empty',
  };

  const server = () => app.getHttpServer();
  const summary = async (user: TestUser, query: object = {}) =>
    (
      await request(server())
        .get('/fixed-costs/summary')
        .query(query)
        .set('Authorization', bearer(user))
        .expect(200)
    ).body as SummaryBody;

  const expense = (
    ownerId: string,
    scope: EntryScope,
    amount: string,
    accrualDate: string,
    extra: object = {},
  ) => ({
    userId: ownerId,
    nature: EntryNature.EXPENSE,
    scope,
    categoryId,
    description: 'Expense',
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

    categoryId = (
      await prisma.financialCategory.findFirstOrThrow({
        where: { userId: null, name: 'Professional fees' },
      })
    ).id;

    await prisma.financialEntry.createMany({
      data: [
        expense(userId, EntryScope.PROFESSIONAL, '100.00', '2026-03-10T12:00Z'),
        expense(
          userId,
          EntryScope.PROFESSIONAL,
          '50.25',
          '2026-03-31T23:59:59Z',
        ),
        expense(userId, EntryScope.PERSONAL, '80.00', '2026-03-15T12:00Z'),
        // not an expense, deleted, another month and another user: all left out
        expense(
          userId,
          EntryScope.PROFESSIONAL,
          '999.00',
          '2026-03-12T12:00Z',
          {
            nature: EntryNature.INCOME,
          },
        ),
        expense(
          userId,
          EntryScope.PROFESSIONAL,
          '777.00',
          '2026-03-12T12:00Z',
          {
            deletedAt: new Date(),
          },
        ),
        expense(userId, EntryScope.PERSONAL, '33.00', '2026-04-01T00:00:00Z'),
        expense(
          otherId,
          EntryScope.PROFESSIONAL,
          '555.00',
          '2026-03-10T12:00Z',
        ),
      ],
    });
    await prisma.pricingSettings.create({
      data: { userId, transportCostMonthly: '300.00' },
    });
    await prisma.equipment.createMany({
      data: [
        // (6000 - 0) / 60 = 100 a month, depreciating in 2026-03
        {
          userId,
          name: 'Active',
          purchaseValue: '6000.00',
          acquisitionDate: new Date('2026-01-10'),
          usefulLifeMonths: 60,
        },
        {
          userId,
          name: 'Inactive',
          purchaseValue: '6000.00',
          acquisitionDate: new Date('2026-01-10'),
          usefulLifeMonths: 60,
          active: false,
        },
        {
          userId,
          name: 'Deleted',
          purchaseValue: '6000.00',
          acquisitionDate: new Date('2026-01-10'),
          usefulLifeMonths: 60,
          deletedAt: new Date(),
        },
        {
          userId,
          name: 'Not acquired yet',
          purchaseValue: '6000.00',
          acquisitionDate: new Date('2026-06-10'),
          usefulLifeMonths: 60,
        },
        {
          userId: otherId,
          name: 'Theirs',
          purchaseValue: '6000.00',
          acquisitionDate: new Date('2026-01-10'),
          usefulLifeMonths: 60,
        },
      ],
    });
  });

  afterAll(async () => {
    const ids = { in: [userId, otherId, emptyId] };
    await prisma.financialEntry.deleteMany({ where: { userId: ids } });
    await prisma.equipment.deleteMany({ where: { userId: ids } });
    await prisma.pricingSettings.deleteMany({ where: { userId: ids } });
    await prisma.user.deleteMany({ where: { id: ids } });
    await app.close();
  });

  it('sums the expenses by scope, the depreciation and the transport', async () => {
    expect(await summary(owner, { month: 3, year: 2026 })).toEqual({
      professionalExpenses: '150.25',
      personalExpenses: '80.00',
      depreciation: '100.00',
      transport: '300.00',
      total: '630.25',
    });
  });

  it('returns zeros, with 200, for a month and a user with nothing', async () => {
    const zeros = {
      professionalExpenses: '0.00',
      personalExpenses: '0.00',
      depreciation: '0.00',
      transport: '0.00',
      total: '0.00',
    };
    expect(await summary(empty, { month: 3, year: 2026 })).toEqual(zeros);
    expect(await summary(empty)).toEqual(zeros);
  });

  it('turns the month over at the UTC boundary', async () => {
    const april = await summary(owner, { month: 4, year: 2026 });

    expect(april.professionalExpenses).toBe('0.00');
    expect(april.personalExpenses).toBe('33.00');
  });

  it('stops depreciating before the acquisition and keeps the transport', async () => {
    const before = await summary(owner, { month: 12, year: 2025 });

    expect(before.depreciation).toBe('0.00');
    expect(before.transport).toBe('300.00');
  });

  it('starts depreciating a later equipment in its acquisition month', async () => {
    const june = await summary(owner, { month: 6, year: 2026 });

    expect(june.depreciation).toBe('200.00');
  });

  it("never shows another user's data", async () => {
    expect(await summary(other, { month: 3, year: 2026 })).toEqual({
      professionalExpenses: '555.00',
      personalExpenses: '0.00',
      depreciation: '100.00',
      transport: '0.00',
      total: '655.00',
    });
  });

  it('matches the Prof. and Personal sums of the statement of the same month', async () => {
    const res = await request(server())
      .get('/financial-entries')
      .query({ month: 3, year: 2026, nature: EntryNature.EXPENSE, limit: 100 })
      .set('Authorization', bearer(owner))
      .expect(200);
    const sumOf = (scope: EntryScope) =>
      (res.body as StatementBody[])
        .filter(entry => entry.scope === scope)
        .reduce(
          (total, entry) => total + Math.round(Number(entry.amount) * 100),
          0,
        );

    const body = await summary(owner, { month: 3, year: 2026 });

    expect(Math.round(Number(body.professionalExpenses) * 100)).toBe(
      sumOf(EntryScope.PROFESSIONAL),
    );
    expect(Math.round(Number(body.personalExpenses) * 100)).toBe(
      sumOf(EntryScope.PERSONAL),
    );
  });

  it('rejects an invalid month with VALIDATION_ERROR', async () => {
    await request(server())
      .get('/fixed-costs/summary')
      .query({ month: 13 })
      .set('Authorization', bearer(owner))
      .expect(400);
  });

  it('rejects a request without a token', async () => {
    await request(server()).get('/fixed-costs/summary').expect(401);
  });
});
