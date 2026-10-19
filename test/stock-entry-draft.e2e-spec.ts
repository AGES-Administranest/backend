import { INestApplication } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { MAX_DRAFT_LINES } from '../src/modules/stock-entry/stock-entry.constants';

/**
 * The draft routes against the real database: the unit suite runs them on an
 * in-memory fake, which proves the rules but not the queries — the ordering,
 * the date and decimal columns, the transaction that replaces the lines, or
 * the unique `(user_id, file_hash)` a discard has to release.
 */
describe('stock-entry drafts (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;

  const ana: TestUser = {
    cognitoSub: 'sub-drafts-ana',
    email: 'ana.drafts@example.com',
    name: 'Ana Souza',
  };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    http = app.getHttpServer() as App;
    await mintTokens([ana]);
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    await request(http)
      .post('/auth/session')
      .set('Authorization', bearer(ana))
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  const newFileHash = () => randomBytes(32).toString('hex');

  /** The app picks the invoice id, so a draft is born on the first issue. */
  const issueUploadUrl = (invoiceId: string, fileHash: string) =>
    request(http)
      .post(`/stock-entries/${invoiceId}/upload-url`)
      .set('Authorization', bearer(ana))
      .send({
        filename: 'pedido-4521.pdf',
        fileMimeType: 'application/pdf',
        fileHash,
        fileBytesSize: 1024,
      });

  const newDraft = async (fileHash = newFileHash()): Promise<string> => {
    const invoiceId = randomUUID();
    await issueUploadUrl(invoiceId, fileHash).expect(200);
    return invoiceId;
  };

  const createItem = async (name: string): Promise<string> => {
    const response = await request(http)
      .post('/item')
      .set('Authorization', bearer(ana))
      .send({ category: 'MEDICATION', unit: 'AMPOULE', name })
      .expect(201);
    return body(response).id as string;
  };

  const saveLines = (invoiceId: string, lines: unknown) =>
    request(http)
      .put(`/stock-entries/${invoiceId}/items`)
      .set('Authorization', bearer(ana))
      .send({ lines });

  const saveHeader = (invoiceId: string, header: Record<string, unknown>) =>
    request(http)
      .patch(`/stock-entries/${invoiceId}`)
      .set('Authorization', bearer(ana))
      .send(header);

  const readDraft = async (invoiceId: string) => {
    const response = await request(http)
      .get(`/stock-entries/${invoiceId}`)
      .set('Authorization', bearer(ana))
      .expect(200);
    return body(response);
  };

  const listDraftIds = async (): Promise<string[]> => {
    const response = await request(http)
      .get('/stock-entries')
      .set('Authorization', bearer(ana))
      .expect(200);
    return (response.body as { id: string }[]).map(draft => draft.id);
  };

  it('lists the drafts, the most recently changed first', async () => {
    const older = await newDraft();
    const newer = await newDraft();
    expect(await listDraftIds()).toEqual([newer, older]);

    await saveLines(older, [{ description: 'SERINGA 10ML' }]).expect(204);

    expect(await listDraftIds()).toEqual([older, newer]);
  });

  it('reads the lines back as saved, in the order sent, and replaces them on the next save', async () => {
    const invoiceId = await newDraft();
    const propofol = await createItem('Propofol 1% amp 20ml');

    await saveLines(invoiceId, [
      {
        sourceIndex: 0,
        description: 'PROPOFOL 1% 20ML AMP',
        itemId: propofol,
        quantity: 5,
        unitCost: 18.9,
        totalValue: 94.5,
        lotNumber: 'PF8821',
        expirationDate: '2027-05-31',
      },
      { description: 'SERINGA 10ML' },
    ]).expect(204);

    expect((await readDraft(invoiceId)).lines).toEqual([
      {
        sourceIndex: 0,
        description: 'PROPOFOL 1% 20ML AMP',
        item: { id: propofol, name: 'Propofol 1% amp 20ml', unit: 'AMPOULE' },
        quantity: 5,
        unitCost: 18.9,
        totalValue: 94.5,
        lotNumber: 'PF8821',
        expirationDate: '2027-05-31',
        candidates: [],
      },
      { description: 'SERINGA 10ML', candidates: [] },
    ]);

    await saveLines(invoiceId, [{ description: 'SERINGA 10ML' }]).expect(204);

    expect((await readDraft(invoiceId)).lines).toEqual([
      { description: 'SERINGA 10ML', candidates: [] },
    ]);
  });

  it('changes only the header fields sent, and clears the ones sent as null', async () => {
    const invoiceId = await newDraft();

    await saveHeader(invoiceId, {
      invoiceNumber: '4521',
      orderDate: '2026-08-12',
      totalAmount: 1870.7,
    }).expect(204);
    await saveHeader(invoiceId, { invoiceNumber: null }).expect(204);

    const { extraction } = await readDraft(invoiceId);
    expect(extraction).not.toHaveProperty('invoiceNumber');
    expect(extraction).toMatchObject({
      orderDate: '2026-08-12',
      totalAmount: 1870.7,
    });
  });

  it('refuses a date that is not a real YYYY-MM-DD, instead of storing another day', async () => {
    const invoiceId = await newDraft();

    const header = await saveHeader(invoiceId, {
      orderDate: '2027-02-30',
    }).expect(400);
    const lines = await saveLines(invoiceId, [
      { description: 'PROPOFOL', expirationDate: '20270531' },
    ]).expect(400);

    expect(body(header)).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(body(lines)).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses a line linked to an item deleted from the catalog', async () => {
    const invoiceId = await newDraft();
    const deleted = await createItem('Cetamina 10ml');
    await request(http)
      .delete(`/item/${deleted}`)
      .set('Authorization', bearer(ana))
      .expect(200);

    const response = await saveLines(invoiceId, [
      { description: 'CETAMINA', itemId: deleted },
    ]).expect(404);

    expect(body(response)).toMatchObject({ code: 'ITEM_NOT_FOUND' });
  });

  it('discards a draft: it leaves the list, takes no more changes, and its file can start a new entry', async () => {
    const fileHash = newFileHash();
    const invoiceId = await newDraft(fileHash);
    await saveLines(invoiceId, [{ description: 'SERINGA 10ML' }]).expect(204);

    // While the draft holds the file, a second entry is pointed to it.
    const duplicated = await issueUploadUrl(randomUUID(), fileHash).expect(409);
    expect(body(duplicated)).toMatchObject({
      code: 'INVOICE_FILE_DUPLICATED',
      details: { purchaseInvoiceId: invoiceId },
    });

    await request(http)
      .delete(`/stock-entries/${invoiceId}`)
      .set('Authorization', bearer(ana))
      .expect(204);

    expect(await listDraftIds()).toEqual([]);
    const refused = await saveLines(invoiceId, [
      { description: 'ANOTHER LINE' },
    ]).expect(409);
    expect(body(refused)).toMatchObject({ code: 'INVOICE_NOT_EDITABLE' });
    await saveHeader(invoiceId, { invoiceNumber: '9999' }).expect(409);

    const stored = await prisma.purchaseInvoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { lines: true },
    });
    expect(stored).toMatchObject({ status: 'CANCELLED', fileHash: null });
    expect(stored.lines.map(line => line.description)).toEqual([
      'SERINGA 10ML',
    ]);

    await newDraft(fileHash);
  });

  describe('body size', () => {
    /** Every field at the longest the DTO accepts, in two-byte characters. */
    const longestLine = (itemId: string, sourceIndex: number) => ({
      sourceIndex,
      description: 'Ç'.repeat(500),
      itemId,
      quantity: 999_999_998.999,
      unitCost: 999_999_998.9999,
      totalValue: 999_999_998.99,
      lotNumber: 'Ç'.repeat(60),
      expirationDate: '2027-05-31',
    });

    it('reads the largest review the DTO accepts', async () => {
      const invoiceId = await newDraft();
      const itemId = await createItem('Propofol 1% amp 20ml');
      const lines = Array.from({ length: MAX_DRAFT_LINES }, (_, index) =>
        longestLine(itemId, index),
      );

      await saveLines(invoiceId, lines).expect(204);

      expect(
        await prisma.purchaseInvoiceLine.count({
          where: { purchaseInvoiceId: invoiceId },
        }),
      ).toBe(MAX_DRAFT_LINES);
    });

    it('answers a body over the limit with 413, in the error shape', async () => {
      const invoiceId = await newDraft();
      const lines = Array.from({ length: 3000 }, (_, index) =>
        longestLine(randomUUID(), index),
      );

      const response = await saveLines(invoiceId, lines).expect(413);

      expect(body(response)).toMatchObject({ code: 'REQUEST_TOO_LARGE' });
    });

    it('answers JSON that does not parse with 400, in the error shape', async () => {
      const invoiceId = await newDraft();

      const response = await request(http)
        .put(`/stock-entries/${invoiceId}/items`)
        .set('Authorization', bearer(ana))
        .set('Content-Type', 'application/json')
        .send('{"lines": [')
        .expect(400);

      expect(body(response)).toMatchObject({ code: 'INVALID_REQUEST' });
    });
  });
});
