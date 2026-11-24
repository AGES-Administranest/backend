import { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppointmentsController } from '../../../src/modules/appointments/appointments.controller';
import { AppointmentsService } from '../../../src/modules/appointments/appointments.service';
import {
  createRoutesApp,
  describeRoutes,
  ID,
  OTHER_ID,
  ServiceDoubles,
  USER,
} from '../testing/routes';

const STARTS = '2026-10-10T10:00:00.000Z';
const ENDS = '2026-10-10T11:00:00.000Z';
const appointment = { startsAt: STARTS, endsAt: ENDS };
const usage = { items: [{ itemId: OTHER_ID, quantity: 2 }] };
const setup = {
  controllers: [AppointmentsController],
  services: [AppointmentsService],
};

describeRoutes('appointments', {
  ...setup,
  routes: [
    {
      route: 'POST /appointments/sync',
      body: [appointment],
      status: 201,
      calls: [AppointmentsService, 'sync', USER.id, [appointment]],
    },
    {
      route: `POST /appointments/${ID}/items`,
      body: usage,
      status: 201,
      calls: [AppointmentsService, 'registerItems', ID, USER.id, usage],
    },
    {
      route: `GET /appointments/${ID}/items`,
      calls: [AppointmentsService, 'listItems', ID, USER.id],
    },
    {
      route: `PATCH /appointments/${ID}/items/${OTHER_ID}`,
      body: { quantity: 3 },
      calls: [
        AppointmentsService,
        'editItem',
        ID,
        OTHER_ID,
        USER.id,
        { quantity: 3 },
      ],
    },
    {
      route: `DELETE /appointments/${ID}/items/${OTHER_ID}`,
      calls: [AppointmentsService, 'removeItem', ID, OTHER_ID, USER.id],
    },
    // Not an id: it has to be declared before `:id`.
    {
      route: `GET /appointments/check-conflict?startsAt=${STARTS}&endsAt=${ENDS}`,
      calls: [
        AppointmentsService,
        'checkConflict',
        USER.id,
        new Date(STARTS),
        new Date(ENDS),
        undefined,
      ],
    },
    {
      route: `GET /appointments?from=${STARTS}&pageSize=5`,
      calls: [
        AppointmentsService,
        'findAll',
        USER.id,
        { status: 'COMPLETED', page: 1, pageSize: 5, from: new Date(STARTS) },
      ],
    },
    {
      route: `GET /appointments/${ID}`,
      calls: [AppointmentsService, 'findOne', ID, USER.id],
    },
    {
      route: `PATCH /appointments/${ID}`,
      body: { notes: 'Fasting' },
      calls: [AppointmentsService, 'update', ID, USER.id, { notes: 'Fasting' }],
    },
    {
      route: `PATCH /appointments/${ID}/complete`,
      body: { amount: 250 },
      calls: [AppointmentsService, 'complete', ID, USER.id, { amount: 250 }],
    },
    {
      route: `PATCH /appointments/${ID}/cancel`,
      body: { reason: 'No show' },
      calls: [
        AppointmentsService,
        'cancel',
        ID,
        USER.id,
        { reason: 'No show' },
      ],
    },
    {
      route: `DELETE /appointments/${ID}`,
      calls: [AppointmentsService, 'remove', ID, USER.id],
    },
  ],
});

describe('POST /appointments', () => {
  let app: INestApplication;
  let doubles: ServiceDoubles;

  beforeAll(async () => {
    ({ app, doubles } = await createRoutesApp(
      setup.controllers,
      setup.services,
    ));
  });
  afterAll(() => app.close());

  const post = (body: object) =>
    request(app.getHttpServer() as never)
      .post('/appointments')
      .send(body);

  it.each([
    [true, 201],
    [false, 200],
  ])('when created is %s answers %i', async (created, status) => {
    doubles.get(AppointmentsService)?.createWithResult.mockResolvedValue({
      appointment: { id: ID },
      created,
    });

    const response = await post(appointment);

    expect(response.status).toBe(status);
    expect(response.body).toEqual({ id: ID });
  });

  it('requires the end of a scheduled appointment, not of a completed one', async () => {
    expect((await post({ startsAt: STARTS })).status).toBe(400);
    expect(
      (await post({ startsAt: STARTS, status: 'COMPLETED', amount: 10 }))
        .status,
    ).not.toBe(400);
  });
});
