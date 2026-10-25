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
 * The appointment and the client are optional links: a trip is recorded with
 * neither, with a client alone, or with an appointment, whose client it takes.
 */
describe('trip links (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;
  let clientId: string;
  let appointmentId: string;

  const ana: TestUser = {
    cognitoSub: 'sub-trip-links-ana',
    email: 'ana.trip-links@example.com',
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
    clientId = body(
      await request(http)
        .post('/client')
        .set('Authorization', bearer(ana))
        .send({ type: 'CLINIC', name: 'Clinica da Ana' })
        .expect(201),
    ).id as string;
    appointmentId = body(
      await request(http)
        .post('/appointments')
        .set('Authorization', bearer(ana))
        .send({
          startsAt: '2026-10-18T13:00:00.000Z',
          endsAt: '2026-10-18T14:00:00.000Z',
          clientId,
        })
        .expect(201),
    ).id as string;
  });

  afterAll(async () => {
    await app.close();
  });

  const ride = {
    mode: 'RIDE',
    occurredOn: '2026-10-18',
    origin: 'Casa',
    destination: 'Clinica',
    cost: 32.9,
  };

  const recordAndReread = async (links: Record<string, unknown>) => {
    const created = body(
      await request(http)
        .post('/trips')
        .set('Authorization', bearer(ana))
        .send({ ...ride, ...links })
        .expect(201),
    );
    const reread = body(
      await request(http)
        .get(`/trips/${created.id as string}`)
        .set('Authorization', bearer(ana))
        .expect(200),
    );
    return { created, reread };
  };

  it('records a trip with neither an appointment nor a client', async () => {
    const { created, reread } = await recordAndReread({});

    for (const trip of [created, reread]) {
      expect(trip).toMatchObject({ appointmentId: null, clientId: null });
    }
  });

  it('records a trip with a client and no appointment', async () => {
    const { created, reread } = await recordAndReread({ clientId });

    for (const trip of [created, reread]) {
      expect(trip).toMatchObject({ appointmentId: null, clientId });
    }
  });

  it("records a trip with an appointment, taking the appointment's client", async () => {
    const { created, reread } = await recordAndReread({ appointmentId });

    for (const trip of [created, reread]) {
      expect(trip).toMatchObject({ appointmentId, clientId });
    }
  });
});
