import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { ensureDefaultFinancialCategories } from './helpers/default-financial-categories';
import {
  bearer,
  body,
  createTestApp,
  mintTokens,
  resetDatabase,
  TestUser,
} from './helpers/test-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';

/**
 * POST /pricing/procedure-estimate (US21) end to end. The goals give an exact
 * hourly rate: 6,000 of owner draw and a 10% margin over 40 weekly hours
 * (173.33 productive hours) make 38.08 an hour, or 34.62 without the margin.
 * The trips are dated in the past, so their expenses stay out of the current
 * month and leave the rate alone.
 */
describe('procedure estimate (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;

  const ana: TestUser = {
    cognitoSub: 'sub-procedure-estimate-ana',
    email: 'ana.procedure-estimate@example.com',
    name: 'Ana Souza',
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    http = app.getHttpServer() as App;
    await mintTokens([ana]);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    // Every trip posts its expense under the default Travel category.
    await ensureDefaultFinancialCategories(prisma);
    await request(http)
      .post('/auth/session')
      .set('Authorization', bearer(ana))
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  const send = (method: 'post' | 'put' | 'delete', path: string) =>
    request(http)[method](path).set('Authorization', bearer(ana));

  const saveGoals = () =>
    send('put', '/pricing-settings')
      .send({ monthlyIncomeGoal: 6000, weeklyHours: 40, safetyMarginPct: 10 })
      .expect(200);

  const createClient = async (name: string) =>
    body(
      await send('post', '/client').send({ type: 'CLINIC', name }).expect(201),
    ).id as string;

  const createItem = async (name: string, defaultUnitCost?: number) =>
    body(
      await send('post', '/item')
        .send({ category: 'DISPOSABLE', unit: 'UNIT', name, defaultUnitCost })
        .expect(201),
    ).id as string;

  const ride = async (
    occurredOn: string,
    cost: number,
    clientId: string | null,
  ) =>
    body(
      await send('post', '/trips')
        .send({
          mode: 'RIDE',
          occurredOn,
          origin: 'Casa',
          destination: 'Clinica',
          cost,
          ...(clientId ? { clientId } : {}),
        })
        .expect(201),
    ).id as string;

  const estimate = (payload: Record<string, unknown>) =>
    send('post', '/pricing/procedure-estimate').send(payload);

  it('adds the hours, the trip at the client and the supplies', async () => {
    await saveGoals();
    const clientId = await createClient('Clinica da Ana');
    // A day with the way there and back, and another day.
    await ride('2025-03-10', 30, clientId);
    await ride('2025-03-10', 35.8, clientId);
    await ride('2025-03-17', 32.9, clientId);
    // Left out: a way back without the client, and a deleted trip.
    await ride('2025-03-17', 32.9, null);
    const deleted = await ride('2025-03-24', 500, clientId);
    await send('delete', `/trips/${deleted}`).expect(200);
    const priced = await createItem('Seringa 5 mL', 12.5);
    const unpriced = await createItem('Cateter 22G');

    const response = await estimate({
      durationMinutes: 90,
      clientId,
      supplies: [
        { itemId: priced, quantity: 2 },
        { itemId: unpriced, quantity: 1 },
      ],
    }).expect(200);

    const now = new Date();
    expect(body(response)).toEqual({
      // 38.08 × 1.5 + (65.80 + 32.90) ÷ 2 + 2 × 12.50
      minimumPrice: '131.47',
      // 34.62 × 1.5 + 49.35 + 25.00
      breakEvenPrice: '126.28',
      hoursCost: '57.12',
      tripCost: '49.35',
      suppliesCost: '25.00',
      hourlyRateUsed: '38.08',
      minimumHourlyRateUsed: '34.62',
      tripEstimateAvailable: true,
      tripEstimateDays: 2,
      suppliesWithoutCost: [unpriced],
      durationMinutes: 90,
      month: now.getUTCMonth() + 1,
      year: now.getUTCFullYear(),
    });
  });

  it('uses the same hourly rate as GET /pricing/hourly-rate', async () => {
    await saveGoals();

    const [rate, estimated] = await Promise.all([
      request(http)
        .get('/pricing/hourly-rate')
        .set('Authorization', bearer(ana))
        .expect(200),
      estimate({ durationMinutes: 60 }).expect(200),
    ]);

    expect(body(estimated)).toMatchObject({
      hourlyRateUsed: body(rate).hourlyRate,
      minimumHourlyRateUsed: body(rate).minimumHourlyRate,
      minimumPrice: body(rate).hourlyRate,
    });
  });

  it('marks the trip as not estimated for a client without trips', async () => {
    await saveGoals();
    const clientId = await createClient('Clinica nova');

    const response = await estimate({ durationMinutes: 60, clientId }).expect(
      200,
    );

    expect(body(response)).toMatchObject({
      tripCost: '0.00',
      tripEstimateAvailable: false,
      tripEstimateDays: 0,
    });
  });

  it('answers 404 PRICING_SETTINGS_NOT_FOUND without the goals, before the references', async () => {
    const response = await estimate({
      durationMinutes: 60,
      clientId: '6f1c1e44-5a1d-4f0e-9b7b-2f5d6f3a9c11',
    }).expect(404);

    expect(body(response)).toMatchObject({
      code: 'PRICING_SETTINGS_NOT_FOUND',
    });
  });

  it.each([
    [{}, 'durationMinutes'],
    [{ durationMinutes: 0 }, 'durationMinutes'],
    [
      { durationMinutes: 60, supplies: [{ itemId: 'x', quantity: 1 }] },
      'supplies',
    ],
  ])('refuses an invalid body %j with 400', async (payload, field) => {
    await saveGoals();

    const response = await estimate(payload).expect(400);

    expect(body(response)).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(JSON.stringify(body(response).details)).toContain(field);
  });
});
