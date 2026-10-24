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

interface HourlyRateBody {
  month: number;
  year: number;
  items: {
    key: string;
    label: string;
    amount: string;
    percentOfTotal: string;
  }[];
  total: string;
  productiveHours: string;
  hourlyRate: string;
  minimumHourlyRate: string;
  calculatedAt: string;
}

interface SummaryBody {
  professionalExpenses: string;
  personalExpenses: string;
  depreciation: string;
  transport: string;
}

describe('Hourly rate (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let otherId: string;
  let transportOnlyId: string;
  let emptyId: string;
  let categoryId: string;

  const user = (label: string): TestUser => ({
    cognitoSub: `e2e-hourly-${label}-${randomUUID()}`,
    email: `e2e-hourly-${label}-${randomUUID()}@example.com`,
    name: `E2E Hourly ${label}`,
  });
  const owner = user('owner');
  const other = user('other');
  const transportOnly = user('transport');
  const empty = user('empty');

  const server = () => app.getHttpServer();
  const hourlyRate = async (who: TestUser, query: object = {}) =>
    (
      await request(server())
        .get('/pricing/hourly-rate')
        .query(query)
        .set('Authorization', bearer(who))
        .expect(200)
    ).body as HourlyRateBody;
  const saveGoals = (who: TestUser, goals: object) =>
    request(server())
      .put('/pricing-settings')
      .send(goals)
      .set('Authorization', bearer(who))
      .expect(200);

  const expense = (
    ownerId: string,
    scope: EntryScope,
    amount: string,
    accrualDate: string,
  ) => ({
    userId: ownerId,
    nature: EntryNature.EXPENSE,
    scope,
    categoryId,
    description: 'Expense',
    amount,
    accrualDate: new Date(accrualDate),
    source: EntrySource.MANUAL,
  });

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await ensureDefaultFinancialCategories(prisma);
    await mintTokens([owner, other, transportOnly, empty]);

    const provision = async (who: TestUser) => {
      const session = await request(server())
        .post('/auth/session')
        .set('Authorization', bearer(who))
        .expect(200);
      return (session.body as { id: string }).id;
    };
    userId = await provision(owner);
    otherId = await provision(other);
    transportOnlyId = await provision(transportOnly);
    emptyId = await provision(empty);

    categoryId = (
      await prisma.financialCategory.findFirstOrThrow({
        where: { userId: null, name: 'Supplies', nature: EntryNature.EXPENSE },
      })
    ).id;

    await prisma.financialEntry.createMany({
      data: [
        expense(
          userId,
          EntryScope.PROFESSIONAL,
          '1000.00',
          '2026-03-10T12:00Z',
        ),
        expense(
          userId,
          EntryScope.PROFESSIONAL,
          '225.00',
          '2026-03-31T23:59:59Z',
        ),
        expense(userId, EntryScope.PERSONAL, '860.00', '2026-03-15T12:00Z'),
        // April, so March must not see it
        expense(userId, EntryScope.PERSONAL, '33.00', '2026-04-01T00:00:00Z'),
        expense(
          otherId,
          EntryScope.PROFESSIONAL,
          '555.00',
          '2026-03-10T12:00Z',
        ),
      ],
    });
    await prisma.pricingSettings.createMany({
      data: [
        { userId, transportCostMonthly: '350.00' },
        // the transport cost alone does not make the goals configured (US19)
        { userId: transportOnlyId, transportCostMonthly: '120.00' },
      ],
    });
    await saveGoals(owner, {
      monthlyIncomeGoal: 8000,
      weeklyHours: 30,
      safetyMarginPct: 20,
    });
    await saveGoals(other, {
      monthlyIncomeGoal: 5000,
      weeklyHours: 40,
      safetyMarginPct: 10,
    });

    const yearsAgo = (years: number) => {
      const date = new Date();
      date.setUTCFullYear(date.getUTCFullYear() - years);
      return date;
    };
    // (6000 - 0) / 120 = 50 a month, depreciating in March 2026
    await prisma.equipment.create({
      data: {
        userId,
        name: 'Monitor',
        purchaseValue: '6000.00',
        acquisitionDate: yearsAgo(2),
        usefulLifeMonths: 120,
      },
    });
  });

  afterAll(async () => {
    const ids = { in: [userId, otherId, transportOnlyId, emptyId] };
    await prisma.financialEntry.deleteMany({ where: { userId: ids } });
    await prisma.equipment.deleteMany({ where: { userId: ids } });
    await prisma.pricingSettings.deleteMany({ where: { userId: ids } });
    await prisma.user.deleteMany({ where: { id: ids } });
    await app.close();
  });

  it('calculates the hour value of the month, part by part', async () => {
    const { calculatedAt, ...body } = await hourlyRate(owner, {
      month: 3,
      year: 2026,
    });

    // fixed = 860 + 50 + 350; base = 1260 + 1225 + 8000 = 10485
    // margin = 20% of 10485 = 2097; total 12582 ÷ 130 h
    expect(body).toEqual({
      month: 3,
      year: 2026,
      items: [
        {
          key: 'FIXED_COSTS',
          label: 'Fixed costs',
          amount: '1260.00',
          percentOfTotal: '10.01',
        },
        {
          key: 'VARIABLE_COSTS',
          label: 'Variable costs',
          amount: '1225.00',
          percentOfTotal: '9.74',
        },
        {
          key: 'OWNER_DRAW',
          label: "Owner's draw",
          amount: '8000.00',
          percentOfTotal: '63.58',
        },
        {
          key: 'SAFETY_MARGIN',
          label: 'Safety margin',
          amount: '2097.00',
          percentOfTotal: '16.67',
        },
      ],
      total: '12582.00',
      productiveHours: '130.00',
      hourlyRate: '96.78',
      minimumHourlyRate: '80.65',
    });
    expect(Number.isNaN(Date.parse(calculatedAt))).toBe(false);
  });

  it('builds its costs from the same numbers as the fixed-costs summary', async () => {
    const summary = (
      await request(server())
        .get('/fixed-costs/summary')
        .query({ month: 3, year: 2026 })
        .set('Authorization', bearer(owner))
        .expect(200)
    ).body as SummaryBody;
    const { items } = await hourlyRate(owner, { month: 3, year: 2026 });
    const cents = (value: string) => Math.round(Number(value) * 100);

    expect(cents(items[0].amount)).toBe(
      cents(summary.personalExpenses) +
        cents(summary.depreciation) +
        cents(summary.transport),
    );
    expect(items[1].amount).toBe(summary.professionalExpenses);
  });

  it('recalculates with the costs of another month', async () => {
    const april = await hourlyRate(owner, { month: 4, year: 2026 });

    expect(april.month).toBe(4);
    // only the 33.00 personal expense, the depreciation and the transport
    expect(april.items[0].amount).toBe('433.00');
    expect(april.items[1].amount).toBe('0.00');
  });

  it('defaults to the current UTC month', async () => {
    const now = new Date();
    const body = await hourlyRate(owner);

    expect(body.month).toBe(now.getUTCMonth() + 1);
    expect(body.year).toBe(now.getUTCFullYear());
  });

  it('recalculates right after the goals change, with nothing to restart', async () => {
    await saveGoals(owner, {
      monthlyIncomeGoal: 8000,
      weeklyHours: 30,
      safetyMarginPct: 0,
    });
    const withoutMargin = await hourlyRate(owner, { month: 3, year: 2026 });
    await saveGoals(owner, {
      monthlyIncomeGoal: 8000,
      weeklyHours: 30,
      safetyMarginPct: 20,
    });

    expect(withoutMargin.items[3].amount).toBe('0.00');
    expect(withoutMargin.hourlyRate).toBe('80.65');
    expect(withoutMargin.hourlyRate).toBe(withoutMargin.minimumHourlyRate);
  });

  it("never uses another user's costs or goals", async () => {
    const body = await hourlyRate(other, { month: 3, year: 2026 });

    expect(body.items.map(item => item.amount)).toEqual([
      '0.00',
      '555.00',
      '5000.00',
      // 10% of 5555
      '555.50',
    ]);
    expect(body.productiveHours).toBe('173.33');
  });

  it.each([
    ['without a pricing_settings row', () => empty],
    ['with only the transport cost', () => transportOnly],
  ])(
    'answers 404 PRICING_SETTINGS_NOT_FOUND %s',
    async (_case, who: () => TestUser) => {
      const res = await request(server())
        .get('/pricing/hourly-rate')
        .set('Authorization', bearer(who()))
        .expect(404);

      expect((res.body as { code: string }).code).toBe(
        'PRICING_SETTINGS_NOT_FOUND',
      );
    },
  );

  it.each([{ month: 13 }, { month: '2026-10' }, { year: 1999 }])(
    'rejects %p with VALIDATION_ERROR',
    async query => {
      const res = await request(server())
        .get('/pricing/hourly-rate')
        .query(query)
        .set('Authorization', bearer(owner))
        .expect(400);

      expect((res.body as { code: string }).code).toBe('VALIDATION_ERROR');
    },
  );

  it('rejects a request without a token', async () => {
    await request(server()).get('/pricing/hourly-rate').expect(401);
  });
});
