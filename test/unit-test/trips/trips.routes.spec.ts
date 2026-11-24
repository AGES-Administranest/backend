import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { TripsController } from '../../../src/modules/trips/trips.controller';
import { TripsService } from '../../../src/modules/trips/trips.service';
import {
  createRoutesApp,
  describeRoutes,
  ID,
  ServiceDoubles,
  USER,
} from '../testing/routes';

const setup = { controllers: [TripsController], services: [TripsService] };

describeRoutes('trips', {
  ...setup,
  routes: [
    {
      route: 'GET /trips?from=2026-10-01&page=2',
      calls: [
        TripsService,
        'findAll',
        USER.id,
        expect.objectContaining({ from: '2026-10-01', page: 2 }) as unknown,
      ],
    },
    {
      route: `GET /trips/${ID}`,
      calls: [TripsService, 'findOne', ID, USER.id],
    },
    {
      route: `PATCH /trips/${ID}`,
      body: { origin: 'Home' },
      calls: [TripsService, 'update', ID, USER.id, { origin: 'Home' }],
    },
    {
      route: `DELETE /trips/${ID}`,
      calls: [TripsService, 'remove', ID, USER.id],
    },
  ],
});

describe('POST /trips', () => {
  const trip = {
    mode: 'RIDE',
    occurredOn: '2026-10-10',
    origin: 'Home',
    destination: 'Clinic',
    cost: 25,
  };
  let app: INestApplication;
  let doubles: ServiceDoubles;

  beforeAll(async () => {
    ({ app, doubles } = await createRoutesApp(
      setup.controllers,
      setup.services,
    ));
  });
  afterAll(() => app.close());

  it.each([
    [true, 201],
    [false, 200],
  ])('when created is %s answers %i with the trip', async (created, status) => {
    doubles
      .get(TripsService)
      ?.createWithResult.mockResolvedValue({ trip: { id: ID }, created });

    const response = await request(app.getHttpServer() as never)
      .post('/trips')
      .send(trip);

    expect(response.status).toBe(status);
    expect(response.body).toEqual({ id: ID });
    expect(doubles.get(TripsService)?.createWithResult.mock.lastCall).toEqual([
      USER.id,
      trip,
    ]);
  });
});
