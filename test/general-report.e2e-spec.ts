import { INestApplication } from '@nestjs/common';
import {
  AdjustmentReason,
  AppointmentStatus,
  ClientType,
  EntryNature,
  EntryScope,
  EntrySource,
  ItemCategory,
  MeasurementUnit,
  StockMovementSource,
  StockMovementType,
  TripMode,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';

import { ensureDefaultFinancialCategories } from './helpers/default-financial-categories';
import {
  bearer,
  body,
  createTestApp,
  mintTokens,
  TestUser,
} from './helpers/test-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import {
  DocumentStorage,
  PresignedGet,
  PresignedGetRequest,
  PresignedPost,
  StoredDocument,
} from '../src/infra/storage';
import { readPdfText } from '../src/modules/extraction/core/pdf/pdf-text-reader';

/** The bucket, in memory: CI has no S3, and the spec reads back what was put. */
class MemoryStorage extends DocumentStorage {
  readonly objects = new Map<string, { body: Uint8Array; type: string }>();

  createPresignedPost(): Promise<PresignedPost> {
    return Promise.resolve({ url: 'https://bucket', fields: {}, expiresAt: 0 });
  }

  headDocument(key: string): Promise<StoredDocument | null> {
    const object = this.objects.get(key);
    return Promise.resolve(
      object
        ? { contentLength: object.body.byteLength, contentType: object.type }
        : null,
    );
  }

  getDocument(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.objects.get(key)?.body ?? null);
  }

  putDocument(key: string, bytes: Uint8Array, type: string): Promise<void> {
    this.objects.set(key, { body: bytes, type });
    return Promise.resolve();
  }

  createPresignedGet(request: PresignedGetRequest): Promise<PresignedGet> {
    return Promise.resolve({
      url: `https://bucket/${request.key}?name=${request.fileName ?? ''}`,
      expiresAt: Date.now() + request.expiresInMs,
    });
  }

  deletePrefix(prefix: string): Promise<number> {
    const keys = [...this.objects.keys()].filter(key => key.startsWith(prefix));
    keys.forEach(key => this.objects.delete(key));
    return Promise.resolve(keys.length);
  }
}

type Section = Record<string, unknown> & { type: string; empty: boolean };
interface ReportBody {
  period: { from: string; to: string };
  sections: Section[];
  generatedAt: string;
}

/**
 * The general report (US29) and its PDF (US28) against a real database.
 *
 * One account with a record of every kind inside 15/10–14/11/2026 and the ones
 * that must be left out (outside the period by a minute, deleted, not
 * completed, not confirmed). The expected numbers are written out by hand.
 */
