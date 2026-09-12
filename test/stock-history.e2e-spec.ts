import { INestApplication } from '@nestjs/common';
import {
  AdjustmentReason,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';
import request from 'supertest';
import { App } from 'supertest/types';

import { seedItem, seedMovement, seedUser } from './helpers/stock-ledger';
import {
  asUser,
  body,
  createTestApp,
  resetDatabase,
  TEST_USER_HEADER,
  TestUser,
} from './helpers/test-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';

const { INBOUND, OUTBOUND } = StockMovementType;
const { MANUAL_PURCHASE, ORDER_IMPORT, APPOINTMENT, MANUAL_ADJUSTMENT } =
  StockMovementSource;

/** `PrismaClient.$on` is typed from the constructor's `log`, which our subclass hides. */
interface QueryEventSource {
  $on(event: 'query', listener: () => void): void;
}

interface HistoryEntry {
  id: string;
  itemName: string;
  type: string;
  source: string;
  quantity: string;
  totalValue: string;
  occurredAt: string;
  adjustmentReason: string | null;
  appointmentId: string | null;
  purchaseOrderId: string | null;
  appointment: { patientName: string; procedureName: string } | null;
  purchaseOrder: { number: string; supplierName: string } | null;
  supplierName: string | null;
}

interface HistoryPage {
  data: HistoryEntry[];
  page: number;
  limit: number;
  total: number;
}

/**
 * The stock history against a real Postgres: the acceptance criteria of US12
 * end to end, plus the two things only a database can prove — that one user
 * never sees another's rows (ADR-11) and that resolving the origins costs a
 * fixed number of statements, whatever the page size (no N+1).
 */
describe('stock history (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;
  let statements = 0;

  const ana: TestUser = {
    cognitoSub: 'sub-ana',
    email: 'ana@example.com',
    name: 'Ana Souza',
  };
  const bruno: TestUser = {
    cognitoSub: 'sub-bruno',
    email: 'bruno@example.com',
    name: 'Bruno Lima',
  };

  beforeAll(async () => {
    process.env.PRISMA_LOG_QUERIES = 'true';
    ({ app, prisma } = await createTestApp());
    http = app.getHttpServer() as App;
    (prisma as unknown as QueryEventSource).$on('query', () => {
      statements += 1;
    });
  });

  beforeEach(() => resetDatabase(prisma));

  afterAll(async () => {
    delete process.env.PRISMA_LOG_QUERIES;
    await app.close();
  });

  const get = (path: string, user?: TestUser) => {
    const req = request(http).get(path);
    return user ? req.set(TEST_USER_HEADER, asUser(user)) : req;
  };

  const page = (response: { body: unknown }) =>
    body(response) as unknown as HistoryPage;

  /**
   * Ana's ledger for Propofol.
   *   August:    +6 imported from order PO-2026-007, −2 lost
   *              → opening balance 4 for September
   *   September: +10 bought from VetPharma, −3 (Rex) and −2 (Luna) in two
   *              castrations, −1 expired on the evening of the 30th
   *              → closing balance 8
   *   October:   +4 bought (outside the period)
   * Plus one Ketamine consumption in September, for the item filter.
   */
  async function seedAna() {
    const anaId = await seedUser(prisma, ana);
    const propofol = await seedItem(prisma, anaId, 'Propofol');
    const ketamine = await seedItem(prisma, anaId, 'Ketamine');
    const vetPharma = await prisma.supplier.create({
      data: { userId: anaId, name: 'VetPharma' },
    });
    const order = await prisma.purchaseOrder.create({
      data: { userId: anaId, number: 'PO-2026-007', supplierId: vetPharma.id },
    });
    const rex = await prisma.appointment.create({
      data: {
        userId: anaId,
        startsAt: new Date('2026-09-10T13:30:00.000Z'),
        patientName: 'Rex',
        procedureName: 'Castration',
      },
    });
    const luna = await prisma.appointment.create({
      data: {
        userId: anaId,
        startsAt: new Date('2026-09-15T09:00:00.000Z'),
        patientName: 'Luna',
        procedureName: 'Castration',
      },
    });

    const movement = (
      seed: Parameters<typeof seedMovement>[3],
      itemId = propofol.id,
    ) => seedMovement(prisma, anaId, itemId, seed);

    await movement({
      type: INBOUND,
      source: ORDER_IMPORT,
      quantity: 6,
      occurredAt: '2026-08-05T10:00:00.000Z',
      purchaseOrderId: order.id,
    });
    await movement({
      type: OUTBOUND,
      source: MANUAL_ADJUSTMENT,
      quantity: 2,
      occurredAt: '2026-08-20T10:00:00.000Z',
      adjustmentReason: AdjustmentReason.LOSS,
    });
    await movement({
      type: INBOUND,
      source: MANUAL_PURCHASE,
      quantity: 10,
      occurredAt: '2026-09-02T10:00:00.000Z',
      supplierId: vetPharma.id,
    });
    await movement({
      type: OUTBOUND,
      source: APPOINTMENT,
      quantity: 3,
      occurredAt: '2026-09-10T14:00:00.000Z',
      appointmentId: rex.id,
    });
    await movement({
      type: OUTBOUND,
      source: APPOINTMENT,
      quantity: 2,
      occurredAt: '2026-09-15T09:30:00.000Z',
      appointmentId: luna.id,
    });
    await movement({
      type: OUTBOUND,
      source: MANUAL_ADJUSTMENT,
      quantity: 1,
      occurredAt: '2026-09-30T18:00:00.000Z',
      adjustmentReason: AdjustmentReason.EXPIRATION,
    });
    await movement({
      type: INBOUND,
      source: MANUAL_PURCHASE,
      quantity: 4,
      occurredAt: '2026-10-01T10:00:00.000Z',
    });
    await movement(
      {
        type: OUTBOUND,
        source: APPOINTMENT,
        quantity: 1,
        occurredAt: '2026-09-12T11:00:00.000Z',
        appointmentId: rex.id,
      },
      ketamine.id,
    );

    return { anaId, propofol, ketamine, order, rex, luna, vetPharma };
  }

  async function seedBruno() {
    const brunoId = await seedUser(prisma, bruno);
    const item = await seedItem(prisma, brunoId, 'Propofol');
    const movement = await seedMovement(prisma, brunoId, item.id, {
      type: INBOUND,
      source: MANUAL_PURCHASE,
      quantity: 100,
      occurredAt: '2026-09-05T10:00:00.000Z',
    });
    return { brunoId, item, movement };
  }

  describe('GET /stock-movements', () => {
    it('rejects a request with no authenticated user', async () => {
      const response = await get('/stock-movements').expect(401);

      expect(body(response)).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('answers 404 with its own code when the local mirror does not exist', async () => {
      const response = await get('/stock-movements', ana).expect(404);

      expect(body(response)).toMatchObject({ code: 'USER_NOT_PROVISIONED' });
    });

    it('lists every kind of movement, newest first, with date, quantity and origin', async () => {
      await seedAna();

      const result = page(await get('/stock-movements', ana).expect(200));

      expect(result).toMatchObject({ page: 1, limit: 20, total: 8 });
      expect(result.data.map(entry => entry.occurredAt)).toEqual(
        [...result.data.map(entry => entry.occurredAt)].sort().reverse(),
      );
      expect(new Set(result.data.map(entry => entry.source))).toEqual(
        new Set([
          MANUAL_PURCHASE,
          ORDER_IMPORT,
          APPOINTMENT,
          MANUAL_ADJUSTMENT,
        ]),
      );
      for (const entry of result.data) {
        expect(entry).toMatchObject({
          itemName: expect.any(String) as string,
          quantity: expect.any(String) as string,
          totalValue: expect.any(String) as string,
          occurredAt: expect.any(String) as string,
        });
      }
    });

    it('links a consumption to its appointment: patient, procedure and id', async () => {
      const { rex } = await seedAna();

      const result = page(
        await get('/stock-movements?source=APPOINTMENT', ana).expect(200),
      );
      const consumption = result.data.find(entry => entry.quantity === '3');

      expect(consumption).toMatchObject({
        type: OUTBOUND,
        appointmentId: rex.id,
        appointment: { patientName: 'Rex', procedureName: 'Castration' },
        totalValue: '15.00',
      });
    });

    it('links an order import to its purchase order: number, supplier and id', async () => {
      const { order } = await seedAna();

      const result = page(
        await get('/stock-movements?source=ORDER_IMPORT', ana).expect(200),
      );

      expect(result.total).toBe(1);
      expect(result.data[0]).toMatchObject({
        type: INBOUND,
        purchaseOrderId: order.id,
        purchaseOrder: { number: 'PO-2026-007', supplierName: 'VetPharma' },
      });
    });

    it('shows the reason of a manual adjustment, and the supplier of a manual purchase', async () => {
      await seedAna();

      const adjustments = page(
        await get('/stock-movements?source=MANUAL_ADJUSTMENT', ana).expect(200),
      );
      const purchases = page(
        await get('/stock-movements?source=MANUAL_PURCHASE', ana).expect(200),
      );

      expect(adjustments.data.map(entry => entry.adjustmentReason)).toEqual([
        AdjustmentReason.EXPIRATION,
        AdjustmentReason.LOSS,
      ]);
      expect(purchases.data.map(entry => entry.supplierName)).toEqual([
        null,
        'VetPharma',
      ]);
    });

    it('filters by item and by period on their own, and combined', async () => {
      const { propofol, ketamine } = await seedAna();
      const september = 'startDate=2026-09-01&endDate=2026-09-30';

      const byItem = page(
        await get(`/stock-movements?itemId=${propofol.id}`, ana).expect(200),
      );
      const byPeriod = page(
        await get(`/stock-movements?${september}`, ana).expect(200),
      );
      const combined = page(
        await get(
          `/stock-movements?itemId=${ketamine.id}&${september}`,
          ana,
        ).expect(200),
      );
      const withDirection = page(
        await get(
          `/stock-movements?itemId=${propofol.id}&${september}&type=OUTBOUND`,
          ana,
        ).expect(200),
      );

      expect(byItem.total).toBe(7);
      // 4 Propofol + 1 Ketamine; August and October stay out; the plain
      // endDate covers the evening of the 30th.
      expect(byPeriod.total).toBe(5);
      expect(combined.total).toBe(1);
      expect(combined.data[0].itemName).toBe('Ketamine');
      expect(withDirection.total).toBe(3);
    });

    it('paginates with a total and no overlap between pages', async () => {
      await seedAna();

      const pages = await Promise.all(
        [1, 2, 3].map(async number =>
          page(
            await get(`/stock-movements?limit=3&page=${number}`, ana).expect(
              200,
            ),
          ),
        ),
      );
      const ids = pages.flatMap(result => result.data.map(entry => entry.id));

      expect(pages.map(result => result.data.length)).toEqual([3, 3, 2]);
      expect(pages.every(result => result.total === 8)).toBe(true);
      expect(new Set(ids).size).toBe(8);
    });

    it('leaves soft-deleted movements out', async () => {
      const { anaId, propofol } = await seedAna();
      await seedMovement(prisma, anaId, propofol.id, {
        type: INBOUND,
        source: MANUAL_PURCHASE,
        quantity: 999,
        occurredAt: '2026-09-03T10:00:00.000Z',
        deletedAt: new Date(),
      });

      const result = page(await get('/stock-movements', ana).expect(200));

      expect(result.total).toBe(8);
      expect(result.data.some(entry => entry.quantity === '999')).toBe(false);
    });

    it('rejects an invalid filter with the shared error shape', async () => {
      await seedAna();

      const tooLarge = await get('/stock-movements?limit=101', ana).expect(400);
      const inverted = await get(
        '/stock-movements?startDate=2026-09-30&endDate=2026-09-01',
        ana,
      ).expect(400);

      expect(body(tooLarge)).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(body(inverted)).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { fields: ['endDate must not be before startDate'] },
      });
    });

    describe('isolation between users (ADR-11)', () => {
      it("never lists another user's movements, and answers 404 for another user's item", async () => {
        await seedAna();
        const { item, movement } = await seedBruno();

        const anaList = page(await get('/stock-movements', ana).expect(200));
        const brunoList = page(
          await get('/stock-movements', bruno).expect(200),
        );
        const probe = await get(
          `/stock-movements?itemId=${item.id}`,
          ana,
        ).expect(404);

        expect(anaList.total).toBe(8);
        expect(anaList.data.some(entry => entry.id === movement.id)).toBe(
          false,
        );
        expect(brunoList.total).toBe(1);
        expect(body(probe)).toMatchObject({ code: 'ITEM_NOT_FOUND' });
      });
    });

    describe('origins are resolved without N+1', () => {
      it('runs the same number of statements for a page of 5 and a page of 20', async () => {
        const anaId = await seedUser(prisma, ana);
        const item = await seedItem(prisma, anaId, 'Propofol');
        // 25 consumptions, each with its own appointment: a per-row lookup
        // would show up as 25 extra statements on the larger page.
        for (let index = 0; index < 25; index += 1) {
          const appointment = await prisma.appointment.create({
            data: {
              userId: anaId,
              startsAt: new Date(Date.UTC(2026, 8, 1 + index, 10)),
              patientName: `Patient ${index}`,
              procedureName: 'Castration',
            },
          });
          await seedMovement(prisma, anaId, item.id, {
            type: OUTBOUND,
            source: APPOINTMENT,
            quantity: 1,
            occurredAt: new Date(
              Date.UTC(2026, 8, 1 + index, 11),
            ).toISOString(),
            appointmentId: appointment.id,
          });
        }

        const statementsFor = async (limit: number) => {
          statements = 0;
          const result = page(
            await get(`/stock-movements?limit=${limit}`, ana).expect(200),
          );
          expect(result.data.length).toBe(limit);
          expect(result.data.every(entry => entry.appointment !== null)).toBe(
            true,
          );
          return statements;
        };

        await statementsFor(5); // warm-up: connection setup must not count
        const small = await statementsFor(5);
        const large = await statementsFor(20);

        expect(large).toBe(small);
        // Measured at 8: the user lookup, the page, one load per included
        // relation (item, appointment, purchase order, supplier) and the
        // count. A per-request addition shows up here; a per-row one above.
        expect(large).toBeLessThanOrEqual(10);
      });
    });
  });

  describe('GET /stock-movements/summary', () => {
    it('rejects a request with no authenticated user', async () => {
      const response = await get('/stock-movements/summary').expect(401);

      expect(body(response)).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('consolidates the period: totals with money, consumption by procedure, losses by reason', async () => {
      await seedAna();

      const response = await get(
        '/stock-movements/summary?startDate=2026-09-01&endDate=2026-09-30',
        ana,
      ).expect(200);

      expect(body(response)).toEqual({
        inbound: { quantity: '10', value: '50.00' },
        outbound: { quantity: '7', value: '35.00' },
        consumptionByProcedure: [
          { procedureName: 'Castration', quantity: '6', value: '30.00' },
        ],
        adjustmentsByReason: [
          {
            reason: AdjustmentReason.EXPIRATION,
            type: OUTBOUND,
            quantity: '1',
            value: '5.00',
          },
        ],
        item: null,
      });
    });

    it('opens the item balance from the ledger before the period, so opening + movements = closing', async () => {
      const { propofol } = await seedAna();
      // A wrong cache must not leak into the report: the balance comes from
      // the movements, never from item.currentQuantity (ADR-10, US12).
      await prisma.item.update({
        where: { id: propofol.id },
        data: { currentQuantity: 999 },
      });

      const response = await get(
        `/stock-movements/summary?itemId=${propofol.id}&startDate=2026-09-01&endDate=2026-09-30`,
        ana,
      ).expect(200);

      expect(body(response).item).toEqual({
        openingBalance: '4',
        inbound: '10',
        outbound: '6',
        closingBalance: '8',
      });
    });

    it('starts at the beginning of the ledger when no start date is given', async () => {
      const { propofol } = await seedAna();

      const response = await get(
        `/stock-movements/summary?itemId=${propofol.id}&endDate=2026-09-30`,
        ana,
      ).expect(200);

      expect(body(response).item).toEqual({
        openingBalance: '0',
        inbound: '16',
        outbound: '8',
        closingBalance: '8',
      });
    });

    it("keeps another user's movements out of the totals and answers 404 for their item", async () => {
      await seedAna();
      const { item } = await seedBruno();

      const summary = await get(
        '/stock-movements/summary?startDate=2026-09-01&endDate=2026-09-30',
        ana,
      ).expect(200);
      const probe = await get(
        `/stock-movements/summary?itemId=${item.id}`,
        ana,
      ).expect(404);

      expect(body(summary).inbound).toEqual({ quantity: '10', value: '50.00' });
      expect(body(probe)).toMatchObject({ code: 'ITEM_NOT_FOUND' });
    });

    it('rejects an inverted period', async () => {
      await seedAna();

      const response = await get(
        '/stock-movements/summary?startDate=2026-09-30&endDate=2026-09-01',
        ana,
      ).expect(400);

      expect(body(response)).toMatchObject({ code: 'VALIDATION_ERROR' });
    });
  });
});
