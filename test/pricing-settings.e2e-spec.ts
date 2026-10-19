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

  const getTransport = (user: TestUser) =>
    request(server())
      .get('/pricing-settings/transport')
      .set('Authorization', bearer(user));
  const patchTransport = (user: TestUser, payload: object) =>
    request(server())
      .patch('/pricing-settings/transport')
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

  describe('transport cost (US18)', () => {
    const readRow = (userId: string) =>
      prisma.pricingSettings.findUnique({ where: { userId } });

    it('answers 404 TRANSPORT_COST_NOT_FOUND before anything is saved', async () => {
      const response = await getTransport(owner).expect(404);

      expect(body(response).code).toBe('TRANSPORT_COST_NOT_FOUND');
    });

    it('answers 404 TRANSPORT_COST_NOT_FOUND when only the goals are saved', async () => {
      await put(owner, GOALS).expect(200);

      const response = await getTransport(owner).expect(404);

      expect(body(response).code).toBe('TRANSPORT_COST_NOT_FOUND');
    });

    it('saves the cost and reads it back as a number', async () => {
      const saved = await patchTransport(owner, {
        transportCostMonthly: 450.5,
      }).expect(200);
      expect(body(saved)).toMatchObject({ transportCostMonthly: 450.5 });
      expect(body(saved)).not.toHaveProperty('userId');

      const read = await getTransport(owner).expect(200);
      expect(body(read)).toMatchObject({ transportCostMonthly: 450.5 });
    });

    it('saves zero as a cost, not as empty', async () => {
      await patchTransport(owner, { transportCostMonthly: 0 }).expect(200);

      const read = await getTransport(owner).expect(200);
      expect(body(read).transportCostMonthly).toBe(0);
      expect((await readRow(ownerId))?.transportCostMonthly?.toNumber()).toBe(
        0,
      );
    });

    it('creates the row when there is none and leaves the goals empty', async () => {
      await patchTransport(owner, { transportCostMonthly: 450 }).expect(200);

      const row = await readRow(ownerId);
      expect(row?.transportCostMonthly?.toNumber()).toBe(450);
      expect(row?.monthlyIncomeGoal).toBeNull();
      expect(row?.weeklyHours).toBeNull();
      expect(row?.safetyMarginPct).toBeNull();
      // Goals still not configured: the US19 read keeps answering 404.
      await get(owner).expect(404);
    });

    it('overwrites the cost on a second save', async () => {
      await patchTransport(owner, { transportCostMonthly: 450 }).expect(200);

      await patchTransport(owner, { transportCostMonthly: 300 }).expect(200);

      expect(body(await getTransport(owner).expect(200))).toMatchObject({
        transportCostMonthly: 300,
      });
    });

    it('keeps the goals saved by US19', async () => {
      await put(owner, GOALS).expect(200);

      await patchTransport(owner, { transportCostMonthly: 450 }).expect(200);

      expect(body(await get(owner).expect(200))).toMatchObject(GOALS);
    });

    it('keeps the cost when the goals are saved afterwards', async () => {
      await patchTransport(owner, { transportCostMonthly: 450 }).expect(200);

      await put(owner, GOALS).expect(200);

      expect(body(await getTransport(owner).expect(200))).toMatchObject({
        transportCostMonthly: 450,
      });
    });

    it.each([
      ['an empty body', {}],
      ['null', { transportCostMonthly: null }],
      ['a numeric string', { transportCostMonthly: '450' }],
      ['an empty string', { transportCostMonthly: '' }],
      ['a negative value', { transportCostMonthly: -1 }],
      ['more than 2 decimal places', { transportCostMonthly: 10.555 }],
      ['a value past the column', { transportCostMonthly: 1e15 }],
      ['a goal field', { transportCostMonthly: 100, weeklyHours: 40 }],
      ['the owner id', { transportCostMonthly: 100, userId: 'someone-else' }],
    ])('refuses %s with 400 and saves nothing', async (_case, payload) => {
      const response = await patchTransport(owner, payload).expect(400);

      expect(body(response).code).toBe('VALIDATION_ERROR');
      expect(await readRow(ownerId)).toBeNull();
    });

    it("does not show one user's cost to another", async () => {
      await patchTransport(owner, { transportCostMonthly: 450 }).expect(200);

      await getTransport(other).expect(404);
    });

    it("does not change another user's cost", async () => {
      await patchTransport(owner, { transportCostMonthly: 450 }).expect(200);
      await patchTransport(other, { transportCostMonthly: 90 }).expect(200);

      expect(body(await getTransport(owner).expect(200))).toMatchObject({
        transportCostMonthly: 450,
      });
      expect(body(await getTransport(other).expect(200))).toMatchObject({
        transportCostMonthly: 90,
      });
    });

    it('refuses a request without a token', async () => {
      await request(server()).get('/pricing-settings/transport').expect(401);
      await request(server())
        .patch('/pricing-settings/transport')
        .send({ transportCostMonthly: 450 })
        .expect(401);
    });
  });
});