describe('General report (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const storage = new MemoryStorage();

  const owner: TestUser = {
    cognitoSub: `e2e-general-${randomUUID()}`,
    email: `e2e-general-${randomUUID()}@example.com`,
    name: 'Ana Souza',
  };
  const other: TestUser = {
    cognitoSub: `e2e-general-other-${randomUUID()}`,
    email: `e2e-general-other-${randomUUID()}@example.com`,
    name: 'Other',
  };
  const empty: TestUser = {
    cognitoSub: `e2e-general-empty-${randomUUID()}`,
    email: `e2e-general-empty-${randomUUID()}@example.com`,
    name: 'Bia Lima',
  };

  const period = { from: '2026-10-15', to: '2026-11-14' };
  let ownerId: string;
  let pampaId: string;
  let sulId: string;
  let s1Id: string;
  let s2Id: string;

  const server = () => app.getHttpServer();
  const general = (user: TestUser, query: object) =>
    request(server())
      .get('/reports/general')
      .query(query)
      .set('Authorization', bearer(user));
  const generate = (user: TestUser, payload: object) =>
    request(server())
      .post('/reports')
      .send(payload)
      .set('Authorization', bearer(user));
  const section = (report: ReportBody, type: string) => {
    const found = report.sections.find(item => item.type === type);
    if (!found) throw new Error(`no ${type} section`);
    return found;
  };

  const categoryId = async (name: string, nature: EntryNature) =>
    (
      await prisma.financialCategory.findFirstOrThrow({
        where: { userId: null, name, nature },
      })
    ).id;

  const seed = async (userId: string) => {
    const [fees, supplies, travel, fixed] = await Promise.all([
      categoryId('Professional fees', EntryNature.INCOME),
      categoryId('Supplies', EntryNature.EXPENSE),
      categoryId('Travel', EntryNature.EXPENSE),
      categoryId('Fixed costs', EntryNature.EXPENSE),
    ]);

    const pampa = await prisma.client.create({
      data: {
        userId,
        type: ClientType.CLINIC,
        name: 'Clínica Pampa',
        addressLine: 'Rua das Flores, 100',
        city: 'Porto Alegre',
        state: 'RS',
      },
    });
    const sul = await prisma.client.create({
      data: { userId, type: ClientType.CLINIC, name: 'Hospital Sul' },
    });

    const completed = (data: object) =>
      prisma.appointment.create({
        data: { userId, status: AppointmentStatus.COMPLETED, ...data } as never,
      });
    // Inside the period, in Brasília time.
    const a1 = await completed({
      clientId: pampa.id,
      startsAt: new Date('2026-10-20T13:00:00Z'),
      amount: '500.00',
      patientName: 'Thor',
      asa: 'II',
      weightKg: '12.5',
      procedureName: 'Castração',
    });
    const a2 = await completed({
      clientId: sul.id,
      // 14/11 23:30 in Brasília, the last minutes of the period
      startsAt: new Date('2026-11-15T02:30:00Z'),
      amount: '300.00',
      patientName: 'Mel',
      location: 'Fazenda Boa Vista',
      procedureName: 'Mastectomia',
    });
    await completed({
      startsAt: new Date('2026-11-03T15:00:00Z'),
      patientName: 'Bob',
      procedureName: 'Profilaxia',
    });
    // Left out: a minute before, the first minute after, not completed, deleted.
    await completed({
      clientId: pampa.id,
      startsAt: new Date('2026-10-15T02:59:00Z'),
      amount: '999.00',
    });
    await completed({
      clientId: pampa.id,
      startsAt: new Date('2026-11-15T03:00:00Z'),
      amount: '999.00',
    });
    const scheduled = await prisma.appointment.create({
      data: {
        userId,
        clientId: pampa.id,
        startsAt: new Date('2026-10-25T13:00:00Z'),
        amount: '777.00',
      },
    });
    const deleted = await completed({
      clientId: pampa.id,
      startsAt: new Date('2026-10-22T13:00:00Z'),
      amount: '888.00',
      deletedAt: new Date(),
    });

    const ride = (data: object) =>
      prisma.trip.create({
        data: {
          userId,
          mode: TripMode.RIDE,
          origin: 'Casa',
          destination: 'Clínica',
          ...data,
        } as never,
      });
    const t1 = await ride({
      clientId: pampa.id,
      occurredOn: new Date('2026-10-20'),
      distanceKm: '30.00',
      cost: '45.00',
    });
    await ride({ occurredOn: new Date('2026-11-14'), cost: '20.00' });
    await ride({ occurredOn: new Date('2026-10-14'), cost: '999.00' });
    await ride({
      occurredOn: new Date('2026-10-21'),
      cost: '999.00',
      deletedAt: new Date(),
    });

    const serviceInvoice = await prisma.serviceInvoice.create({
      data: { userId },
    });
    const entry = (data: object) =>
      prisma.financialEntry.create({ data: { userId, ...data } as never });
    const income = {
      nature: EntryNature.INCOME,
      categoryId: fees,
      scope: EntryScope.PROFESSIONAL,
    };
    const expense = (categoryId: string, scope: EntryScope) => ({
      nature: EntryNature.EXPENSE,
      categoryId,
      scope,
    });
    await entry({
      ...income,
      source: EntrySource.APPOINTMENT,
      appointmentId: a1.id,
      description: 'Castração',
      amount: '500.00',
      accrualDate: new Date('2026-10-20'),
    });
    await entry({
      ...income,
      source: EntrySource.APPOINTMENT,
      appointmentId: a2.id,
      description: 'Mastectomia',
      amount: '300.00',
      accrualDate: new Date('2026-11-14'),
    });
    await entry({
      ...income,
      source: EntrySource.SERVICE_INVOICE,
      serviceInvoiceId: serviceInvoice.id,
      description: 'NFS-e 1',
      amount: '1200.00',
      accrualDate: new Date('2026-11-05'),
    });
    await entry({
      ...income,
      source: EntrySource.MANUAL,
      description: 'Plantão',
      amount: '100.00',
      accrualDate: new Date('2026-10-16'),
    });
    await entry({
      ...expense(supplies, EntryScope.PROFESSIONAL),
      source: EntrySource.MANUAL,
      description: 'Luvas',
      amount: '200.00',
      accrualDate: new Date('2026-10-18'),
    });
    await entry({
      ...expense(fixed, EntryScope.PERSONAL),
      source: EntrySource.MANUAL,
      description: 'Aluguel',
      amount: '150.00',
      accrualDate: new Date('2026-11-02'),
    });
    await entry({
      ...expense(travel, EntryScope.PROFESSIONAL),
      source: EntrySource.TRIP,
      tripId: t1.id,
      description: 'Carona',
      amount: '45.00',
      accrualDate: new Date('2026-10-20'),
    });
    await entry({
      ...income,
      source: EntrySource.MANUAL,
      description: 'Fora do período',
      amount: '5000.00',
      accrualDate: new Date('2026-10-14'),
    });
    await entry({
      ...expense(supplies, EntryScope.PROFESSIONAL),
      source: EntrySource.MANUAL,
      description: 'Excluída',
      amount: '999.00',
      accrualDate: new Date('2026-10-25'),
      deletedAt: new Date(),
    });

    // 12,000.00 over 60 months: 200.00 a month, all through the period.
    await prisma.equipment.create({
      data: {
        userId,
        name: 'Monitor multiparamétrico',
        purchaseValue: '12000.00',
        usefulLifeMonths: 60,
        acquisitionDate: new Date('2025-01-10'),
      },
    });

    const item = (name: string, unit: MeasurementUnit) =>
      prisma.item.create({
        data: { userId, name, unit, category: ItemCategory.OTHER },
      });
    const propofol = await item('Propofol 1%', MeasurementUnit.ML);
    const syringe = await item('Seringa 3 mL', MeasurementUnit.UNIT);
    const movement = (data: object) =>
      prisma.stockMovement.create({ data: { userId, ...data } as never });
    const used = new Date('2026-10-20T13:10:00Z');
    const supply = {
      itemId: propofol.id,
      appointmentId: a1.id,
      unitCost: '0.70',
      occurredAt: used,
    };
    const first = await movement({
      ...supply,
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.APPOINTMENT,
      quantity: '20',
    });
    // The supply was corrected from 20 mL to 15 mL: reversed, then recorded again.
    await movement({
      ...supply,
      type: StockMovementType.INBOUND,
      source: StockMovementSource.CORRECTION_REVERSAL,
      reversedMovementId: first.id,
      quantity: '20',
    });
    await movement({
      ...supply,
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.APPOINTMENT,
      replacedMovementId: first.id,
      quantity: '15',
    });
    await movement({
      itemId: syringe.id,
      appointmentId: a2.id,
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.APPOINTMENT,
      quantity: '4',
      unitCost: '0.65',
      occurredAt: new Date('2026-11-15T02:40:00Z'),
    });
    // A loss is not consumption; a use before the period is outside it.
    await movement({
      itemId: propofol.id,
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.MANUAL_ADJUSTMENT,
      adjustmentReason: AdjustmentReason.EXPIRATION,
      quantity: '5',
      unitCost: '0.70',
      occurredAt: new Date('2026-10-25T12:00:00Z'),
    });
    await movement({
      ...supply,
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.APPOINTMENT,
      quantity: '50',
      occurredAt: new Date('2026-10-10T12:00:00Z'),
    });
    // An appointment deleted after the period: its supply is inside, the
    // reversal the deletion wrote is dated on the deletion, outside. Neither
    // counts, as the appointment does not count either.
    const gone = await movement({
      itemId: syringe.id,
      appointmentId: deleted.id,
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.APPOINTMENT,
      quantity: '10',
      unitCost: '0.65',
      occurredAt: new Date('2026-10-22T13:10:00Z'),
    });
    await movement({
      itemId: syringe.id,
      appointmentId: deleted.id,
      type: StockMovementType.INBOUND,
      source: StockMovementSource.CORRECTION_REVERSAL,
      reversedMovementId: gone.id,
      quantity: '10',
      unitCost: '0.65',
      occurredAt: new Date('2026-11-20T12:00:00Z'),
    });
    // A supply of an appointment that was not completed does not count.
    await movement({
      itemId: propofol.id,
      appointmentId: scheduled.id,
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.APPOINTMENT,
      quantity: '7',
      unitCost: '0.70',
      occurredAt: new Date('2026-10-25T13:10:00Z'),
    });

    const s1 = await prisma.supplier.create({
      data: { userId, name: 'Distribuidora Vet Sul' },
    });
    const s2 = await prisma.supplier.create({
      data: { userId, name: 'Vet Norte' },
    });
    const invoice = (data: object) =>
      prisma.purchaseInvoice.create({
        data: { userId, status: 'CONFIRMED', ...data } as never,
      });
    const on = (day: string) => new Date(day);
    await invoice({
      supplierId: s1.id,
      issueDate: on('2026-10-16'),
      totalAmount: '980.00',
    });
    await invoice({
      supplierId: s1.id,
      issueDate: on('2026-11-10'),
      totalAmount: '20.00',
    });
    await invoice({
      supplierId: s2.id,
      issueDate: on('2026-10-30'),
      totalAmount: '300.00',
    });
    // Confirmed without a total: counted, adds nothing.
    await invoice({ supplierId: s2.id, issueDate: on('2026-11-02') });
    await invoice({ issueDate: on('2026-11-01'), totalAmount: '170.00' });
    // Left out: a draft, and a day before the period.
    await invoice({
      supplierId: s2.id,
      issueDate: on('2026-10-20'),
      totalAmount: '500.00',
      status: 'DRAFT',
    });
    await invoice({
      supplierId: s1.id,
      issueDate: on('2026-10-14'),
      totalAmount: '999.00',
    });

    await prisma.pricingSettings.create({
      data: {
        userId,
        monthlyIncomeGoal: '10000.00',
        weeklyHours: '40.00',
        safetyMarginPct: '10.00',
      },
    });
    // October was stored back then: the report must show it, not recalculate it.
    await prisma.hourlyRateSnapshot.create({
      data: {
        userId,
        year: 2026,
        month: 10,
        hourlyRate: '150.00',
        fixedCosts: '1000.00',
        variableCosts: '500.00',
        ownerDraw: '10000.00',
        safetyMargin: '1150.00',
        monthlyIncomeGoal: '10000.00',
        weeklyHours: '40.00',
        safetyMarginPct: '10.00',
        calculatedAt: new Date('2026-10-31T12:00:00Z'),
      },
    });

    return { pampa, sul, s1, s2 };
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp(builder =>
      builder.overrideProvider(DocumentStorage).useValue(storage),
    ));
    await ensureDefaultFinancialCategories(prisma);
    await mintTokens([owner, other, empty]);

    const provision = async (user: TestUser) => {
      const session = await request(server())
        .post('/auth/session')
        .set('Authorization', bearer(user))
        .expect(200);
      return (session.body as { id: string }).id;
    };
    ownerId = await provision(owner);
    const otherId = await provision(other);
    await provision(empty);
    await prisma.user.update({
      where: { id: ownerId },
      data: { crmv: 'RS 12345' },
    });

    const owned = await seed(ownerId);
    pampaId = owned.pampa.id;
    sulId = owned.sul.id;
    s1Id = owned.s1.id;
    s2Id = owned.s2.id;
    // Another account with the same records: none of it may show up.
    await seed(otherId);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /reports/general', () => {
    let report: ReportBody;
    let storedMonths: { year: number; month: number }[];

    beforeAll(async () => {
      report = (await general(owner, period).expect(200)).body as ReportBody;
      // Before any call to the calculator, which does store its answer.
      storedMonths = await prisma.hourlyRateSnapshot.findMany({
        where: { userId: ownerId },
        select: { year: true, month: true },
      });
    });

    it('sends every section, in the order of the document', () => {
      expect(report.period).toEqual(period);
      expect(report.sections.map(item => item.type)).toEqual([
        'FINANCIAL',
        'APPOINTMENTS',
        'CLIENTS',
        'STOCK',
        'SUPPLIERS',
        'TRIPS',
        'DEPRECIATION',
        'HOURLY_RATE',
      ]);
      expect(report.sections.every(item => !item.empty)).toBe(true);
    });

    it('adds up the money by origin and group, with depreciation prorated per month', () => {
      expect(section(report, 'FINANCIAL')).toMatchObject({
        income: {
          items: [
            { origin: 'APPOINTMENTS', subtotal: '800.00' },
            { origin: 'SERVICE_INVOICES', subtotal: '1200.00' },
            { origin: 'OTHER', subtotal: '100.00' },
          ],
          total: '2100.00',
        },
        expenses: {
          items: [
            { category: 'SUPPLIES', subtotal: '200.00' },
            { category: 'TRAVEL', subtotal: '45.00' },
            { category: 'FIXED_COSTS', subtotal: '150.00' },
            // 200 × 17/31 = 109.68 in October + 200 × 14/30 = 93.33 in November
            { category: 'DEPRECIATION', subtotal: '203.01' },
            { category: 'TAXES_AND_FEES', subtotal: '0.00' },
            { category: 'OTHER', subtotal: '0.00' },
          ],
          total: '598.01',
          professional: '448.01',
          personal: '150.00',
        },
        netBalance: '1501.99',
        months: [
          {
            year: 2026,
            month: 10,
            from: '2026-10-15',
            to: '2026-10-31',
            totalIncome: '600.00',
            totalExpenses: '354.68',
            netBalance: '245.32',
          },
          {
            year: 2026,
            month: 11,
            from: '2026-11-01',
            to: '2026-11-14',
            totalIncome: '1500.00',
            totalExpenses: '243.33',
            netBalance: '1256.67',
          },
        ],
      });
    });

    it('lists the completed appointments, oldest first', () => {
      const appointments = section(report, 'APPOINTMENTS');

      expect(appointments).toMatchObject({ count: 3, billedTotal: '800.00' });
      expect(appointments.items).toEqual([
        expect.objectContaining({
          patientName: 'Thor',
          asa: 'II',
          weightKg: '12.5',
          location: 'Rua das Flores, 100, Porto Alegre, RS',
          procedureName: 'Castração',
          amount: '500.00',
          clientName: 'Clínica Pampa',
        }),
        expect.objectContaining({
          patientName: 'Bob',
          amount: null,
          clientName: null,
          location: null,
        }),
        expect.objectContaining({
          patientName: 'Mel',
          location: 'Fazenda Boa Vista',
          amount: '300.00',
          clientName: 'Hospital Sul',
        }),
      ]);
    });

    it('groups by client, with a group for no client', () => {
      expect(section(report, 'CLIENTS')).toMatchObject({
        items: [
          {
            clientId: pampaId,
            clientName: 'Clínica Pampa',
            appointmentsCount: 1,
            billedTotal: '500.00',
            tripCount: 1,
            tripCost: '45.00',
          },
          {
            clientId: sulId,
            clientName: 'Hospital Sul',
            appointmentsCount: 1,
            billedTotal: '300.00',
            tripCount: 0,
            tripCost: '0.00',
          },
          {
            clientId: null,
            clientName: 'Sem tomador',
            appointmentsCount: 1,
            billedTotal: '0.00',
            tripCount: 1,
            tripCost: '20.00',
          },
        ],
        appointmentsCount: 3,
        billedTotal: '800.00',
        tripCost: '65.00',
      });
    });

    it('counts the stock used by completed appointments, net of corrections, and the purchases', () => {
      expect(section(report, 'STOCK')).toMatchObject({
        consumption: {
          items: [
            {
              itemName: 'Propofol 1%',
              unit: 'ML',
              quantity: '15',
              cost: '10.50',
            },
            {
              itemName: 'Seringa 3 mL',
              unit: 'UNIT',
              quantity: '4',
              cost: '2.60',
            },
          ],
          totalCost: '13.10',
        },
        purchases: { invoiceCount: 5, total: '1470.00' },
      });
    });

    it('groups the confirmed purchases by supplier', () => {
      expect(section(report, 'SUPPLIERS')).toMatchObject({
        items: [
          {
            supplierId: s1Id,
            supplierName: 'Distribuidora Vet Sul',
            invoiceCount: 2,
            total: '1000.00',
          },
          {
            supplierId: s2Id,
            supplierName: 'Vet Norte',
            invoiceCount: 2,
            total: '300.00',
          },
          {
            supplierId: null,
            supplierName: 'Sem fornecedor',
            invoiceCount: 1,
            total: '170.00',
          },
        ],
        invoiceCount: 5,
        total: '1470.00',
      });
    });

    it('adds up the trips, a ride without distance adding no km', () => {
      expect(section(report, 'TRIPS')).toMatchObject({
        count: 2,
        distanceKm: '30.00',
        cost: '65.00',
      });
    });

    it('prorates the depreciation of each month by its real days', () => {
      expect(section(report, 'DEPRECIATION')).toMatchObject({
        months: [
          {
            year: 2026,
            month: 10,
            days: 17,
            daysInMonth: 31,
            monthlyDepreciation: '200.00',
            amount: '109.68',
          },
          {
            year: 2026,
            month: 11,
            days: 14,
            daysInMonth: 30,
            monthlyDepreciation: '200.00',
            amount: '93.33',
          },
        ],
        total: '203.01',
      });
    });

    it('shows the stored hour of a past month and calculates the current one', async () => {
      const hourly = section(report, 'HOURLY_RATE');
      const calculator = await request(server())
        .get('/pricing/hourly-rate')
        .query({ year: 2026, month: 11 })
        .set('Authorization', bearer(owner))
        .expect(200);

      expect(hourly).toMatchObject({
        notice: null,
        months: [
          { year: 2026, month: 10, hourlyRate: '150.00', source: 'HISTORY' },
          {
            year: 2026,
            month: 11,
            hourlyRate: body(calculator).hourlyRate,
            source: 'CALCULATED',
          },
        ],
      });
    });

    it('writes nothing to the hour history, even for a month it calculated', () => {
      expect(storedMonths).toEqual([{ year: 2026, month: 10 }]);
    });

    it('agrees with GET /financial-balance for a whole month', async () => {
      const [month, balance] = await Promise.all([
        general(owner, {
          from: '2026-10-01',
          to: '2026-10-31',
          sections: 'FINANCIAL',
        }).expect(200),
        request(server())
          .get('/financial-balance')
          .query({ year: 2026, month: 10 })
          .set('Authorization', bearer(owner))
          .expect(200),
      ]);
      const financial = section(
        month.body as ReportBody,
        'FINANCIAL',
      ) as unknown as {
        income: { total: string };
        expenses: {
          total: string;
          professional: string;
          personal: string;
          items: unknown[];
        };
        netBalance: string;
      };
      const expected = body(balance) as {
        totalIncome: string;
        totalExpenses: string;
        professionalExpenses: string;
        personalExpenses: string;
        netBalance: string;
        expensesByCategory: { items: unknown[] };
      };

      expect(financial.income.total).toBe(expected.totalIncome);
      expect(financial.expenses.total).toBe(expected.totalExpenses);
      expect(financial.expenses.professional).toBe(
        expected.professionalExpenses,
      );
      expect(financial.expenses.personal).toBe(expected.personalExpenses);
      expect(financial.netBalance).toBe(expected.netBalance);
      expect(financial.expenses.items).toEqual(
        expected.expensesByCategory.items,
      );
    });

    it("agrees with the client's summary (US17) for the same period", async () => {
      const summary = await request(server())
        .get(`/client/${pampaId}/summary`)
        .query(period)
        .set('Authorization', bearer(owner))
        .expect(200);
      const line = (
        section(report, 'CLIENTS').items as { clientId: string }[]
      ).find(item => item.clientId === pampaId);

      expect(line).toMatchObject(body(summary));
    });

    it('sends only the selected sections, in the order of the document', async () => {
      const response = await general(owner, {
        ...period,
        sections: 'TRIPS,FINANCIAL',
      }).expect(200);

      expect(
        (response.body as ReportBody).sections.map(item => item.type),
      ).toEqual(['FINANCIAL', 'TRIPS']);
    });

    it('keeps every section of an account without records, marked empty', async () => {
      const response = await general(empty, period).expect(200);
      const emptyReport = response.body as ReportBody;

      expect(emptyReport.sections).toHaveLength(8);
      expect(emptyReport.sections.every(item => item.empty)).toBe(true);
      expect(section(emptyReport, 'HOURLY_RATE')).toMatchObject({
        notice: 'PRICING_SETTINGS_NOT_FOUND',
      });
    });

    it.each([
      [
        'an empty selection',
        { ...period, sections: '' },
        'REPORT_SECTIONS_EMPTY',
      ],
      [
        'a period that ends first',
        { from: '2026-11-14', to: '2026-10-15' },
        'REPORT_PERIOD_INVALID',
      ],
      [
        'a period longer than a year',
        { from: '2026-01-01', to: '2027-01-02' },
        'REPORT_PERIOD_TOO_LONG',
      ],
      [
        'an unknown section',
        { ...period, sections: 'FINANCIAL,TAXES' },
        'VALIDATION_ERROR',
      ],
    ])('answers 400 for %s', async (_name, query, code) => {
      const response = await general(owner, query).expect(400);
      expect(response.body).toMatchObject({ code });
    });

    it('requires a token', async () => {
      await request(server()).get('/reports/general').query(period).expect(401);
    });
  });

  describe('POST /reports', () => {
    const pdfTextOf = async (bytes: Uint8Array) =>
      (await readPdfText(bytes)).pages
        .flatMap(page => page.fragments.map(fragment => fragment.text))
        .join(' ')
        .replace(/\s+/g, ' ');

    it('generates the PDF, stores it, records it and answers a download link', async () => {
      const response = await generate(owner, {
        ...period,
        sections: ['FINANCIAL', 'APPOINTMENTS', 'SUPPLIERS'],
      }).expect(201);
      const generated = body(response) as {
        id: string;
        fileName: string;
        downloadUrl: string;
      };

      expect(generated).toMatchObject({
        kind: 'GENERAL_REPORT',
        fileName: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
        period,
        sections: ['FINANCIAL', 'APPOINTMENTS', 'SUPPLIERS'],
        professionalIdComplete: true,
      });
      expect(generated.downloadUrl).toContain(generated.fileName);

      const key = `users/${ownerId}/reports/${generated.id}/original`;
      expect(
        await prisma.report.findUniqueOrThrow({ where: { id: generated.id } }),
      ).toMatchObject({
        userId: ownerId,
        kind: 'GENERAL_REPORT',
        periodStart: new Date('2026-10-15'),
        periodEnd: new Date('2026-11-14'),
        filters: { sections: ['FINANCIAL', 'APPOINTMENTS', 'SUPPLIERS'] },
        fileUrl: key,
        status: 'DONE',
      });

      const stored = storage.objects.get(key);
      expect(stored?.type).toBe('application/pdf');
      const text = await pdfTextOf(stored!.body);
      for (const expected of [
        'Ana Souza',
        'CRMV RS 12345',
        'Relatório Geral',
        '15/10/2026 a 14/11/2026',
        'Página 1 de',
        'Financeiro',
        'Atendimentos',
        'Fornecedores',
        'Thor',
        'Distribuidora Vet Sul',
        'Comparação mês a mês',
      ]) {
        expect(text).toContain(expected);
      }
      // Only the selected sections are in the document: what only the
      // others would print is absent ("Deslocamento" is also an expense group).
      for (const absent of [
        'Clínicas',
        'Estoque e Insumos',
        'Quilômetros rodados',
        'Hora Trabalhada',
      ]) {
        expect(text).not.toContain(absent);
      }
    });

    it('warns of an incomplete professional id and keeps an empty section', async () => {
      const response = await generate(empty, {
        ...period,
        sections: ['TRIPS'],
      }).expect(201);
      const generated = body(response) as { id: string };
      const row = await prisma.report.findUniqueOrThrow({
        where: { id: generated.id },
      });
      const text = await pdfTextOf(storage.objects.get(row.fileUrl!)!.body);

      expect(body(response).professionalIdComplete).toBe(false);
      expect(text).toContain('Bia Lima');
      expect(text).not.toContain('CRMV');
      expect(text).toContain('Deslocamento');
      expect(text).toContain('Sem registros no período.');
    });

    it('stores and records nothing for an invalid request', async () => {
      const files = storage.objects.size;
      const rows = await prisma.report.count();

      const response = await generate(owner, {
        ...period,
        sections: [],
      }).expect(400);

      expect(response.body).toMatchObject({ code: 'REPORT_SECTIONS_EMPTY' });
      expect(storage.objects.size).toBe(files);
      expect(await prisma.report.count()).toBe(rows);
    });

    it('requires a token', async () => {
      await request(server()).post('/reports').send(period).expect(401);
    });
  });
});
