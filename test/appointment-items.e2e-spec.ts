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

  it('persists the client-supplied occurredAt instead of the appointment startsAt', async () => {
    const appointmentId = await createAppointment(ana);
    const { itemId } = await createItemWithLot(ana, 10, 12.5);
    const occurredAt = '2026-09-24T10:15:00.000Z';

    const response = await request(http)
      .post(`/appointments/${appointmentId}/items`)
      .set('Authorization', bearer(ana))
      .send({ items: [{ itemId, quantity: 3, occurredAt }] })
      .expect(201);

    expect(body(response)).toMatchObject({
      movements: [{ occurredAt }],
    });

    const movement = await prisma.stockMovement.findFirstOrThrow({
      where: { appointmentId },
    });
    expect(movement.occurredAt.toISOString()).toBe(occurredAt);
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

  it('deleting the appointment reverses its supplies, each linked to its original', async () => {
    const appointmentId = await createAppointment(ana);
    const { itemId, lotId } = await createItemWithLot(ana, 10, 5);
    const registered = await request(http)
      .post(`/appointments/${appointmentId}/items`)
      .set('Authorization', bearer(ana))
      .send({ items: [{ itemId, quantity: 3 }] })
      .expect(201);
    const [supply] = body(registered).movements as { id: string }[];

    await request(http)
      .delete(`/appointments/${appointmentId}`)
      .set('Authorization', bearer(ana))
      .expect(200);

    const reversal = await prisma.stockMovement.findUniqueOrThrow({
      where: { reversedMovementId: supply.id },
    });
    expect(reversal).toMatchObject({
      type: 'INBOUND',
      source: 'CORRECTION_REVERSAL',
      itemId,
      lotId,
    });
    expect(reversal.quantity.toString()).toBe('3');
    const item = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(item.currentQuantity.toString()).toBe('10');
    const lot = await prisma.itemLot.findUniqueOrThrow({
      where: { id: lotId },
    });
    expect(lot.currentQuantity.toString()).toBe('10');
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

  describe('editing and removing a saved supply', () => {
    let appointmentId: string;
    let itemId: string;
    let lotId: string;
    let supplyId: string;

    const itemBalance = async () =>
      (
        await prisma.item.findUniqueOrThrow({ where: { id: itemId } })
      ).currentQuantity.toString();
    const lotBalance = async () =>
      (
        await prisma.itemLot.findUniqueOrThrow({ where: { id: lotId } })
      ).currentQuantity.toString();
    const edit = (id: string, payload: object, user: TestUser = ana) =>
      request(http)
        .patch(`/appointments/${appointmentId}/items/${id}`)
        .set('Authorization', bearer(user))
        .send(payload);
    const remove = (id: string, user: TestUser = ana) =>
      request(http)
        .delete(`/appointments/${appointmentId}/items/${id}`)
        .set('Authorization', bearer(user));

    beforeEach(async () => {
      appointmentId = await createAppointment(ana);
      ({ itemId, lotId } = await createItemWithLot(ana, 10, 5));
      const registered = await request(http)
        .post(`/appointments/${appointmentId}/items`)
        .set('Authorization', bearer(ana))
        .send({ items: [{ itemId, quantity: 3 }] })
        .expect(201);
      supplyId = (body(registered).movements as { id: string }[])[0].id;
    });

    it('PATCH reverses the original and records the new quantity, moving the caches by the difference', async () => {
      const response = await edit(supplyId, { quantity: 5 }).expect(200);

      expect(body(response)).toMatchObject({
        appointmentId,
        warnings: [],
        reversal: {
          type: 'INBOUND',
          source: 'CORRECTION_REVERSAL',
          reversedMovementId: supplyId,
          quantity: '3',
        },
        movement: {
          type: 'OUTBOUND',
          source: 'APPOINTMENT',
          itemId,
          lotId,
          quantity: '5',
          unitCost: '5',
          occurredAt: STARTS_AT,
        },
      });
      expect(await itemBalance()).toBe('5');
      expect(await lotBalance()).toBe('5');
      // Append-only: the original row is untouched.
      const original = await prisma.stockMovement.findUniqueOrThrow({
        where: { id: supplyId },
      });
      expect(original.quantity.toString()).toBe('3');
      expect(original.deletedAt).toBeNull();
    });

    it('DELETE reverses the supply and gives the stock back', async () => {
      const response = await remove(supplyId).expect(200);

      expect(body(response)).toMatchObject({
        appointmentId,
        reversal: {
          type: 'INBOUND',
          source: 'CORRECTION_REVERSAL',
          reversedMovementId: supplyId,
          quantity: '3',
        },
      });
      expect(await itemBalance()).toBe('10');
      expect(await lotBalance()).toBe('10');
    });

    it('DELETE is idempotent, even for concurrent copies: one reversal, stock given back once', async () => {
      const responses = await Promise.all([
        remove(supplyId),
        remove(supplyId),
        remove(supplyId),
      ]);
      const again = await remove(supplyId).expect(200);

      expect(responses.map(r => r.status)).toEqual([200, 200, 200]);
      const reversals = await prisma.stockMovement.findMany({
        where: { reversedMovementId: supplyId },
      });
      expect(reversals).toHaveLength(1);
      expect((body(again).reversal as { id: string }).id).toBe(reversals[0].id);
      expect(await itemBalance()).toBe('10');
    });

    it('PATCH resent with the same clientGeneratedId corrects the stock once, even concurrently', async () => {
      const payload = { quantity: 5, clientGeneratedId: randomUUID() };

      const responses = await Promise.all([
        edit(supplyId, payload),
        edit(supplyId, payload),
      ]);
      const again = await edit(supplyId, payload).expect(200);

      expect(responses.map(r => r.status)).toEqual([200, 200]);
      const ids = [...responses, again].map(
        r => (body(r).movement as { id: string }).id,
      );
      expect(new Set(ids).size).toBe(1);
      expect(
        await prisma.stockMovement.count({ where: { appointmentId } }),
      ).toBe(3);
      expect(await itemBalance()).toBe('5');
    });

    it('DELETE with the old id after an edit answers 409 and leaves the replacement in effect', async () => {
      const edited = await edit(supplyId, { quantity: 5 }).expect(200);
      const replacement = body(edited).movement as {
        id: string;
        replacedMovementId: string;
      };
      expect(replacement.replacedMovementId).toBe(supplyId);

      await remove(supplyId)
        .expect(409)
        .expect(res =>
          expect(body(res).code).toBe('STOCK_MOVEMENT_ALREADY_REVERSED'),
        );

      expect(await itemBalance()).toBe('5');
      expect(
        await prisma.stockMovement.count({
          where: { reversedMovementId: replacement.id },
        }),
      ).toBe(0);
    });

    it('PATCH without a key on a supply already corrected answers 409', async () => {
      await edit(supplyId, { quantity: 5 }).expect(200);

      await edit(supplyId, { quantity: 6 })
        .expect(409)
        .expect(res =>
          expect(body(res).code).toBe('STOCK_MOVEMENT_ALREADY_REVERSED'),
        );
      expect(await itemBalance()).toBe('5');
    });

    it('PATCH into a negative balance warns and flags the item', async () => {
      const response = await edit(supplyId, { quantity: 12 }).expect(200);

      expect(body(response).warnings).toEqual([
        { warning: 'insufficient_stock', itemId },
      ]);
      const item = await prisma.item.findUniqueOrThrow({
        where: { id: itemId },
      });
      expect(item.currentQuantity.toString()).toBe('-2');
      expect(item.needsAdjustment).toBe(true);
    });

    it('refuses corrections on a canceled appointment with 409', async () => {
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { status: 'CANCELED' },
      });

      await edit(supplyId, { quantity: 5 })
        .expect(409)
        .expect(res => expect(body(res).code).toBe('APPOINTMENT_CANCELED'));
      await remove(supplyId)
        .expect(409)
        .expect(res => expect(body(res).code).toBe('APPOINTMENT_CANCELED'));
      expect(await itemBalance()).toBe('7');
    });

    it("answers 404 on another account's supply and changes nothing (ADR-11)", async () => {
      await edit(supplyId, { quantity: 5 }, bruno).expect(404);
      await remove(supplyId, bruno).expect(404);

      expect(
        await prisma.stockMovement.count({ where: { appointmentId } }),
      ).toBe(1);
      expect(await itemBalance()).toBe('7');
    });

    it('answers 404 STOCK_MOVEMENT_NOT_FOUND for a reversal', async () => {
      const removed = await remove(supplyId).expect(200);
      const reversalId = (body(removed).reversal as { id: string }).id;

      await edit(reversalId, { quantity: 1 })
        .expect(404)
        .expect(res => expect(body(res).code).toBe('STOCK_MOVEMENT_NOT_FOUND'));
    });

    it('deleting the appointment after an edit reverses only the current supply', async () => {
      const edited = await edit(supplyId, { quantity: 5 }).expect(200);
      const currentId = (body(edited).movement as { id: string }).id;

      await request(http)
        .delete(`/appointments/${appointmentId}`)
        .set('Authorization', bearer(ana))
        .expect(200);

      const reversals = await prisma.stockMovement.findMany({
        where: { appointmentId, source: 'CORRECTION_REVERSAL' },
      });
      expect(reversals.map(r => r.reversedMovementId).sort()).toEqual(
        [supplyId, currentId].sort(),
      );
      expect(await itemBalance()).toBe('10');
      expect(await lotBalance()).toBe('10');
    });

    it.each([
      ['a zero quantity', { quantity: 0 }],
      ['a userId in the body', { quantity: 1, userId: 'someone' }],
      [
        'a clientGeneratedId that is not a UUID',
        { quantity: 1, clientGeneratedId: 'x' },
      ],
    ])('PATCH rejects %s with 400', async (_label, payload) => {
      await edit(supplyId, payload).expect(400);
    });
  });
});
