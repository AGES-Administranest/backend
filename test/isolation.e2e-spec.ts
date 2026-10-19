import { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
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
 * The test ADR-11 asks for by name:
 *
 *   "um teste automatizado por módulo que cria dados de dois usuários e
 *    verifica que um não enxerga o outro. Se vocês só escreverem um tipo de
 *    teste no projeto inteiro, que seja esse."
 *
 * Two real accounts, each authenticating as itself. Every case checks the
 * status *and* re-reads the record as its owner, because a 404 on its own does
 * not prove the write was refused — an endpoint could answer 404 and still have
 * changed the row.
 *
 * Not found, never forbidden: 403 would confirm the record exists, which turns
 * the endpoint into a way to discover other people's ids.
 */
describe('isolation between accounts (ADR-11) (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;

  const ana: TestUser = {
    cognitoSub: 'sub-isolation-ana',
    email: 'ana.isolation@example.com',
    name: 'Ana Souza',
  };

  const bruno: TestUser = {
    cognitoSub: 'sub-isolation-bruno',
    email: 'bruno.isolation@example.com',
    name: 'Bruno Lima',
  };

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

  const createItem = async (user: TestUser, name: string): Promise<string> => {
    const response = await request(http)
      .post('/item')
      .set('Authorization', bearer(user))
      .send({ category: 'MEDICATION', unit: 'AMPOULE', name })
      .expect(201);

    return body(response).id as string;
  };

  /** Reads an item as its owner, to prove an attempted write changed nothing. */
  const readAsOwner = async (user: TestUser, itemId: string) => {
    const response = await request(http)
      .get(`/item/${itemId}`)
      .set('Authorization', bearer(user))
      .expect(200);

    return body(response);
  };

  describe('item', () => {
    it('does not list another account items', async () => {
      await createItem(ana, 'Dipirona da Ana');
      await createItem(bruno, 'Cetamina do Bruno');

      const response = await request(http)
        .get('/item')
        .set('Authorization', bearer(bruno))
        .expect(200);

      const names = (response.body as { name: string }[]).map(i => i.name);
      expect(names).toEqual(['Cetamina do Bruno']);
    });

    it('answers 404, not 403, when reading another account item', async () => {
      const anaItem = await createItem(ana, 'Dipirona da Ana');

      const response = await request(http)
        .get(`/item/${anaItem}`)
        .set('Authorization', bearer(bruno))
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    });

    it('refuses to update another account item, and leaves it untouched', async () => {
      const anaItem = await createItem(ana, 'Dipirona da Ana');

      await request(http)
        .patch(`/item/${anaItem}`)
        .set('Authorization', bearer(bruno))
        .send({ name: 'Renomeado pelo Bruno' })
        .expect(404);

      // The assertion that catches a `where: { id }` update: the status alone
      // would look right even if the row had already been written.
      expect((await readAsOwner(ana, anaItem)).name).toBe('Dipirona da Ana');
    });

    it('refuses to delete another account item, and leaves it active', async () => {
      const anaItem = await createItem(ana, 'Dipirona da Ana');

      await request(http)
        .delete(`/item/${anaItem}`)
        .set('Authorization', bearer(bruno))
        .expect(404);

      expect((await readAsOwner(ana, anaItem)).active).toBe(true);
    });

    it('refuses to add stock to another account item, and moves no quantity', async () => {
      const anaItem = await createItem(ana, 'Dipirona da Ana');

      await request(http)
        .post(`/item/${anaItem}/lot`)
        .set('Authorization', bearer(bruno))
        .send({ quantity: 10, unitCost: 5 })
        .expect(404);

      expect((await readAsOwner(ana, anaItem)).currentQuantity).toBe('0');
      expect(await prisma.stockMovement.count()).toBe(0);
    });

    it('cannot reassign an item by sending a userId', async () => {
      const brunoItem = await createItem(bruno, 'Cetamina do Bruno');
      const anaRow = await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: ana.cognitoSub },
      });

      // `userId` is not in the DTO any more, and `forbidNonWhitelisted` makes
      // sending it a 400 rather than a silent transfer of the record.
      await request(http)
        .patch(`/item/${brunoItem}`)
        .set('Authorization', bearer(bruno))
        .send({ userId: anaRow.id })
        .expect(400);

      const stored = await prisma.item.findUniqueOrThrow({
        where: { id: brunoItem },
      });
      expect(stored.userId).not.toBe(anaRow.id);
    });
  });

  describe('stock-movements', () => {
    const today = () => new Date().toISOString();

    it('refuses an adjustment on another account item, and moves no quantity', async () => {
      const anaItem = await createItem(ana, 'Dipirona da Ana');
      await request(http)
        .post('/stock-movement/purchase')
        .set('Authorization', bearer(ana))
        .send({ itemId: anaItem, quantity: 10, unitValue: 5, date: today() })
        .expect(201);

      const response = await request(http)
        .post('/stock-movement/adjustment')
        .set('Authorization', bearer(bruno))
        .send({ itemId: anaItem, quantity: 3, reason: 'LOSS' })
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'ITEM_NOT_FOUND' });
      expect((await readAsOwner(ana, anaItem)).currentQuantity).toBe('10');
      expect(await prisma.stockMovement.count()).toBe(1);
    });

    it('refuses a purchase into another account item, and moves no quantity', async () => {
      const anaItem = await createItem(ana, 'Dipirona da Ana');

      const response = await request(http)
        .post('/stock-movement/purchase')
        .set('Authorization', bearer(bruno))
        .send({ itemId: anaItem, quantity: 10, unitValue: 5, date: today() })
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'ITEM_NOT_FOUND' });
      expect((await readAsOwner(ana, anaItem)).currentQuantity).toBe('0');
      expect(await prisma.stockMovement.count()).toBe(0);
    });

    it('treats another account supplier as one that does not exist', async () => {
      const brunoItem = await createItem(bruno, 'Cetamina do Bruno');
      const supplier = await request(http)
        .post('/supplier')
        .set('Authorization', bearer(ana))
        .send({ name: 'Distribuidora da Ana' })
        .expect(201);

      // Same answer as a random id, so the response cannot confirm that the
      // supplier exists in someone else's account.
      const response = await request(http)
        .post('/stock-movement/purchase')
        .set('Authorization', bearer(bruno))
        .send({
          itemId: brunoItem,
          supplierId: body(supplier).id,
          quantity: 10,
          unitValue: 5,
          date: today(),
        })
        .expect(422);

      expect(body(response)).toMatchObject({ code: 'SUPPLIER_NOT_FOUND' });
      expect(await prisma.stockMovement.count()).toBe(0);
    });
  });

  describe('stock-entry', () => {
    const uploadRequest = (fileHash: string) => ({
      filename: 'nota.pdf',
      fileMimeType: 'application/pdf',
      fileHash,
      fileBytesSize: 1024,
    });

    /** The app picks the invoice id, so a draft is born on the first issue. */
    const issueUploadUrl = (user: TestUser, invoiceId: string, hash: string) =>
      request(http)
        .post(`/stock-entries/${invoiceId}/upload-url`)
        .set('Authorization', bearer(user))
        .send(uploadRequest(hash));

    it('answers 404, not 403, when issuing an upload url for another account invoice, and leaves it untouched', async () => {
      const invoiceId = randomUUID();
      await issueUploadUrl(ana, invoiceId, 'a'.repeat(64)).expect(200);

      const response = await issueUploadUrl(
        bruno,
        invoiceId,
        'b'.repeat(64),
      ).expect(404);

      expect(body(response)).toMatchObject({ code: 'INVOICE_NOT_FOUND' });

      // The id collided on the primary key: the fallback must not take the
      // row over, nor rewrite its document.
      const anaRow = await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: ana.cognitoSub },
      });
      const stored = await prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
      });
      expect(stored.userId).toBe(anaRow.id);
      expect(stored.fileHash).toBe('a'.repeat(64));
      expect(stored.fileUrl).toBe(
        `users/${anaRow.id}/purchase-invoices/${invoiceId}/original`,
      );
    });

    it('cannot claim an invoice for another account by sending a userId', async () => {
      const anaRow = await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: ana.cognitoSub },
      });
      const invoiceId = randomUUID();

      await request(http)
        .post(`/stock-entries/${invoiceId}/upload-url`)
        .set('Authorization', bearer(bruno))
        .send({ ...uploadRequest('c'.repeat(64)), userId: anaRow.id })
        .expect(400);

      expect(
        await prisma.purchaseInvoice.count({ where: { id: invoiceId } }),
      ).toBe(0);
    });

    /** A draft, with the header the app would have read. */
    const draftOf = async (user: TestUser): Promise<string> => {
      const invoiceId = randomUUID();
      const fileHash = randomBytes(32).toString('hex');
      await issueUploadUrl(user, invoiceId, fileHash).expect(200);
      await prisma.purchaseInvoice.update({
        where: { id: invoiceId },
        data: { number: '4521' },
      });
      return invoiceId;
    };

    const readInvoice = (invoiceId: string) =>
      prisma.purchaseInvoice.findUniqueOrThrow({
        where: { id: invoiceId },
        include: { lines: true },
      });

    it('does not list another account drafts', async () => {
      await draftOf(ana);
      const brunoDraft = await draftOf(bruno);

      const response = await request(http)
        .get('/stock-entries')
        .set('Authorization', bearer(bruno))
        .expect(200);

      // Bruno's own draft is there: an empty list would pass for a query that
      // returns nothing to anyone.
      const ids = (response.body as { id: string }[]).map(draft => draft.id);
      expect(ids).toEqual([brunoDraft]);
    });

    it('answers 404, not 403, when reading another account draft', async () => {
      const invoiceId = await draftOf(ana);

      const response = await request(http)
        .get(`/stock-entries/${invoiceId}`)
        .set('Authorization', bearer(bruno))
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'INVOICE_NOT_FOUND' });

      // Its owner reads it: the 404 is about the account, not a broken read.
      await request(http)
        .get(`/stock-entries/${invoiceId}`)
        .set('Authorization', bearer(ana))
        .expect(200);
    });

    it('refuses to save the review of another account draft, and leaves it untouched', async () => {
      const invoiceId = await draftOf(ana);

      await request(http)
        .patch(`/stock-entries/${invoiceId}`)
        .set('Authorization', bearer(bruno))
        .send({ invoiceNumber: '9999' })
        .expect(404);
      await request(http)
        .put(`/stock-entries/${invoiceId}/items`)
        .set('Authorization', bearer(bruno))
        .send({ lines: [{ description: 'SERINGA 10ML' }] })
        .expect(404);

      const stored = await readInvoice(invoiceId);
      expect(stored.number).toBe('4521');
      expect(stored.lines).toEqual([]);
    });

    it('refuses to discard another account draft, and leaves it a draft', async () => {
      const invoiceId = await draftOf(ana);

      await request(http)
        .delete(`/stock-entries/${invoiceId}`)
        .set('Authorization', bearer(bruno))
        .expect(404);

      expect((await readInvoice(invoiceId)).status).toBe('DRAFT');
    });

    it('does not let a line be linked to another account item', async () => {
      const invoiceId = await draftOf(ana);
      const brunoItem = await createItem(bruno, 'Cetamina do Bruno');

      const response = await request(http)
        .put(`/stock-entries/${invoiceId}/items`)
        .set('Authorization', bearer(ana))
        .send({ lines: [{ description: 'CETAMINA', itemId: brunoItem }] })
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'ITEM_NOT_FOUND' });
      expect((await readInvoice(invoiceId)).lines).toEqual([]);
    });
  });

  describe('appointments', () => {
    const createAppointment = async (
      user: TestUser,
      startsAt: string,
      endsAt: string,
    ): Promise<string> => {
      const response = await request(http)
        .post('/appointments')
        .set('Authorization', bearer(user))
        .send({ startsAt, endsAt, procedureName: 'Consulta' })
        .expect(201);

      return body(response).id as string;
    };

    // The seed migration creates this system category, but resetDatabase's
    // TRUNCATE ... CASCADE wipes it along with everything that references
    // "user". Without it a leaking /complete would fail with a 500 instead of
    // posting revenue, and the "no entry was posted" check would prove nothing.
    beforeEach(async () => {
      await prisma.financialCategory.create({
        data: {
          userId: null,
          name: 'Professional fees',
          nature: 'INCOME',
          defaultScope: 'PROFESSIONAL',
        },
      });
    });

    it('does not let one account conflict-check against another account schedule', async () => {
      await createAppointment(
        ana,
        '2026-09-25T13:00:00.000Z',
        '2026-09-25T14:00:00.000Z',
      );

      const response = await request(http)
        .get('/appointments/check-conflict')
        .query({
          startsAt: '2026-09-25T13:00:00.000Z',
          endsAt: '2026-09-25T14:00:00.000Z',
        })
        .set('Authorization', bearer(bruno))
        .expect(200);

      expect(body(response)).toEqual({ conflict: false });
    });

    it('refuses to update another account appointment, and leaves it untouched', async () => {
      const anaAppointment = await createAppointment(
        ana,
        '2026-09-25T13:00:00.000Z',
        '2026-09-25T14:00:00.000Z',
      );

      const response = await request(http)
        .patch(`/appointments/${anaAppointment}`)
        .set('Authorization', bearer(bruno))
        .send({ procedureName: 'Renomeado pelo Bruno' })
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });

      const stored = await prisma.appointment.findUniqueOrThrow({
        where: { id: anaAppointment },
      });
      expect(stored.procedureName).toBe('Consulta');
    });

    it('refuses to complete another account appointment, and posts no revenue', async () => {
      const anaAppointment = await createAppointment(
        ana,
        '2026-09-25T13:00:00.000Z',
        '2026-09-25T14:00:00.000Z',
      );

      const response = await request(http)
        .patch(`/appointments/${anaAppointment}/complete`)
        .set('Authorization', bearer(bruno))
        .send({ amount: 250 })
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });

      const stored = await prisma.appointment.findUniqueOrThrow({
        where: { id: anaAppointment },
      });
      expect(stored.status).toBe('SCHEDULED');
      expect(stored.amount).toBeNull();
      expect(await prisma.financialEntry.count()).toBe(0);
    });

    it('refuses to cancel another account appointment, and posts no revenue', async () => {
      const anaAppointment = await createAppointment(
        ana,
        '2026-09-25T13:00:00.000Z',
        '2026-09-25T14:00:00.000Z',
      );

      const response = await request(http)
        .patch(`/appointments/${anaAppointment}/cancel`)
        .set('Authorization', bearer(bruno))
        .send({ reason: 'Patient did not attend' })
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'APPOINTMENT_NOT_FOUND' });

      const stored = await prisma.appointment.findUniqueOrThrow({
        where: { id: anaAppointment },
      });
      expect(stored.status).toBe('SCHEDULED');
      expect(stored.notes).toBeNull();
      expect(await prisma.financialEntry.count()).toBe(0);
    });
  });

  describe('vehicles', () => {
    const createVehicle = async (
      user: TestUser,
      model: string,
    ): Promise<string> => {
      const response = await request(http)
        .post('/vehicles')
        .set('Authorization', bearer(user))
        .send({
          brand: 'Fiat',
          model,
          fuelType: 'GASOLINE',
          avgConsumptionKmL: 12.5,
          fuelPrice: 5.899,
        })
        .expect(201);

      return body(response).id as string;
    };

    const readVehicleAsOwner = async (user: TestUser, vehicleId: string) => {
      const response = await request(http)
        .get(`/vehicles/${vehicleId}`)
        .set('Authorization', bearer(user))
        .expect(200);

      return body(response);
    };

    it('does not list another account vehicles, active or inactive', async () => {
      await createVehicle(ana, 'Strada da Ana');
      await createVehicle(bruno, 'Toro do Bruno');
      const anaInactive = await createVehicle(ana, 'Uno da Ana');
      await request(http)
        .delete(`/vehicles/${anaInactive}`)
        .set('Authorization', bearer(ana))
        .expect(200);

      for (const active of ['true', 'false']) {
        const response = await request(http)
          .get('/vehicles')
          .query({ active })
          .set('Authorization', bearer(bruno))
          .expect(200);

        const models = (response.body as { model: string }[]).map(v => v.model);
        expect(models).toEqual(active === 'true' ? ['Toro do Bruno'] : []);
      }
    });

    it('answers 404, not 403, when reading another account vehicle', async () => {
      const anaVehicle = await createVehicle(ana, 'Strada da Ana');

      const response = await request(http)
        .get(`/vehicles/${anaVehicle}`)
        .set('Authorization', bearer(bruno))
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
    });

    it('refuses to update another account vehicle, and leaves it untouched', async () => {
      const anaVehicle = await createVehicle(ana, 'Strada da Ana');

      const response = await request(http)
        .patch(`/vehicles/${anaVehicle}`)
        .set('Authorization', bearer(bruno))
        .send({ fuelPrice: 9.999, model: 'Renomeado pelo Bruno' })
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
      expect(await readVehicleAsOwner(ana, anaVehicle)).toMatchObject({
        model: 'Strada da Ana',
        fuelPrice: '5.899',
      });
    });

    it('refuses to inactivate another account vehicle, and leaves it active', async () => {
      const anaVehicle = await createVehicle(ana, 'Strada da Ana');

      const response = await request(http)
        .delete(`/vehicles/${anaVehicle}`)
        .set('Authorization', bearer(bruno))
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'VEHICLE_NOT_FOUND' });
      expect((await readVehicleAsOwner(ana, anaVehicle)).active).toBe(true);
    });

    it('cannot reassign a vehicle by sending a userId', async () => {
      const brunoVehicle = await createVehicle(bruno, 'Toro do Bruno');
      const anaRow = await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: ana.cognitoSub },
      });

      await request(http)
        .patch(`/vehicles/${brunoVehicle}`)
        .set('Authorization', bearer(bruno))
        .send({ userId: anaRow.id })
        .expect(400);

      const stored = await prisma.vehicle.findUniqueOrThrow({
        where: { id: brunoVehicle },
      });
      expect(stored.userId).not.toBe(anaRow.id);
    });
  });

  describe('trips', () => {
    // Each trip posts its expense under the default Travel category, which
    // resetDatabase's TRUNCATE ... CASCADE wipes with everything else.
    beforeEach(async () => {
      await ensureDefaultFinancialCategories(prisma);
    });

    /** The trip's expense as stored, to prove an attempted write left it alone. */
    const expenseOf = (tripId: string) =>
      prisma.financialEntry.findUniqueOrThrow({ where: { tripId } });

    const createVehicle = async (user: TestUser): Promise<string> => {
      const response = await request(http)
        .post('/vehicles')
        .set('Authorization', bearer(user))
        .send({
          brand: 'Fiat',
          model: 'Strada',
          fuelType: 'FLEX',
          avgConsumptionKmL: 12.5,
          fuelPrice: 5.899,
        })
        .expect(201);

      return body(response).id as string;
    };

    const createTrip = async (
      user: TestUser,
      fields: Record<string, unknown> = {},
    ): Promise<string> => {
      const response = await request(http)
        .post('/trips')
        .set('Authorization', bearer(user))
        .send({
          mode: 'RIDE',
          occurredOn: '2026-10-18',
          origin: 'Casa',
          destination: 'Clinica da Ana',
          cost: 32.9,
          ...fields,
        })
        .expect(201);

      return body(response).id as string;
    };

    const readTripAsOwner = async (user: TestUser, tripId: string) => {
      const response = await request(http)
        .get(`/trips/${tripId}`)
        .set('Authorization', bearer(user))
        .expect(200);

      return body(response);
    };

    it('does not list another account trips, nor count them in the totals', async () => {
      const anaVehicle = await createVehicle(ana);
      await createTrip(ana, {
        mode: 'OWN_VEHICLE',
        vehicleId: anaVehicle,
        cost: undefined,
        distanceKm: 300,
      });
      await createTrip(ana);
      await createTrip(bruno, { destination: 'Clinica do Bruno', cost: 10 });

      const response = await request(http)
        .get('/trips')
        .query({ from: '2026-10-01', to: '2026-10-31' })
        .set('Authorization', bearer(bruno))
        .expect(200);

      expect(body(response)).toMatchObject({
        total: 1,
        totalKm: '0.00',
        totalCost: '10.00',
      });
      const destinations = (
        body(response).items as { destination: string }[]
      ).map(trip => trip.destination);
      expect(destinations).toEqual(['Clinica do Bruno']);
    });

    it('answers 404, not 403, when reading another account trip', async () => {
      const anaTrip = await createTrip(ana);

      const response = await request(http)
        .get(`/trips/${anaTrip}`)
        .set('Authorization', bearer(bruno))
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'TRIP_NOT_FOUND' });
    });

    it('refuses to update another account trip, and leaves it untouched', async () => {
      const anaTrip = await createTrip(ana);

      const response = await request(http)
        .patch(`/trips/${anaTrip}`)
        .set('Authorization', bearer(bruno))
        .send({ cost: 999, destination: 'Renomeado pelo Bruno' })
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'TRIP_NOT_FOUND' });
      expect(await readTripAsOwner(ana, anaTrip)).toMatchObject({
        destination: 'Clinica da Ana',
        cost: '32.9',
      });
      const expense = await expenseOf(anaTrip);
      expect(expense.amount.toString()).toBe('32.9');
      expect(expense.description).toBe('Casa → Clinica da Ana');
    });

    it('refuses to delete another account trip, and leaves it in place', async () => {
      const anaTrip = await createTrip(ana);

      const response = await request(http)
        .delete(`/trips/${anaTrip}`)
        .set('Authorization', bearer(bruno))
        .expect(404);

      expect(body(response)).toMatchObject({ code: 'TRIP_NOT_FOUND' });
      await readTripAsOwner(ana, anaTrip);
      expect((await expenseOf(anaTrip)).deletedAt).toBeNull();
    });

    it('refuses a trip that points at another account vehicle, appointment or client', async () => {
      const anaVehicle = await createVehicle(ana);
      const anaAppointment = body(
        await request(http)
          .post('/appointments')
          .set('Authorization', bearer(ana))
          .send({
            startsAt: '2026-10-18T13:00:00.000Z',
            endsAt: '2026-10-18T14:00:00.000Z',
          })
          .expect(201),
      ).id as string;
      const anaClient = body(
        await request(http)
          .post('/client')
          .set('Authorization', bearer(ana))
          .send({ type: 'CLINIC', name: 'Clinica da Ana' })
          .expect(201),
      ).id as string;

      const ride = {
        mode: 'RIDE',
        occurredOn: '2026-10-18',
        origin: 'Casa',
        destination: 'Clinica',
        cost: 10,
      };
      const cases: [Record<string, unknown>, string][] = [
        [
          {
            mode: 'OWN_VEHICLE',
            vehicleId: anaVehicle,
            occurredOn: '2026-10-18',
            origin: 'Casa',
            destination: 'Clinica',
            distanceKm: 10,
          },
          'VEHICLE_NOT_FOUND',
        ],
        [{ ...ride, appointmentId: anaAppointment }, 'APPOINTMENT_NOT_FOUND'],
        [{ ...ride, clientId: anaClient }, 'CLIENT_NOT_FOUND'],
      ];
      for (const [trip, code] of cases) {
        const response = await request(http)
          .post('/trips')
          .set('Authorization', bearer(bruno))
          .send(trip)
          .expect(422);

        expect(body(response)).toMatchObject({ code });
      }
      expect(await prisma.financialEntry.count()).toBe(0);
      expect(await prisma.trip.count()).toBe(0);
    });

    it('refuses another account device id, and leaves that trip untouched', async () => {
      const anaTrip = await createTrip(ana);

      const response = await request(http)
        .post('/trips')
        .set('Authorization', bearer(bruno))
        .send({
          id: anaTrip,
          mode: 'RIDE',
          occurredOn: '2026-10-18',
          origin: 'Casa',
          destination: 'Clinica da Ana',
          cost: 32.9,
        })
        .expect(409);

      expect(body(response)).toMatchObject({ code: 'TRIP_ID_CONFLICT' });
      const stored = await prisma.trip.findUniqueOrThrow({
        where: { id: anaTrip },
      });
      const anaRow = await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: ana.cognitoSub },
      });
      expect(stored.userId).toBe(anaRow.id);
      expect(await prisma.trip.count()).toBe(1);
      expect(await prisma.financialEntry.count()).toBe(1);
      expect((await expenseOf(anaTrip)).userId).toBe(anaRow.id);
    });

    it('cannot reassign a trip by sending a userId', async () => {
      const brunoTrip = await createTrip(bruno);
      const anaRow = await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: ana.cognitoSub },
      });

      await request(http)
        .patch(`/trips/${brunoTrip}`)
        .set('Authorization', bearer(bruno))
        .send({ userId: anaRow.id })
        .expect(400);

      const stored = await prisma.trip.findUniqueOrThrow({
        where: { id: brunoTrip },
      });
      expect(stored.userId).not.toBe(anaRow.id);
    });
  });

  describe('users', () => {
    it('keeps each account terms consent to itself', async () => {
      await request(http)
        .post('/auth/terms')
        .set('Authorization', bearer(ana))
        .send({ termsVersion: '2026-09-01' })
        .expect(200);

      const stored = await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: bruno.cognitoSub },
      });
      expect(stored.termsAcceptedAt).toBeNull();
    });

    // `GET /users` still returns every account, and `GET /users/:id` still
    // reads any of them. Both are behind the guard now, so this is no longer
    // open to the world — but it is open to every authenticated account, which
    // ADR-11 does not allow. Scoping them is a published-API change (see the
    // open questions on the PR), so it is deliberately not done here, and this
    // is the test that will assert it once the shape is decided.
    it.todo('does not let one account read another through /users');
  });
});
