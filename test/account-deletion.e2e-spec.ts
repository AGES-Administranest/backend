import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';

import { ensureDefaultFinancialCategories } from './helpers/default-financial-categories';
import {
  bearer,
  body,
  createTestApp,
  FakeIdentityProvider,
  mintTokens,
  resetDatabase,
  TestUser,
  usernameOf,
} from './helpers/test-app';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { DocumentStorage } from '../src/infra/storage';
import { FakeStorage } from './unit-test/stock-entry/testing/fakes';

/** A bucket that can be told to fail, to leave a deletion half done. */
class FlakyStorage extends FakeStorage {
  failNextWith: Error | null = null;

  keys(): string[] {
    return [
      ...(this as unknown as { objects: Map<string, unknown> }).objects.keys(),
    ];
  }

  override deletePrefix(prefix: string): Promise<number> {
    if (this.failNextWith) {
      const error = this.failNextWith;
      this.failNextWith = null;
      return Promise.reject(error);
    }
    return super.deletePrefix(prefix);
  }
}

/**
 * DELETE /users/me against the real database: the unit tests cannot say
 * whether the delete order satisfies the foreign keys, or whether the
 * transaction really leaves nothing behind when it fails halfway.
 */
describe('DELETE /users/me (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;
  let identityProvider: FakeIdentityProvider;
  let storage: FlakyStorage;

  const ana: TestUser = {
    cognitoSub: 'sub-del-ana',
    email: 'ana.del@example.com',
    name: 'Ana Souza',
  };
  const bob: TestUser = {
    cognitoSub: 'sub-del-bob',
    email: 'bob.del@example.com',
    name: 'Bob Lima',
  };
  const stranger: TestUser = {
    cognitoSub: 'sub-del-stranger',
    email: 'stranger.del@example.com',
  };

  let anaId: string;
  let bobId: string;

  beforeAll(async () => {
    storage = new FlakyStorage();
    ({ app, prisma, identityProvider } = await createTestApp(builder =>
      builder.overrideProvider(DocumentStorage).useValue(storage),
    ));
    http = app.getHttpServer() as App;

    await mintTokens(
      [ana, bob, stranger],
      [{}, { authAgeSec: 3600 }, { withoutAuthTime: true }],
    );
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await ensureDefaultFinancialCategories(prisma);
    identityProvider.deleted.length = 0;
    identityProvider.failNextWith = null;
    storage.failNextWith = null;
    storage.keys().forEach(key => void storage.deletePrefix(key));

    anaId = await signUp(ana);
    bobId = await signUp(bob);
    await seedAccount(anaId);
    await seedAccount(bobId);
    storage.put(`users/${anaId}/service-invoices/a/original`, {
      contentLength: 1,
    });
    storage.put(`users/${anaId}/purchase-invoices/b/original`, {
      contentLength: 1,
    });
    storage.put(`users/${bobId}/service-invoices/c/original`, {
      contentLength: 1,
    });
  });

  afterEach(async () => {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS fail_report_delete ON report',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  async function signUp(user: TestUser): Promise<string> {
    const response = await request(http)
      .post('/auth/session')
      .set('Authorization', bearer(user))
      .expect(200);
    return body(response).id as string;
  }

  const deleteMe = (user: TestUser, options = {}) =>
    request(http)
      .delete('/users/me')
      .set('Authorization', bearer(user, options));

  /** One row in every table that has an owner, plus a soft-deleted one. */
  async function seedAccount(userId: string): Promise<void> {
    const supplier = await prisma.supplier.create({
      data: { userId, name: 'Vet Supply' },
    });
    const client = await prisma.client.create({
      data: { userId, type: 'CLINIC', name: 'Pet Clinic' },
    });
    await prisma.client.create({
      data: {
        userId,
        type: 'INDIVIDUAL',
        name: 'Gone Client',
        deletedAt: new Date(),
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        userId,
        brand: 'Fiat',
        model: 'Uno',
        fuelType: 'FLEX',
        avgConsumptionKmL: 10,
        fuelPrice: 6,
      },
    });
    const appointment = await prisma.appointment.create({
      data: { userId, clientId: client.id, startsAt: new Date() },
    });
    const trip = await prisma.trip.create({
      data: {
        userId,
        mode: 'OWN_VEHICLE',
        vehicleId: vehicle.id,
        appointmentId: appointment.id,
        clientId: client.id,
        occurredOn: new Date(),
        origin: 'A',
        destination: 'B',
        distanceKm: 10,
        costPerKm: 0.6,
        cost: 6,
      },
    });
    const item = await prisma.item.create({
      data: {
        userId,
        supplierId: supplier.id,
        category: 'MEDICATION',
        unit: 'ML',
        name: 'Ketamine',
      },
    });
    const lot = await prisma.itemLot.create({
      data: { itemId: item.id, unitCost: 5, receivedOn: new Date() },
    });
    const order = await prisma.purchaseOrder.create({
      data: { userId, supplierId: supplier.id },
    });
    const purchaseInvoice = await prisma.purchaseInvoice.create({
      data: { userId, supplierId: supplier.id },
    });
    const line = await prisma.purchaseInvoiceLine.create({
      data: {
        purchaseInvoiceId: purchaseInvoice.id,
        itemId: item.id,
        lotId: lot.id,
        position: 1,
        description: 'Ketamine 10ml',
      },
    });
    const serviceInvoice = await prisma.serviceInvoice.create({
      data: { userId, clientId: client.id },
    });
    // A movement and the movement that reverses it: the self-reference the
    // delete has to get past.
    const original = await prisma.stockMovement.create({
      data: {
        userId,
        itemId: item.id,
        lotId: lot.id,
        purchaseInvoiceLineId: line.id,
        purchaseOrderId: order.id,
        supplierId: supplier.id,
        type: 'INBOUND',
        source: 'ORDER_IMPORT',
        quantity: 10,
        unitCost: 5,
        occurredAt: new Date(),
      },
    });
    await prisma.stockMovement.create({
      data: {
        userId,
        itemId: item.id,
        type: 'OUTBOUND',
        source: 'CORRECTION_REVERSAL',
        reversedMovementId: original.id,
        quantity: 10,
        unitCost: 5,
        occurredAt: new Date(),
      },
    });
    await prisma.equipment.create({
      data: {
        userId,
        supplierId: supplier.id,
        name: 'Monitor',
        purchaseValue: 1000,
        acquisitionDate: new Date(),
      },
    });
    const category = await prisma.financialCategory.create({
      data: {
        userId,
        name: 'Own category',
        nature: 'EXPENSE',
        defaultScope: 'PROFESSIONAL',
      },
    });
    const base = {
      userId,
      nature: 'EXPENSE' as const,
      scope: 'PROFESSIONAL' as const,
      categoryId: category.id,
      amount: 10,
      accrualDate: new Date(),
    };
    await prisma.financialEntry.createMany({
      data: [
        { ...base, description: 'manual', source: 'MANUAL' },
        {
          ...base,
          description: 'gone',
          source: 'MANUAL',
          deletedAt: new Date(),
        },
      ],
    });
    await prisma.financialEntry.createMany({
      data: [
        { ...base, description: 'trip', source: 'TRIP', tripId: trip.id },
        {
          ...base,
          description: 'visit',
          source: 'APPOINTMENT',
          appointmentId: appointment.id,
        },
        {
          ...base,
          description: 'nfse',
          source: 'SERVICE_INVOICE',
          serviceInvoiceId: serviceInvoice.id,
        },
        {
          ...base,
          description: 'invoice',
          source: 'PURCHASE_INVOICE',
          purchaseInvoiceId: purchaseInvoice.id,
        },
      ],
    });
    await prisma.pricingSettings.create({ data: { userId } });
    await prisma.hourlyRateSnapshot.create({
      data: {
        userId,
        year: 2026,
        month: 10,
        hourlyRate: 100,
        fixedCosts: 1,
        variableCosts: 1,
        ownerDraw: 1,
        safetyMargin: 1,
        monthlyIncomeGoal: 1,
        weeklyHours: 40,
        safetyMarginPct: 10,
        calculatedAt: new Date(),
      },
    });
    await prisma.report.create({ data: { userId, kind: 'MONTHLY' } });
  }

  /** Every table an account owns, soft-deleted rows included. */
  async function rowsOf(userId: string): Promise<Record<string, number>> {
    const where = { userId };
    const through = { userId };
    return {
      user: await prisma.user.count({ where: { id: userId } }),
      client: await prisma.client.count({ where }),
      appointment: await prisma.appointment.count({ where }),
      trip: await prisma.trip.count({ where }),
      vehicle: await prisma.vehicle.count({ where }),
      supplier: await prisma.supplier.count({ where }),
      item: await prisma.item.count({ where }),
      itemLot: await prisma.itemLot.count({ where: { item: through } }),
      stockMovement: await prisma.stockMovement.count({ where }),
      equipment: await prisma.equipment.count({ where }),
      serviceInvoice: await prisma.serviceInvoice.count({ where }),
      purchaseOrder: await prisma.purchaseOrder.count({ where }),
      purchaseInvoice: await prisma.purchaseInvoice.count({ where }),
      purchaseInvoiceLine: await prisma.purchaseInvoiceLine.count({
        where: { purchaseInvoice: through },
      }),
      financialCategory: await prisma.financialCategory.count({ where }),
      financialEntry: await prisma.financialEntry.count({ where }),
      pricingSettings: await prisma.pricingSettings.count({ where }),
      hourlyRateSnapshot: await prisma.hourlyRateSnapshot.count({ where }),
      report: await prisma.report.count({ where }),
    };
  }

  const allEmpty = (rows: Record<string, number>) =>
    Object.fromEntries(Object.keys(rows).map(table => [table, 0]));

  const keysOf = (userId: string) =>
    storage.keys().filter(key => key.startsWith(`users/${userId}/`));

  describe('refusals', () => {
    it('answers 401 without a token', async () => {
      const response = await request(http).delete('/users/me').expect(401);
      expect(body(response)).toMatchObject({ code: 'UNAUTHENTICATED' });
    });

    it('answers 400 when the body names a userId, and deletes nothing', async () => {
      const before = await rowsOf(anaId);

      const response = await deleteMe(ana).send({ userId: bobId }).expect(400);

      expect(body(response)).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { fields: ['property userId should not exist'] },
      });
      expect(await rowsOf(anaId)).toEqual(before);
      expect(await rowsOf(bobId)).not.toEqual(allEmpty(before));
      expect(identityProvider.deleted).toEqual([]);
    });

    it('answers 400 when the query names a userId, and deletes nothing', async () => {
      const before = await rowsOf(anaId);

      const response = await request(http)
        .delete(`/users/me?userId=${bobId}`)
        .set('Authorization', bearer(ana))
        .expect(400);

      expect(body(response)).toMatchObject({ code: 'VALIDATION_ERROR' });
      expect(await rowsOf(anaId)).toEqual(before);
      expect(await rowsOf(bobId)).not.toEqual(allEmpty(before));
    });

    it('answers 401 REAUTH_REQUIRED for a login older than the window', async () => {
      const before = await rowsOf(anaId);

      const response = await deleteMe(ana, { authAgeSec: 3600 }).expect(401);

      expect(body(response)).toMatchObject({ code: 'REAUTH_REQUIRED' });
      expect(await rowsOf(anaId)).toEqual(before);
      expect(keysOf(anaId)).toHaveLength(2);
      expect(identityProvider.deleted).toEqual([]);
    });

    it('answers 401 REAUTH_REQUIRED for a token with no auth_time', async () => {
      const response = await deleteMe(ana, { withoutAuthTime: true }).expect(
        401,
      );

      expect(body(response)).toMatchObject({ code: 'REAUTH_REQUIRED' });
      expect((await rowsOf(anaId)).user).toBe(1);
    });

    it('answers 401 for an account that never existed', async () => {
      const response = await deleteMe(stranger).expect(401);
      expect(body(response)).toMatchObject({ code: 'USER_NOT_PROVISIONED' });
    });
  });

  describe('success', () => {
    it('removes the account, its data and its files, and nobody else’s', async () => {
      const bobBefore = await rowsOf(bobId);
      expect((await rowsOf(anaId)).financialEntry).toBe(6);

      const response = await deleteMe(ana).expect(204);

      expect(response.text).toBe('');
      expect(await rowsOf(anaId)).toEqual(allEmpty(bobBefore));

      expect(await rowsOf(bobId)).toEqual(bobBefore);
      expect(keysOf(anaId)).toEqual([]);
      expect(keysOf(bobId)).toHaveLength(1);
      // The defaults every user shares were not the user's to take.
      expect(
        await prisma.financialCategory.count({ where: { userId: null } }),
      ).toBeGreaterThan(0);
    });

    it('removes the Cognito user, by the username in the token', async () => {
      await deleteMe(ana).expect(204);
      expect(identityProvider.deleted).toEqual([usernameOf(ana)]);
    });

    it('audits the deletion without personal data', async () => {
      await deleteMe(ana).expect(204);

      const audits = await prisma.accountDeletion.findMany();
      expect(audits).toHaveLength(1);
      const [audit] = audits;

      expect(audit.userId).toBe(anaId);
      expect(audit.retentionBasis).toBe('NONE');
      expect(audit.deletedAt).toBeInstanceOf(Date);
      expect(audit.storagePurgedAt).not.toBeNull();
      expect(audit.identityRemovedAt).not.toBeNull();
      expect(audit.cognitoSubHash).toMatch(/^[0-9a-f]{64}$/);

      const stored = JSON.stringify(audit);
      for (const personal of [ana.cognitoSub, ana.email, ana.name!]) {
        expect(stored).not.toContain(personal);
      }
    });

    it('turns the old token away afterwards', async () => {
      await deleteMe(ana).expect(204);

      const me = await request(http)
        .get('/users/me')
        .set('Authorization', bearer(ana))
        .expect(401);
      expect(body(me)).toMatchObject({ code: 'USER_NOT_PROVISIONED' });
    });

    it('does not let the old token create the account again', async () => {
      await deleteMe(ana).expect(204);

      const session = await request(http)
        .post('/auth/session')
        .set('Authorization', bearer(ana))
        .expect(401);

      expect(body(session)).toMatchObject({ code: 'ACCOUNT_DELETED' });
      expect(
        await prisma.user.count({ where: { cognitoSub: ana.cognitoSub } }),
      ).toBe(0);
    });

    it('lets the same e-mail sign up again as a new account', async () => {
      await deleteMe(ana).expect(204);

      const reborn: TestUser = { ...ana, cognitoSub: 'sub-del-ana-2' };
      await mintTokens([reborn]);

      const newId = await signUp(reborn);
      expect(newId).not.toBe(anaId);
    });
  });

  describe('idempotency', () => {
    it('answers 204 again once the account is gone, even with an old login', async () => {
      await deleteMe(ana).expect(204);
      expect(identityProvider.deleted).toHaveLength(1);

      await deleteMe(ana).expect(204);
      await deleteMe(ana, { authAgeSec: 3600 }).expect(204);

      // Nothing left to finish, so nothing was called again.
      expect(identityProvider.deleted).toHaveLength(1);
      expect(await prisma.accountDeletion.count()).toBe(1);
    });

    it('survives two requests at once', async () => {
      const [first, second] = await Promise.all([deleteMe(ana), deleteMe(ana)]);

      expect([first.status, second.status]).toEqual([204, 204]);
      expect(await prisma.accountDeletion.count()).toBe(1);
      expect((await rowsOf(anaId)).user).toBe(0);
      expect((await rowsOf(bobId)).user).toBe(1);
    });
  });

  describe('an account recreated during its own deletion', () => {
    it('is deleted for real the next time, not answered with a hollow 204', async () => {
      await deleteMe(ana).expect(204);

      // What `POST /auth/session` leaves behind when it passes its
      // deleted-account check just before the first deletion commits. The
      // route itself now refuses, so the row is put there by hand.
      const reborn = await prisma.user.create({
        data: {
          cognitoSub: ana.cognitoSub,
          email: ana.email,
          name: ana.name!,
          clients: { create: { type: 'CLINIC', name: 'Back again' } },
        },
      });

      await deleteMe(ana).expect(204);

      expect(await prisma.user.count({ where: { id: reborn.id } })).toBe(0);
      expect(await prisma.client.count({ where: { userId: reborn.id } })).toBe(
        0,
      );
      // One row per account, now describing the latest deletion.
      const audits = await prisma.accountDeletion.findMany();
      expect(audits).toHaveLength(1);
      expect(audits[0].userId).toBe(reborn.id);
      expect(audits[0].storagePurgedAt).not.toBeNull();
      expect(audits[0].identityRemovedAt).not.toBeNull();
      expect(identityProvider.deleted).toHaveLength(2);
    });
  });

  describe('partial failure', () => {
    it('rolls everything back when the transaction fails halfway', async () => {
      // `report` is deleted late in the transaction, after most tables are
      // already gone, so this proves the earlier deletes are undone too.
      await prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION fail_report_delete() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'simulated failure'; END $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(`
        CREATE TRIGGER fail_report_delete BEFORE DELETE ON report
        FOR EACH ROW EXECUTE FUNCTION fail_report_delete()`);
      const before = await rowsOf(anaId);

      const response = await deleteMe(ana).expect(500);

      expect(body(response)).toMatchObject({ code: 'ACCOUNT_DELETION_FAILED' });
      expect(await rowsOf(anaId)).toEqual(before);
      expect(await prisma.accountDeletion.count()).toBe(0);
      expect(keysOf(anaId)).toHaveLength(2);
      expect(identityProvider.deleted).toEqual([]);

      // And the account still works.
      await request(http)
        .get('/users/me')
        .set('Authorization', bearer(ana))
        .expect(200);

      await prisma.$executeRawUnsafe(
        'DROP TRIGGER fail_report_delete ON report',
      );
      await deleteMe(ana).expect(204);
      expect(await rowsOf(anaId)).toEqual(allEmpty(before));
    });

    it('finishes on the next request when the S3 step failed', async () => {
      storage.failNextWith = new Error('S3 is down');

      const response = await deleteMe(ana).expect(500);

      expect(body(response)).toMatchObject({
        code: 'ACCOUNT_DELETION_INCOMPLETE',
      });
      // The data is gone and the login is not yet: the order is the point.
      expect((await rowsOf(anaId)).user).toBe(0);
      expect(keysOf(anaId)).toHaveLength(2);
      expect(identityProvider.deleted).toEqual([]);
      const pending = await prisma.accountDeletion.findFirstOrThrow();
      expect(pending.storagePurgedAt).toBeNull();
      expect(pending.identityRemovedAt).toBeNull();

      await deleteMe(ana).expect(204);

      expect(keysOf(anaId)).toEqual([]);
      expect(identityProvider.deleted).toEqual([usernameOf(ana)]);
      const done = await prisma.accountDeletion.findFirstOrThrow();
      expect(done.storagePurgedAt).not.toBeNull();
      expect(done.identityRemovedAt).not.toBeNull();
      expect(await prisma.accountDeletion.count()).toBe(1);
    });

    it('finishes on the next request when the Cognito step failed', async () => {
      identityProvider.failNextWith = new Error('Cognito is down');

      const response = await deleteMe(ana).expect(500);

      expect(body(response)).toMatchObject({
        code: 'ACCOUNT_DELETION_INCOMPLETE',
      });
      expect((await rowsOf(anaId)).user).toBe(0);
      expect(keysOf(anaId)).toEqual([]);
      const pending = await prisma.accountDeletion.findFirstOrThrow();
      expect(pending.storagePurgedAt).not.toBeNull();
      expect(pending.identityRemovedAt).toBeNull();

      // Meanwhile the token cannot rebuild the account.
      await request(http)
        .post('/auth/session')
        .set('Authorization', bearer(ana))
        .expect(401);

      await deleteMe(ana).expect(204);
      expect(identityProvider.deleted).toEqual([usernameOf(ana)]);
      expect(
        (await prisma.accountDeletion.findFirstOrThrow()).identityRemovedAt,
      ).not.toBeNull();
    });

    it('asks for a fresh login to finish, not only to start', async () => {
      identityProvider.failNextWith = new Error('Cognito is down');
      await deleteMe(ana).expect(500);

      const response = await deleteMe(ana, { authAgeSec: 3600 }).expect(401);

      expect(body(response)).toMatchObject({ code: 'REAUTH_REQUIRED' });
      expect(identityProvider.deleted).toEqual([]);
    });
  });
});
