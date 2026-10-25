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

/**
 * The NFSe draft routes against the real database: the unit suite proves the
 * rules on a fake, not the queries — the filters, the date and decimal
 * columns, or the partial unique `(user_id, file_hash)` that a discarded or a
 * deleted note has to release.
 */
describe('service-invoices (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;
  let userId: string;

  const ana: TestUser = {
    cognitoSub: 'sub-nfse-ana',
    email: 'ana.nfse@example.com',
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
    ({ id: userId } = await prisma.user.findUniqueOrThrow({
      where: { cognitoSub: ana.cognitoSub },
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  const newFileHash = () => randomBytes(32).toString('hex');

  const issueUploadUrl = (id: string, fileHash: string) =>
    request(http)
      .post(`/service-invoices/${id}/upload-url`)
      .set('Authorization', bearer(ana))
      .send({
        filename: 'nfse-1287.pdf',
        fileMimeType: 'application/pdf',
        fileHash,
        fileBytesSize: 184320,
      });

  /** The app picks the note id, so a draft is born on the first issue. */
  const newDraft = async (fileHash = newFileHash()): Promise<string> => {
    const id = randomUUID();
    await issueUploadUrl(id, fileHash).expect(200);
    return id;
  };

  const listIds = async (query = ''): Promise<string[]> => {
    const response = await request(http)
      .get(`/service-invoices${query}`)
      .set('Authorization', bearer(ana))
      .expect(200);
    return (response.body as { id: string }[]).map(note => note.id);
  };

  const saveReview = (id: string, review: Record<string, unknown>) =>
    request(http)
      .patch(`/service-invoices/${id}`)
      .set('Authorization', bearer(ana))
      .send(review);

  const discard = (id: string) =>
    request(http)
      .delete(`/service-invoices/${id}`)
      .set('Authorization', bearer(ana));

  it('signs the upload under the note key and creates the draft', async () => {
    const id = randomUUID();

    const response = await issueUploadUrl(id, newFileHash()).expect(200);

    expect(body(response).fields).toMatchObject({
      key: `users/${userId}/service-invoices/${id}/original`,
      'Content-Type': 'application/pdf',
    });
    await expect(
      prisma.serviceInvoice.findUniqueOrThrow({ where: { id } }),
    ).resolves.toMatchObject({ status: 'DRAFT', extractionStatus: 'PENDING' });
  });

  it('refuses a file that is not a PDF', async () => {
    await request(http)
      .post(`/service-invoices/${randomUUID()}/upload-url`)
      .set('Authorization', bearer(ana))
      .send({
        filename: 'nfse.jpg',
        fileMimeType: 'image/jpeg',
        fileHash: newFileHash(),
        fileBytesSize: 1024,
      })
      .expect(400);
  });

  it('refuses the same file in a second note, naming the first', async () => {
    const fileHash = newFileHash();
    const first = await newDraft(fileHash);

    const response = await issueUploadUrl(randomUUID(), fileHash).expect(409);

    expect(body(response)).toMatchObject({
      code: 'SERVICE_INVOICE_FILE_DUPLICATED',
      details: { serviceInvoiceId: first },
    });
  });

  it('takes the same file again once its draft is discarded', async () => {
    const fileHash = newFileHash();
    const first = await newDraft(fileHash);

    await discard(first).expect(204);

    await newDraft(fileHash);
    await expect(
      prisma.serviceInvoice.findUniqueOrThrow({ where: { id: first } }),
    ).resolves.toMatchObject({ status: 'CANCELLED', fileHash: null });
  });

  it('takes the same file again once its note is deleted', async () => {
    const fileHash = newFileHash();
    const first = await newDraft(fileHash);
    // A confirmed note is removed by `deleted_at`, keeping its hash.
    await prisma.serviceInvoice.update({
      where: { id: first },
      data: { status: 'CONFIRMED', deletedAt: new Date() },
    });

    await newDraft(fileHash);
  });

  it('saves the review and reads it back', async () => {
    const id = await newDraft();
    const client = await prisma.client.create({
      data: { userId, type: 'CLINIC', name: 'Clínica Exemplo' },
    });

    await saveReview(id, {
      issueDate: '2026-10-13',
      amount: 1500.5,
      number: '1287',
      clientId: client.id,
    }).expect(204);

    const response = await request(http)
      .get(`/service-invoices/${id}`)
      .set('Authorization', bearer(ana))
      .expect(200);
    expect(body(response)).toMatchObject({
      id,
      status: 'DRAFT',
      fileName: 'nfse-1287.pdf',
      review: {
        status: 'PENDING',
        issueDate: '2026-10-13',
        amount: 1500.5,
        number: '1287',
        clientId: client.id,
      },
    });
  });

  it('refuses a review that is not a draft anymore', async () => {
    const id = await newDraft();
    await prisma.serviceInvoice.update({
      where: { id },
      data: { status: 'CONFIRMED' },
    });

    const response = await saveReview(id, { number: '1288' }).expect(409);

    expect(body(response)).toMatchObject({
      code: 'SERVICE_INVOICE_NOT_EDITABLE',
    });
  });

  it('refuses an amount that is not positive', async () => {
    const id = await newDraft();

    await saveReview(id, { amount: 0 }).expect(400);
  });

  it('lists the notes newest first, hiding discarded drafts unless asked', async () => {
    const older = await newDraft();
    const newer = await newDraft();
    const discarded = await newDraft();
    await discard(discarded).expect(204);

    expect(await listIds()).toEqual([newer, older]);
    expect(await listIds('?status=CANCELLED')).toEqual([discarded]);
    expect(await listIds('?limit=1&page=2')).toEqual([older]);
  });

  it('filters the list by issue date, both ends included', async () => {
    const [september, october, november] = [
      await newDraft(),
      await newDraft(),
      await newDraft(),
    ];
    await saveReview(september, { issueDate: '2026-09-30' }).expect(204);
    await saveReview(october, { issueDate: '2026-10-01' }).expect(204);
    await saveReview(november, { issueDate: '2026-11-01' }).expect(204);

    expect(await listIds('?from=2026-10-01&to=2026-10-31')).toEqual([october]);
    expect(await listIds('?to=2026-09-30')).toEqual([september]);
  });

  describe('review', () => {
    const TAKER_TAX_ID = '12345678000195';
    const ISSUED = '2026-10-13';

    const readReview = async (id: string) => {
      const response = await request(http)
        .get(`/service-invoices/${id}`)
        .set('Authorization', bearer(ana))
        .expect(200);
      return body(response).review as Record<string, unknown>;
    };

    /** A draft as a reading of the NFSe leaves it. */
    const readDraft = async (): Promise<string> => {
      const id = await newDraft();
      await prisma.serviceInvoice.update({
        where: { id },
        data: {
          extractionStatus: 'SUCCESS',
          issueDate: new Date(`${ISSUED}T00:00:00Z`),
          amount: 1500,
          number: '1287',
          takerTaxId: TAKER_TAX_ID,
          rawExtraction: {
            status: 'success',
            taker: {
              name: 'CLINICA VETERINARIA EXEMPLO LTDA',
              taxId: TAKER_TAX_ID,
            },
          },
        },
      });
      return id;
    };

    const createClient = (name: string, taxId?: string) =>
      prisma.client.create({
        data: {
          userId,
          type: 'CLINIC',
          name,
          ...(taxId && { taxId, taxIdType: 'CNPJ' as const }),
        },
      });

    /** A note already registered, with its own file. */
    const registeredNote = async (data: Record<string, unknown>) => {
      const id = await newDraft();
      await prisma.serviceInvoice.update({
        where: { id },
        data: { status: 'CONFIRMED', ...data },
      });
      return id;
    };

    it('links the client holding the taker tax id', async () => {
      const client = await createClient('Clínica Exemplo', TAKER_TAX_ID);
      await createClient('Clínica Exemplo Norte');

      const review = await readReview(await readDraft());

      expect(review.clientMatch).toEqual({
        id: client.id,
        name: 'Clínica Exemplo',
        taxId: TAKER_TAX_ID,
      });
      expect(review).not.toHaveProperty('clientSuggestions');
    });

    it('suggests clients by name, accents and legal form aside', async () => {
      const same = await createClient('Clínica Exemplo');
      const north = await createClient('Clínica Exemplo Norte');
      await createClient('Clínica Veterinária Bichos');

      const review = await readReview(await readDraft());

      expect(review).not.toHaveProperty('clientMatch');
      expect(review.clientSuggestions).toEqual([
        { id: same.id, name: 'Clínica Exemplo' },
        { id: north.id, name: 'Clínica Exemplo Norte' },
      ]);
    });

    it('stops suggesting once the user picked a client', async () => {
      const client = await createClient('Clínica Exemplo', TAKER_TAX_ID);
      const id = await readDraft();
      await saveReview(id, { clientId: client.id }).expect(204);

      const review = await readReview(id);

      expect(review.clientId).toBe(client.id);
      expect(review).not.toHaveProperty('clientMatch');
    });

    it('warns about a registered note with the same amount and date', async () => {
      const client = await createClient('Clínica Exemplo', TAKER_TAX_ID);
      const registered = await registeredNote({
        issueDate: new Date(`${ISSUED}T00:00:00Z`),
        amount: 1500,
        number: '1201',
        clientId: client.id,
      });

      const review = await readReview(await readDraft());

      expect(review.duplicateOf).toEqual({
        id: registered,
        number: '1201',
        issueDate: ISSUED,
        amount: 1500,
        clientName: 'Clínica Exemplo',
        reason: 'SAME_AMOUNT_AND_DATE',
      });
    });

    it('warns about a registered note with the same number and taker', async () => {
      const registered = await registeredNote({
        issueDate: new Date('2026-09-01T00:00:00Z'),
        amount: 900,
        number: '1287',
        takerTaxId: TAKER_TAX_ID,
      });

      const review = await readReview(await readDraft());

      expect(review.duplicateOf).toMatchObject({
        id: registered,
        reason: 'SAME_NUMBER_AND_TAKER',
      });
    });

    it('does not count drafts, discarded or deleted notes', async () => {
      const same = {
        issueDate: new Date(`${ISSUED}T00:00:00Z`),
        amount: 1500,
      };
      const draft = await newDraft();
      await prisma.serviceInvoice.update({ where: { id: draft }, data: same });
      await registeredNote({ ...same, status: 'CANCELLED', fileHash: null });
      await registeredNote({ ...same, deletedAt: new Date() });

      const review = await readReview(await readDraft());

      expect(review).not.toHaveProperty('duplicateOf');
    });
  });

  it('signs the download only after the upload was confirmed', async () => {
    const id = await newDraft();
    const download = () =>
      request(http)
        .get(`/service-invoices/${id}/file`)
        .set('Authorization', bearer(ana));

    const early = await download().expect(409);
    expect(body(early)).toMatchObject({
      code: 'SERVICE_INVOICE_UPLOAD_NOT_FINISHED',
    });

    await prisma.serviceInvoice.update({
      where: { id },
      data: { uploadedAt: new Date() },
    });
    const response = await download().expect(200);
    expect(body(response).url).toContain(
      `users/${userId}/service-invoices/${id}/original`,
    );
  });
});
