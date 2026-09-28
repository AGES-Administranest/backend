import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

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
 * US06 against a real database: the transaction, the atomic decrements of the
 * `currentQuantity` caches and the `needsAdjustment` flag only exist in SQL,
 * so the in-memory repository of the unit spec cannot prove them.
 */
describe('POST /appointments/:id/items (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;

  const ana: TestUser = {
    cognitoSub: 'sub-appointment-items-ana',
    email: 'ana.appointment-items@example.com',
    name: 'Ana Souza',
  };

  const bruno: TestUser = {
    cognitoSub: 'sub-appointment-items-bruno',
    email: 'bruno.appointment-items@example.com',
    name: 'Bruno Lima',
  };

  const STARTS_AT = '2026-09-25T13:00:00.000Z';

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    http = app.getHttpServer() as App;
    await mintTokens([ana, bruno]);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    for (const user of [ana, bruno]) {
      await request(http)
        .post('/auth/session')
        .set('Authorization', bearer(user))
        .expect(200);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  const createAppointment = async (user: TestUser): Promise<string> => {
    const response = await request(http)
      .post('/appointments')
      .set('Authorization', bearer(user))
      .send({
        startsAt: STARTS_AT,
        endsAt: '2026-09-25T14:00:00.000Z',
        procedureName: 'Castração',
      })
      .expect(201);
    return body(response).id as string;
  };

  const createItemWithLot = async (
    user: TestUser,
    quantity: number,
    unitCost: number,
  ): Promise<{ itemId: string; lotId: string }> => {
    const item = await request(http)
      .post('/item')
      .set('Authorization', bearer(user))
      .send({ category: 'ANESTHETIC', unit: 'VIAL', name: `Item ${unitCost}` })
      .expect(201);
    const itemId = body(item).id as string;

    const lot = await request(http)
      .post(`/item/${itemId}/lot`)
      .set('Authorization', bearer(user))
      .send({ quantity, unitCost, expirationDate: '2027-01-31' })
      .expect(201);
    return { itemId, lotId: body(lot).id as string };
  };

  it('records the movements and decrements the item and lot caches', async () => {
    const appointmentId = await createAppointment(ana);
    const { itemId, lotId } = await createItemWithLot(ana, 10, 12.5);

    const response = await request(http)
      .post(`/appointments/${appointmentId}/items`)
      .set('Authorization', bearer(ana))
      .send({ items: [{ itemId, quantity: 3 }] })
      .expect(201);

    expect(body(response)).toMatchObject({
      appointmentId,
      warnings: [],
      movements: [
        {
          itemId,
          lotId,
          type: 'OUTBOUND',
          source: 'APPOINTMENT',
          quantity: '3',
          unitCost: '12.5',
          occurredAt: STARTS_AT,
        },
      ],
    });

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { appointmentId },
    });
    expect(movement.source).toBe('APPOINTMENT');

    const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.currentQuantity.toString()).toBe('7');
    expect(item.needsAdjustment).toBe(false);
    const lot = await prisma.itemLot.findUniqueOrThrow({
      where: { id: lotId },
    });
    expect(lot.currentQuantity.toString()).toBe('7');
  });

  it('does not block on insufficient stock: goes negative, flags the item and warns', async () => {
    const appointmentId = await createAppointment(ana);
    const { itemId } = await createItemWithLot(ana, 2, 5);

    const response = await request(http)
      .post(`/appointments/${appointmentId}/items`)
      .set('Authorization', bearer(ana))
      .send({ items: [{ itemId, quantity: 5 }] })
      .expect(201);

    expect(body(response).warnings).toEqual([
      { warning: 'insufficient_stock', itemId },
    ]);
    const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.currentQuantity.toString()).toBe('-3');
    expect(item.needsAdjustment).toBe(true);
  });

  it('never edits existing movements: a second registration only appends', async () => {
    const appointmentId = await createAppointment(ana);
    const { itemId } = await createItemWithLot(ana, 10, 5);
    const register = () =>
      request(http)
        .post(`/appointments/${appointmentId}/items`)
        .set('Authorization', bearer(ana))
        .send({ items: [{ itemId, quantity: 1 }] })
        .expect(201);

    const first = body(await register()).movements as { id: string }[];
    await register();

    const movements = await prisma.stockMovement.findMany({
      where: { appointmentId },
      orderBy: { createdAt: 'asc' },
    });
    expect(movements).toHaveLength(2);
    expect(movements[0].id).toBe(first[0].id);
    expect(movements[0].quantity.toString()).toBe('1');
  });

  it('deducts once when the app resends a line with the same clientGeneratedId (ADR-08/09)', async () => {
    const appointmentId = await createAppointment(ana);
    const { itemId } = await createItemWithLot(ana, 10, 5);
    const payload = {
      items: [{ clientGeneratedId: randomUUID(), itemId, quantity: 3 }],
    };
    const send = () =>
      request(http)
        .post(`/appointments/${appointmentId}/items`)
        .set('Authorization', bearer(ana))
        .send(payload)
        .expect(201);

    const first = body(await send()).movements as { id: string }[];
    const second = body(await send()).movements as { id: string }[];

    expect(second[0].id).toBe(first[0].id);
    expect(await prisma.stockMovement.count({ where: { appointmentId } })).toBe(
      1,
    );
    const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.currentQuantity.toString()).toBe('7');
  });

  it('deducts once when two copies of the same request race', async () => {
    const appointmentId = await createAppointment(ana);
    const { itemId } = await createItemWithLot(ana, 10, 5);
    const payload = {
      items: [{ clientGeneratedId: randomUUID(), itemId, quantity: 3 }],
    };
    const send = () =>
      request(http)
        .post(`/appointments/${appointmentId}/items`)
        .set('Authorization', bearer(ana))
        .send(payload);

    const responses = await Promise.all([send(), send(), send()]);

    expect(responses.map(response => response.status)).toEqual([201, 201, 201]);
    expect(await prisma.stockMovement.count({ where: { appointmentId } })).toBe(
      1,
    );
    const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.currentQuantity.toString()).toBe('7');
  });

  it('rejects a clientGeneratedId reused for a different line with 409', async () => {
    const appointmentId = await createAppointment(ana);
    const { itemId } = await createItemWithLot(ana, 10, 5);
    const clientGeneratedId = randomUUID();
    const send = (quantity: number) =>
      request(http)
        .post(`/appointments/${appointmentId}/items`)
        .set('Authorization', bearer(ana))
        .send({ items: [{ clientGeneratedId, itemId, quantity }] });

    await send(1).expect(201);
    await send(2)
      .expect(409)
      .expect(res =>
        expect(body(res).code).toBe('STOCK_MOVEMENT_CLIENT_ID_CONFLICT'),
      );
    expect(await prisma.stockMovement.count({ where: { appointmentId } })).toBe(
      1,
    );
  });

  it('rejects a canceled appointment with 409 and deducts nothing', async () => {
    const appointmentId = await createAppointment(ana);
    const { itemId } = await createItemWithLot(ana, 10, 5);
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'CANCELED' },
    });

    await request(http)
      .post(`/appointments/${appointmentId}/items`)
      .set('Authorization', bearer(ana))
      .send({ items: [{ itemId, quantity: 1 }] })
      .expect(409)
      .expect(res => expect(body(res).code).toBe('APPOINTMENT_CANCELED'));

    expect(await prisma.stockMovement.count({ where: { appointmentId } })).toBe(
      0,
    );
    const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.currentQuantity.toString()).toBe('10');
  });

  it('accepts a completed appointment', async () => {
    const appointmentId = await createAppointment(ana);
    const { itemId } = await createItemWithLot(ana, 10, 5);
    await prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'COMPLETED' },
    });

    await request(http)
      .post(`/appointments/${appointmentId}/items`)
      .set('Authorization', bearer(ana))
      .send({ items: [{ itemId, quantity: 1 }] })
      .expect(201);
  });

  it('is all-or-nothing: an unknown item rolls back the whole request', async () => {
    const appointmentId = await createAppointment(ana);
    const { itemId } = await createItemWithLot(ana, 10, 5);
    const { itemId: brunoItemId } = await createItemWithLot(bruno, 10, 5);

    await request(http)
      .post(`/appointments/${appointmentId}/items`)
      .set('Authorization', bearer(ana))
      .send({
        items: [
          { itemId, quantity: 1 },
          { itemId: brunoItemId, quantity: 1 },
        ],
      })
      .expect(404)
      .expect(res => expect(body(res).code).toBe('ITEM_NOT_FOUND'));

    expect(await prisma.stockMovement.count({ where: { appointmentId } })).toBe(
      0,
    );
    const mine = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(mine.currentQuantity.toString()).toBe('10');
    const brunoItem = await prisma.item.findUniqueOrThrow({
      where: { id: brunoItemId },
    });
    expect(brunoItem.currentQuantity.toString()).toBe('10');
  });

  it("answers 404 on another account's appointment and changes nothing (ADR-11)", async () => {
    const anaAppointmentId = await createAppointment(ana);
    const { itemId } = await createItemWithLot(bruno, 10, 5);

    await request(http)
      .post(`/appointments/${anaAppointmentId}/items`)
      .set('Authorization', bearer(bruno))
      .send({ items: [{ itemId, quantity: 1 }] })
      .expect(404)
      .expect(res => expect(body(res).code).toBe('APPOINTMENT_NOT_FOUND'));

    expect(
      await prisma.stockMovement.count({
        where: { appointmentId: anaAppointmentId },
      }),
    ).toBe(0);
  });

  it.each([
    ['an empty list', { items: [] }],
    ['a zero quantity', { items: [{ itemId: 'x', quantity: 0 }] }],
    ['a negative quantity', { items: [{ itemId: 'x', quantity: -1 }] }],
    ['a userId in the body', { items: [], userId: 'someone' }],
    [
      'a clientGeneratedId that is not a UUID',
      { items: [{ clientGeneratedId: 'x', itemId: 'x', quantity: 1 }] },
    ],
  ])('rejects %s with 400', async (_label, payload) => {
    const appointmentId = await createAppointment(ana);

    await request(http)
      .post(`/appointments/${appointmentId}/items`)
      .set('Authorization', bearer(ana))
      .send(payload)
      .expect(400);
  });
});
