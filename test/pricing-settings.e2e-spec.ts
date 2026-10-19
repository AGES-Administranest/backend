import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

import {
  bearer,
  body,
  createTestApp,
  mintTokens,
  TestUser,
} from './helpers/test-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';

const GOALS = {
  monthlyIncomeGoal: 8000.5,
  weeklyHours: 37.5,
  safetyMarginPct: 10,
};

describe('Pricing settings (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let ownerId: string;
  let otherId: string;

  const owner: TestUser = {
    cognitoSub: `e2e-pricing-${randomUUID()}`,
    email: `e2e-pricing-${randomUUID()}@example.com`,
    name: 'E2E Pricing',
  };

  const other: TestUser = {
    cognitoSub: `e2e-pricing-other-${randomUUID()}`,
    email: `e2e-pricing-other-${randomUUID()}@example.com`,
    name: 'Other',
  };

  const server = () => app.getHttpServer();
  const get = (user: TestUser) =>
    request(server())
      .get('/pricing-settings')
      .set('Authorization', bearer(user));
  const put = (user: TestUser, payload: object) =>
    request(server())
      .put('/pricing-settings')
      .set('Authorization', bearer(user))
      .send(payload);

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
    ownerId = await provision(owner);
    otherId = await provision(other);
  });

  beforeEach(async () => {
    await prisma.pricingSettings.deleteMany({
      where: { userId: { in: [ownerId, otherId] } },
    });
  });

  afterAll(async () => {
    await prisma.pricingSettings.deleteMany({
      where: { userId: { in: [ownerId, otherId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [ownerId, otherId] } },
    });
    await app.close();
  });

  it('answers 404 PRICING_SETTINGS_NOT_FOUND before anything is saved', async () => {
    const response = await get(owner).expect(404);

    expect(body(response).code).toBe('PRICING_SETTINGS_NOT_FOUND');
  });

  it('still answers 404 when only the transport cost (US18) is saved', async () => {
    await prisma.pricingSettings.create({
      data: { userId: ownerId, transportCostMonthly: 450 },
    });

    const response = await get(owner).expect(404);

    expect(body(response).code).toBe('PRICING_SETTINGS_NOT_FOUND');
  });

  it('saves the three goals and reads them back as numbers', async () => {
    const saved = await put(owner, GOALS).expect(200);
    expect(body(saved)).toMatchObject(GOALS);

    const read = await get(owner).expect(200);
    expect(body(read)).toMatchObject(GOALS);
    expect(body(read)).not.toHaveProperty('userId');
    expect(body(read)).not.toHaveProperty('transportCostMonthly');
  });

  it('overwrites the goals on a second save', async () => {
    await put(owner, GOALS).expect(200);

    await put(owner, { ...GOALS, weeklyHours: 20 }).expect(200);

    expect(body(await get(owner).expect(200)).weeklyHours).toBe(20);
  });

  it('keeps the transport cost saved by US18', async () => {
    await prisma.pricingSettings.create({
      data: { userId: ownerId, transportCostMonthly: 450 },
    });

    await put(owner, GOALS).expect(200);

    const row = await prisma.pricingSettings.findUniqueOrThrow({
      where: { userId: ownerId },
    });
    expect(row.transportCostMonthly?.toNumber()).toBe(450);
  });

  it.each([
    ['weekly hours of zero', { ...GOALS, weeklyHours: 0 }],
    ['weekly hours over 168', { ...GOALS, weeklyHours: 169 }],
    ['a safety margin over 100', { ...GOALS, safetyMarginPct: 101 }],
    ['a negative safety margin', { ...GOALS, safetyMarginPct: -1 }],
    ['an income goal of zero', { ...GOALS, monthlyIncomeGoal: 0 }],
    ['a missing field', { monthlyIncomeGoal: 8000, weeklyHours: 40 }],
    ['a numeric string', { ...GOALS, weeklyHours: '40' }],
    ['the transport cost', { ...GOALS, transportCostMonthly: 100 }],
  ])('refuses %s with 400 and saves nothing', async (_case, payload) => {
    const response = await put(owner, payload).expect(400);

    expect(body(response).code).toBe('VALIDATION_ERROR');
    expect(
      await prisma.pricingSettings.findUnique({ where: { userId: ownerId } }),
    ).toBeNull();
  });

  it("does not show one user's settings to another", async () => {
    await put(owner, GOALS).expect(200);

    await get(other).expect(404);
  });

  it('refuses a request without a token', async () => {
    await request(server()).get('/pricing-settings').expect(401);
    await request(server()).put('/pricing-settings').send(GOALS).expect(401);
  });
});
