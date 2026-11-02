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
  items: { key: string; amount: string; percentOfTotal: string }[];
  total: string;
  productiveHours: string;
  hourlyRate: string;
  minimumHourlyRate: string;
  calculatedAt: string;
}

interface HistoryMonthBody extends HourlyRateBody {
  parameters: {
    monthlyIncomeGoal: string;
    weeklyHours: string;
    safetyMarginPct: string;
  };
}

interface HistoryItemBody {
  year: number;
  month: number;
  hourlyRate: string;
  calculatedAt: string;
}

const GOALS = { monthlyIncomeGoal: 8000, weeklyHours: 30, safetyMarginPct: 20 };
const NEW_GOALS = {
  monthlyIncomeGoal: 10000,
  weeklyHours: 40,
  safetyMarginPct: 10,
};

describe('Hourly rate history (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ownerId: string;
  let otherId: string;

  const user = (label: string): TestUser => ({
    cognitoSub: `e2e-history-${label}-${randomUUID()}`,
    email: `e2e-history-${label}-${randomUUID()}@example.com`,
    name: `E2E History ${label}`,
  });
  const owner = user('owner');
  const other = user('other');

  const now = new Date();
  const current = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
  const next =
    current.month === 12
      ? { year: current.year + 1, month: 1 }
      : { year: current.year, month: current.month + 1 };
  const yearMonth = ({ year, month }: { year: number; month: number }) =>
    `${year}-${String(month).padStart(2, '0')}`;

  const server = () => app.getHttpServer();
  const saveGoals = (who: TestUser, goals: object) =>
    request(server())
      .put('/pricing-settings')
      .send(goals)
      .set('Authorization', bearer(who))
      .expect(200);
  const calculate = async (who: TestUser, query: object) =>
    (
      await request(server())
        .get('/pricing/hourly-rate')
        .query(query)
        .set('Authorization', bearer(who))
        .expect(200)
    ).body as HourlyRateBody;
  const historyMonth = (
    who: TestUser,
    { year, month }: { year: number; month: number },
  ) =>
    request(server())
      .get(`/pricing/hourly-rate/history/${year}/${month}`)
      .set('Authorization', bearer(who));
  const history = async (who: TestUser, query: object = {}) =>
    (
      await request(server())
        .get('/pricing/hourly-rate/history')
        .query(query)
        .set('Authorization', bearer(who))
        .expect(200)
    ).body as HistoryItemBody[];

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await ensureDefaultFinancialCategories(prisma);
    await mintTokens([owner, other]);

    const provision = async (who: TestUser) => {
      const session = await request(server())
        .post('/auth/session')
        .set('Authorization', bearer(who))
        .expect(200);
      return (session.body as { id: string }).id;
    };
    ownerId = await provision(owner);
    otherId = await provision(other);

    const categoryId = (
      await prisma.financialCategory.findFirstOrThrow({
        where: { userId: null, name: 'Supplies', nature: EntryNature.EXPENSE },
      })
    ).id;
    await prisma.financialEntry.create({
      data: {
        userId: ownerId,
        nature: EntryNature.EXPENSE,
        scope: EntryScope.PROFESSIONAL,
        categoryId,
        description: 'Expense',
        amount: '1225.00',
        accrualDate: new Date('2026-03-10T12:00Z'),
        source: EntrySource.MANUAL,
      },
    });
  });

  afterAll(async () => {
    const ids = { in: [ownerId, otherId] };
    await prisma.financialEntry.deleteMany({ where: { userId: ids } });
    await prisma.hourlyRateSnapshot.deleteMany({ where: { userId: ids } });
    await prisma.pricingSettings.deleteMany({ where: { userId: ids } });
    await prisma.user.deleteMany({ where: { id: ids } });
    await app.close();
  });

  it('records the current month when the goals are saved, without opening the calculator', async () => {
    await saveGoals(owner, GOALS);

    const res = await historyMonth(owner, current).expect(200);
    const body = res.body as HistoryMonthBody;

    expect(body).toMatchObject({
      year: current.year,
      month: current.month,
      parameters: {
        monthlyIncomeGoal: '8000.00',
        weeklyHours: '30.00',
        safetyMarginPct: '20.00',
      },
    });
    expect(body.items.map(item => item.key)).toEqual([
      'FIXED_COSTS',
      'VARIABLE_COSTS',
      'OWNER_DRAW',
      'SAFETY_MARGIN',
    ]);
  });

  it('replaces the current month on every calculation', async () => {
    await saveGoals(owner, GOALS);
    await saveGoals(owner, NEW_GOALS);
    const calculated = await calculate(owner, {});

    const stored = (await historyMonth(owner, current).expect(200))
      .body as HistoryMonthBody;

    const { parameters, ...rest } = stored;
    expect(parameters).toEqual({
      monthlyIncomeGoal: '10000.00',
      weeklyHours: '40.00',
      safetyMarginPct: '10.00',
    });
    expect(rest).toEqual(calculated);
  });

  it('keeps a past month as first calculated, even after the goals change', async () => {
    await saveGoals(owner, GOALS);
    const first = await calculate(owner, { year: 2026, month: 3 });

    await saveGoals(owner, NEW_GOALS);
    const again = await calculate(owner, { year: 2026, month: 3 });
    const stored = (
      await historyMonth(owner, { year: 2026, month: 3 }).expect(200)
    ).body as HistoryMonthBody;

    // the calculator answers with today's goals...
    expect(again.hourlyRate).not.toBe(first.hourlyRate);
    // ...while the history keeps what was seen the first time
    const { parameters, ...rest } = stored;
    expect(rest).toEqual(first);
    expect(parameters).toEqual({
      monthlyIncomeGoal: '8000.00',
      weeklyHours: '30.00',
      safetyMarginPct: '20.00',
    });
    expect(stored.items[1]).toMatchObject({
      key: 'VARIABLE_COSTS',
      amount: '1225.00',
    });
  });

  it('does not record a future month', async () => {
    await calculate(owner, next);

    const res = await historyMonth(owner, next).expect(404);
    expect((res.body as { code: string }).code).toBe(
      'HOURLY_RATE_SNAPSHOT_NOT_FOUND',
    );
  });

  it('lists the stored months from the latest back, hour values as strings', async () => {
    const items = await history(owner);

    expect(items.map(({ year, month }) => ({ year, month }))).toEqual([
      current,
      { year: 2026, month: 3 },
    ]);
    for (const item of items) {
      expect(item.hourlyRate).toMatch(/^\d+\.\d{2}$/);
      expect(Number.isNaN(Date.parse(item.calculatedAt))).toBe(false);
    }
    const march = items.find(item => item.month === 3 && item.year === 2026);
    const marchMonth = (
      await historyMonth(owner, { year: 2026, month: 3 }).expect(200)
    ).body as HistoryMonthBody;
    expect(march?.hourlyRate).toBe(marchMonth.hourlyRate);
  });

  it('filters by from and to, both inclusive', async () => {
    expect(
      await history(owner, { from: '2026-03', to: '2026-03' }),
    ).toHaveLength(1);
    expect(
      (await history(owner, { from: yearMonth(current) })).map(
        item => item.month,
      ),
    ).toEqual([current.month]);
    expect(await history(owner, { to: '2026-02' })).toEqual([]);
  });

  it('answers 404 HOURLY_RATE_SNAPSHOT_NOT_FOUND for a month never calculated', async () => {
    const res = await historyMonth(owner, { year: 2020, month: 1 }).expect(404);

    expect((res.body as { code: string }).code).toBe(
      'HOURLY_RATE_SNAPSHOT_NOT_FOUND',
    );
  });

  it("never shows another user's months", async () => {
    expect(await history(other)).toEqual([]);

    const res = await historyMonth(other, { year: 2026, month: 3 }).expect(404);
    expect((res.body as { code: string }).code).toBe(
      'HOURLY_RATE_SNAPSHOT_NOT_FOUND',
    );
  });

  it.each([
    { from: '2026-1' },
    { to: '2026-13' },
    { from: '1999-12' },
    { from: '2026-04', to: '2026-03' },
    { userId: 'someone-else' },
  ])('rejects the list query %p with VALIDATION_ERROR', async query => {
    const res = await request(server())
      .get('/pricing/hourly-rate/history')
      .query(query)
      .set('Authorization', bearer(owner))
      .expect(400);

    expect((res.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it.each(['2026/13', '2026/0', '1999/10', '2026/x'])(
    'rejects the month %s with VALIDATION_ERROR',
    async path => {
      const res = await request(server())
        .get(`/pricing/hourly-rate/history/${path}`)
        .set('Authorization', bearer(owner))
        .expect(400);

      expect((res.body as { code: string }).code).toBe('VALIDATION_ERROR');
    },
  );

  it('rejects a request without a token', async () => {
    await request(server()).get('/pricing/hourly-rate/history').expect(401);
    await request(server())
      .get('/pricing/hourly-rate/history/2026/3')
      .expect(401);
  });
});
