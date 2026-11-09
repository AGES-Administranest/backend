import { INestApplication } from '@nestjs/common';
import { EntryNature, EntryScope, EntrySource, TripMode } from '@prisma/client';
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

interface AvailabilityBody {
  appointments: number;
  financialEntries: number;
  serviceInvoices: number;
  purchaseInvoices: number;
  stockMovements: number;
  trips: number;
  equipments: number;
  total: number;
}

describe('Reports availability (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let userId: string;
  let otherId: string;
  let categoryId: string;

  const owner: TestUser = {
    cognitoSub: `e2e-reports-${randomUUID()}`,
    email: `e2e-reports-${randomUUID()}@example.com`,
    name: 'E2E Reports',
  };
  const other: TestUser = {
    cognitoSub: `e2e-reports-other-${randomUUID()}`,
    email: `e2e-reports-other-${randomUUID()}@example.com`,
    name: 'Other',
  };
  const empty: TestUser = {
    cognitoSub: `e2e-reports-empty-${randomUUID()}`,
    email: `e2e-reports-empty-${randomUUID()}@example.com`,
    name: 'Empty',
  };

  const server = () => app.getHttpServer();
  const availability = (user: TestUser, query: object) =>
    request(server())
      .get('/reports/availability')
      .query(query)
      .set('Authorization', bearer(user));

  const october = { from: '2026-10-01', to: '2026-10-31' };

  // One record of every section inside October for `ownerId`, plus the ones
  // that must be left out: deleted, outside the period and, for the invoices,
  // not confirmed. Stock movements are covered by the unit specs, which pin the
  // same `userId` + `deletedAt` + period filter, because creating one here
  // would need an item and a lot as well.
  const seed = async (ownerId: string, deleted: boolean) => {
    const deletedAt = deleted ? new Date() : null;

    await prisma.appointment.createMany({
      data: [
        { userId: ownerId, startsAt: new Date('2026-10-01T00:00:00Z') },
        { userId: ownerId, startsAt: new Date('2026-10-31T23:59:59Z') },
        { userId: ownerId, startsAt: new Date('2026-09-30T23:59:59Z') },
        { userId: ownerId, startsAt: new Date('2026-11-01T00:00:00Z') },
        {
          userId: ownerId,
          startsAt: new Date('2026-10-10T12:00:00Z'),
          deletedAt: new Date(),
        },
      ],
    });
    await prisma.financialEntry.createMany({
      data: [
        {
          userId: ownerId,
          nature: EntryNature.EXPENSE,
          scope: EntryScope.PROFESSIONAL,
          categoryId,
          description: 'Expense',
          amount: '10.00',
          accrualDate: new Date('2026-10-15T12:00:00Z'),
          source: EntrySource.MANUAL,
          deletedAt,
        },
      ],
    });
    await prisma.serviceInvoice.createMany({
      data: [
        {
          userId: ownerId,
          status: 'CONFIRMED',
          issueDate: new Date('2026-10-20'),
          deletedAt,
        },
        {
          userId: ownerId,
          status: 'DRAFT',
          issueDate: new Date('2026-10-20'),
        },
      ],
    });
    await prisma.purchaseInvoice.createMany({
      data: [
        {
          userId: ownerId,
          status: 'CONFIRMED',
          issueDate: new Date('2026-10-20'),
          deletedAt,
        },
        {
          userId: ownerId,
          status: 'DRAFT',
          issueDate: new Date('2026-10-20'),
        },
      ],
    });
    await prisma.trip.createMany({
      data: [
        {
          userId: ownerId,
          mode: TripMode.RIDE,
          occurredOn: new Date('2026-10-31'),
          origin: 'Home',
          destination: 'Clinic',
          cost: '25.00',
          deletedAt,
        },
        {
          userId: ownerId,
          mode: TripMode.RIDE,
          occurredOn: new Date('2026-11-01'),
          origin: 'Home',
          destination: 'Clinic',
          cost: '25.00',
        },
      ],
    });
    await prisma.equipment.createMany({
      data: [
        {
          userId: ownerId,
          name: 'Ultrasound',
          purchaseValue: '1000.00',
          acquisitionDate: new Date('2026-10-05'),
          deletedAt,
        },
      ],
    });
  };

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
    await provision(empty);

    categoryId = (
      await prisma.financialCategory.findFirstOrThrow({
        where: { userId: null, name: 'Professional fees' },
      })
    ).id;

    await seed(userId, false);
    // Another account with data in the same period: it must never be counted.
    await seed(otherId, false);
  });

  afterAll(async () => {
    await app.close();
  });

  it('counts each section for the period, both days included', async () => {
    const response = await availability(owner, october).expect(200);

    expect(response.body).toEqual({
      appointments: 2,
      financialEntries: 1,
      serviceInvoices: 1,
      purchaseInvoices: 1,
      stockMovements: 0,
      trips: 1,
      equipments: 1,
      total: 6,
    } satisfies AvailabilityBody);
  });

  it('does not see another account records (ADR-11)', async () => {
    const response = await availability(empty, october).expect(200);

    expect((response.body as AvailabilityBody).total).toBe(0);
  });

  it('answers zero for a period with no records', async () => {
    const response = await availability(owner, {
      from: '2020-01-01',
      to: '2020-01-31',
    }).expect(200);

    expect((response.body as AvailabilityBody).total).toBe(0);
  });

  it('answers 400 REPORT_PERIOD_INVALID when from is after to', async () => {
    const response = await availability(owner, {
      from: '2026-10-31',
      to: '2026-10-01',
    }).expect(400);

    expect(response.body).toMatchObject({
      code: 'REPORT_PERIOD_INVALID',
    });
  });

  it.each([
    ['a missing date', { from: '2026-10-01' }],
    ['a malformed date', { from: '2026-10-01', to: '31/10/2026' }],
    ['an impossible date', { from: '2026-02-30', to: '2026-03-01' }],
  ])('answers 400 for %s', async (_name, query) => {
    await availability(owner, query).expect(400);
  });

  it('requires a token', async () => {
    await request(server())
      .get('/reports/availability')
      .query(october)
      .expect(401);
  });
});
