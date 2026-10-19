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

interface StatementEntry {
  description: string;
  amount: string;
  source: string;
  origin: { type: string; id: string | null };
  category: { name: string };
  scope: string;
}

/**
 * A trip's expense through its whole life (US14 subtask 3), read where the
 * user sees it: the financial statement of the trip's month.
 */
describe('trip expense (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;
  let vehicleId: string;

  const ana: TestUser = {
    cognitoSub: 'sub-trip-expense-ana',
    email: 'ana.trip-expense@example.com',
    name: 'Ana Souza',
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    http = app.getHttpServer() as App;
    await mintTokens([ana]);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await ensureDefaultFinancialCategories(prisma);
    await request(http)
      .post('/auth/session')
      .set('Authorization', bearer(ana))
      .expect(200);
    vehicleId = body(
      await request(http)
        .post('/vehicles')
        .set('Authorization', bearer(ana))
        .send({
          brand: 'Fiat',
          model: 'Strada',
          fuelType: 'FLEX',
          avgConsumptionKmL: 12.5,
          fuelPrice: 5.899,
        })
        .expect(201),
    ).id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  const createTrip = async (fields: Record<string, unknown> = {}) =>
    body(
      await request(http)
        .post('/trips')
        .set('Authorization', bearer(ana))
        .send({
          mode: 'OWN_VEHICLE',
          vehicleId,
          occurredOn: '2026-10-18',
          origin: 'Casa',
          destination: 'Clinica',
          distanceKm: 300,
          ...fields,
        })
        .expect(201),
    ).id as string;

  const patchTrip = (tripId: string, fields: Record<string, unknown>) =>
    request(http)
      .patch(`/trips/${tripId}`)
      .set('Authorization', bearer(ana))
      .send(fields)
      .expect(200);

  /** The trip expenses of a month, as the statement lists them. */
  const tripExpenses = async (month = 10) => {
    const response = await request(http)
      .get('/financial-entries')
      .query({ year: 2026, month })
      .set('Authorization', bearer(ana))
      .expect(200);

    return (response.body as StatementEntry[]).filter(
      entry => entry.source === 'TRIP',
    );
  };

  it('posts a professional Travel expense with the trip cost and date', async () => {
    const tripId = await createTrip();

    const expenses = await tripExpenses();
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({
      description: 'Casa → Clinica',
      amount: '141.57',
      origin: { type: 'TRIP', id: tripId },
      category: { name: 'Travel' },
      scope: 'PROFESSIONAL',
    });
    const stored = await prisma.financialEntry.findUniqueOrThrow({
      where: { tripId },
    });
    expect(stored.nature).toBe('EXPENSE');
    expect(stored.accrualDate).toEqual(new Date('2026-10-18T00:00:00.000Z'));
  });

  it('posts the fare of a RIDE', async () => {
    await createTrip({
      mode: 'RIDE',
      vehicleId: undefined,
      distanceKm: undefined,
      cost: 32.9,
    });

    expect((await tripExpenses()).map(entry => entry.amount)).toEqual(['32.9']);
  });

  it('follows the trip when it is edited, to another month too', async () => {
    const tripId = await createTrip();

    await patchTrip(tripId, { distanceKm: 100, destination: 'Escritorio' });
    expect(await tripExpenses()).toEqual([
      expect.objectContaining({
        amount: '47.19',
        description: 'Casa → Escritorio',
      }),
    ]);

    await patchTrip(tripId, { occurredOn: '2026-09-30' });
    expect(await tripExpenses()).toEqual([]);
    expect((await tripExpenses(9)).map(entry => entry.amount)).toEqual([
      '47.19',
    ]);
  });

  it('drops the expense when the cost falls to zero, and brings it back', async () => {
    const tripId = await createTrip();

    await patchTrip(tripId, { distanceKm: 0.01 });
    expect(await tripExpenses()).toEqual([]);
    const dropped = await prisma.financialEntry.findUniqueOrThrow({
      where: { tripId },
    });
    expect(dropped.deletedAt).not.toBeNull();
    expect(dropped.amount.toString()).toBe('141.57');

    await patchTrip(tripId, { distanceKm: 30 });
    expect((await tripExpenses()).map(entry => entry.amount)).toEqual([
      '14.16',
    ]);
    // Revived, not posted twice: trip_id is unique.
    expect(await prisma.financialEntry.count()).toBe(1);
  });

  it('posts nothing for a trip that costs zero from the start', async () => {
    await createTrip({ distanceKm: 0.01 });

    expect(await prisma.financialEntry.count()).toBe(0);
  });

  it('removes the expense with the trip, without a reversing entry', async () => {
    const tripId = await createTrip();

    await request(http)
      .delete(`/trips/${tripId}`)
      .set('Authorization', bearer(ana))
      .expect(200);

    expect(await tripExpenses()).toEqual([]);
    const removed = await prisma.financialEntry.findUniqueOrThrow({
      where: { tripId },
    });
    expect(removed.deletedAt).not.toBeNull();
    expect(await prisma.financialEntry.count()).toBe(1);
  });

  it('keeps the expense out of the generic routes: only the trip changes it', async () => {
    const tripId = await createTrip();
    const { id: entryId } = await prisma.financialEntry.findUniqueOrThrow({
      where: { tripId },
    });

    const update = await request(http)
      .patch(`/financial-entries/${entryId}`)
      .set('Authorization', bearer(ana))
      .send({ amount: 1 })
      .expect(400);
    const remove = await request(http)
      .delete(`/financial-entries/${entryId}`)
      .set('Authorization', bearer(ana))
      .expect(409);

    expect(body(update)).toMatchObject({
      code: 'FINANCIAL_ENTRY_CONTROLLED_BY_ORIGIN',
    });
    expect(body(remove)).toMatchObject({
      code: 'FINANCIAL_ENTRY_DELETE_VIA_ORIGIN',
    });
  });

  it('keeps no trip when its expense cannot be posted', async () => {
    await prisma.financialCategory.updateMany({
      where: { userId: null, name: 'Travel' },
      data: { active: false },
    });

    const response = await request(http)
      .post('/trips')
      .set('Authorization', bearer(ana))
      .send({
        mode: 'RIDE',
        occurredOn: '2026-10-18',
        origin: 'Casa',
        destination: 'Clinica',
        cost: 32.9,
      })
      .expect(400);

    expect(body(response)).toMatchObject({
      code: 'FINANCIAL_CATEGORY_NOT_SEEDED',
    });
    expect(await prisma.trip.count()).toBe(0);
    expect(await prisma.financialEntry.count()).toBe(0);
  });
});
