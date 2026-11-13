import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

describe('reports tax package (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;
  let anaId: string;
  let brunoId: string;

  const ana: TestUser = {
    cognitoSub: 'sub-tax-ana',
    email: 'ana.tax@example.com',
    name: 'Ana Souza',
  };
  const bruno: TestUser = {
    cognitoSub: 'sub-tax-bruno',
    email: 'bruno.tax@example.com',
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
    anaId = (
      await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: ana.cognitoSub },
      })
    ).id;
    brunoId = (
      await prisma.user.findUniqueOrThrow({
        where: { cognitoSub: bruno.cognitoSub },
      })
    ).id;
  });

  afterAll(async () => {
    await app.close();
  });

  const day = (isoDate: string) => new Date(`${isoDate}T00:00:00.000Z`);

  const stored = {
    fileUrl: 'users/x/key',
    uploadedAt: new Date('2026-04-02T12:00:00.000Z'),
    fileMimeType: 'application/pdf',
    fileName: 'nota.pdf',
    fileBytesSize: 1000,
  };

  const serviceInvoice = (
    userId: string,
    issueDate: string | null,
    amount: string,
    overrides: Partial<Prisma.ServiceInvoiceUncheckedCreateInput> = {},
  ) =>
    prisma.serviceInvoice.create({
      data: {
        userId,
        status: 'CONFIRMED',
        issueDate: issueDate ? day(issueDate) : null,
        amount: new Prisma.Decimal(amount),
        ...stored,
        ...overrides,
      },
    });

  const purchaseInvoice = (
    userId: string,
    issueDate: string | null,
    totalAmount: string,
    overrides: Partial<Prisma.PurchaseInvoiceUncheckedCreateInput> = {},
  ) =>
    prisma.purchaseInvoice.create({
      data: {
        userId,
        status: 'CONFIRMED',
        issueDate: issueDate ? day(issueDate) : null,
        totalAmount: new Prisma.Decimal(totalAmount),
        ...stored,
        ...overrides,
      },
    });

  const summary = (user: TestUser, from: string, to: string) =>
    request(http)
      .get(`/reports/tax-package/summary?from=${from}&to=${to}`)
      .set('Authorization', bearer(user));

  const exportPackage = (user: TestUser, from: string, to: string) =>
    request(http)
      .post('/reports/tax-package')
      .set('Authorization', bearer(user))
      .send({ from, to });

  describe('GET /reports/tax-package/summary', () => {
    it('counts only confirmed documents of the period that have their file', async () => {
      await serviceInvoice(anaId, '2026-03-01', '350.00');
      await serviceInvoice(anaId, '2026-03-31', '150.00');
      await purchaseInvoice(anaId, '2026-03-15', '200.00');

      const response = await summary(ana, '2026-03-01', '2026-03-31').expect(
        200,
      );

      expect(body(response)).toEqual({
        documentsCount: 3,
        totalAmount: 700,
        byType: {
          serviceInvoice: { count: 2, totalAmount: 500, missingFiles: 0 },
          purchaseInvoice: { count: 1, totalAmount: 200, missingFiles: 0 },
        },
        missingFiles: 0,
      });
    });

    it('includes both ends of the period and nothing outside it', async () => {
      await serviceInvoice(anaId, '2026-02-28', '1.00');
      await serviceInvoice(anaId, '2026-03-01', '10.00');
      await serviceInvoice(anaId, '2026-03-31', '100.00');
      await serviceInvoice(anaId, '2026-04-01', '1000.00');

      const response = await summary(ana, '2026-03-01', '2026-03-31').expect(
        200,
      );

      expect(body(response)).toMatchObject({
        documentsCount: 2,
        totalAmount: 110,
      });
    });

    it('reports a document without its file apart, out of the count and the total', async () => {
      await serviceInvoice(anaId, '2026-03-10', '50.00', { fileUrl: null });
      // The upload was signed but never confirmed.
      await serviceInvoice(anaId, '2026-03-10', '70.00', { uploadedAt: null });
      await purchaseInvoice(anaId, '2026-03-20', '30.00', { fileUrl: null });
      await serviceInvoice(anaId, '2026-03-12', '350.00');

      const response = await summary(ana, '2026-03-01', '2026-03-31').expect(
        200,
      );

      expect(body(response)).toEqual({
        documentsCount: 1,
        totalAmount: 350,
        byType: {
          serviceInvoice: { count: 1, totalAmount: 350, missingFiles: 2 },
          purchaseInvoice: { count: 0, totalAmount: 0, missingFiles: 1 },
        },
        missingFiles: 3,
      });
    });

    it('ignores drafts, discarded and deleted documents, and purchases with no issue date', async () => {
      await serviceInvoice(anaId, '2026-03-10', '10.00', { status: 'DRAFT' });
      await serviceInvoice(anaId, '2026-03-10', '20.00', {
        status: 'CANCELLED',
      });
      await serviceInvoice(anaId, '2026-03-10', '30.00', {
        deletedAt: new Date('2026-03-11T00:00:00.000Z'),
      });
      await purchaseInvoice(anaId, null, '40.00');

      const response = await summary(ana, '2026-03-01', '2026-03-31').expect(
        200,
      );

      expect(body(response)).toMatchObject({
        documentsCount: 0,
        totalAmount: 0,
        missingFiles: 0,
      });
    });

    it('sums to the cent, with no float noise', async () => {
      await serviceInvoice(anaId, '2026-03-10', '0.10');
      await serviceInvoice(anaId, '2026-03-10', '0.20');
      await purchaseInvoice(anaId, '2026-03-10', '0.30');

      const response = await summary(ana, '2026-03-01', '2026-03-31').expect(
        200,
      );

      expect(body(response)).toMatchObject({ totalAmount: 0.6 });
    });

    it("never counts another user's documents", async () => {
      await serviceInvoice(brunoId, '2026-03-05', '500.00');
      await purchaseInvoice(brunoId, '2026-03-05', '300.00');
      await serviceInvoice(anaId, '2026-03-05', '1.00');

      const response = await summary(ana, '2026-03-01', '2026-03-31').expect(
        200,
      );

      expect(body(response)).toMatchObject({
        documentsCount: 1,
        totalAmount: 1,
      });
    });

    it('answers zeros for a period with nothing', async () => {
      const response = await summary(ana, '2026-03-01', '2026-03-31').expect(
        200,
      );

      expect(body(response)).toMatchObject({
        documentsCount: 0,
        totalAmount: 0,
        missingFiles: 0,
      });
    });

    it('refuses a period that ends before it starts', async () => {
      const response = await summary(ana, '2026-04-01', '2026-03-01').expect(
        400,
      );

      expect(body(response)).toMatchObject({ code: 'REPORT_PERIOD_INVALID' });
    });

    it('refuses a missing or malformed date', async () => {
      await request(http)
        .get('/reports/tax-package/summary?from=2026-03-01')
        .set('Authorization', bearer(ana))
        .expect(400);
      await summary(ana, '2026-3-1', '2026-03-31').expect(400);
    });

    it('needs a token', async () => {
      await request(http)
        .get('/reports/tax-package/summary?from=2026-03-01&to=2026-03-31')
        .expect(401);
    });
  });

  describe('POST /reports/tax-package', () => {
    it('answers 404 TAX_PACKAGE_EMPTY for a period with no document, never an empty zip', async () => {
      const response = await exportPackage(
        ana,
        '2026-03-01',
        '2026-03-31',
      ).expect(404);

      expect(body(response)).toMatchObject({ code: 'TAX_PACKAGE_EMPTY' });
    });

    it('answers 404 when the only documents have no file, and says how many', async () => {
      await serviceInvoice(anaId, '2026-03-10', '50.00', { fileUrl: null });

      const response = await exportPackage(
        ana,
        '2026-03-01',
        '2026-03-31',
      ).expect(404);

      expect(body(response)).toMatchObject({
        code: 'TAX_PACKAGE_EMPTY',
        details: { missingFiles: 1 },
      });
    });

    it("does not package another user's documents", async () => {
      await serviceInvoice(brunoId, '2026-05-05', '500.00');

      const response = await exportPackage(
        ana,
        '2026-05-01',
        '2026-05-31',
      ).expect(404);

      expect(body(response)).toMatchObject({ code: 'TAX_PACKAGE_EMPTY' });
    });

    it('refuses a period that ends before it starts', async () => {
      const response = await exportPackage(
        ana,
        '2026-04-01',
        '2026-03-01',
      ).expect(400);

      expect(body(response)).toMatchObject({ code: 'REPORT_PERIOD_INVALID' });
    });

    it('needs a token', async () => {
      await request(http)
        .post('/reports/tax-package')
        .send({ from: '2026-03-01', to: '2026-03-31' })
        .expect(401);
    });
  });
});
