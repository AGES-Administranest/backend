import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    await ensureDefaultFinancialCategories(prisma);
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

  it('refuses a review of a discarded draft', async () => {
    const id = await newDraft();
    await discard(id).expect(204);

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

  describe('reports list', () => {
    const REPORTS = '/service-invoices/reports';

    /** A confirmed note written straight to the table, with its taker. */
    const confirmedNote = async (
      owner: string,
      takerName: string,
      issueDate: string,
      fields: Partial<Prisma.ServiceInvoiceUncheckedCreateInput> = {},
    ): Promise<string> => {
      const client = await prisma.client.create({
        data: { userId: owner, type: 'CLINIC', name: takerName },
      });
      const note = await prisma.serviceInvoice.create({
        data: {
          userId: owner,
          clientId: client.id,
          status: 'CONFIRMED',
          issueDate: new Date(`${issueDate}T00:00:00Z`),
          amount: 1500,
          fileUrl: `users/${owner}/service-invoices/${randomUUID()}/original`,
          ...fields,
        },
      });
      return note.id;
    };

    const reports = async (query = '') => {
      const response = await request(http)
        .get(`${REPORTS}${query}`)
        .set('Authorization', bearer(ana))
        .expect(200);
      return response.body as {
        id: string;
        issueDate: string;
        takerName: string;
        hasFile: boolean;
      }[];
    };

    const reportIds = async (query = '') =>
      (await reports(query)).map(note => note.id);

    it('lists the issue date, the taker name and the file indicator', async () => {
      const withFile = await confirmedNote(
        userId,
        'Clínica Exemplo',
        '2026-10-13',
      );
      const withoutFile = await confirmedNote(
        userId,
        'Ana Souza',
        '2026-10-01',
        { fileUrl: null },
      );

      expect(await reports()).toEqual([
        {
          id: withFile,
          issueDate: '2026-10-13',
          takerName: 'Clínica Exemplo',
          hasFile: true,
        },
        {
          id: withoutFile,
          issueDate: '2026-10-01',
          takerName: 'Ana Souza',
          hasFile: false,
        },
      ]);
    });

    it('orders by issue date, latest first, whatever the order they were recorded', async () => {
      const middle = await confirmedNote(userId, 'B', '2026-10-10');
      const oldest = await confirmedNote(userId, 'A', '2026-09-01');
      const latest = await confirmedNote(userId, 'C', '2026-11-05');

      expect(await reportIds()).toEqual([latest, middle, oldest]);
    });

    it('leaves out drafts, discarded drafts and deleted notes', async () => {
      const confirmed = await confirmedNote(userId, 'Confirmed', '2026-10-13');
      await confirmedNote(userId, 'Draft', '2026-10-14', { status: 'DRAFT' });
      await confirmedNote(userId, 'Cancelled', '2026-10-15', {
        status: 'CANCELLED',
      });
      await confirmedNote(userId, 'Deleted', '2026-10-16', {
        deletedAt: new Date(),
      });

      expect(await reportIds()).toEqual([confirmed]);
    });

    it('searches the taker name, in part and in any letter case', async () => {
      const clinic = await confirmedNote(
        userId,
        'Clínica Veterinária Sul',
        '2026-10-13',
      );
      await confirmedNote(userId, 'Ana Souza', '2026-10-12');

      expect(await reportIds('?search=VETERIN')).toEqual([clinic]);
      expect(await reportIds('?search=sul')).toEqual([clinic]);
      expect(await reportIds('?search=nobody')).toEqual([]);
      expect(await reportIds('?search=%20%20')).toHaveLength(2);
    });

    it('takes % and _ in the search as plain characters', async () => {
      await confirmedNote(userId, 'Clínica Sul', '2026-10-13');

      expect(await reportIds('?search=%25')).toEqual([]);
      expect(await reportIds('?search=_')).toEqual([]);
    });

    it('filters by period, both ends included, and either one alone', async () => {
      const september = await confirmedNote(userId, 'A', '2026-09-30');
      const october = await confirmedNote(userId, 'B', '2026-10-01');
      const november = await confirmedNote(userId, 'C', '2026-11-01');

      expect(
        await reportIds('?startDate=2026-10-01&endDate=2026-10-31'),
      ).toEqual([october]);
      expect(await reportIds('?startDate=2026-10-01')).toEqual([
        november,
        october,
      ]);
      expect(await reportIds('?endDate=2026-10-01')).toEqual([
        october,
        september,
      ]);
      expect(
        await reportIds('?startDate=2026-10-01&endDate=2026-10-01'),
      ).toEqual([october]);
    });

    it('combines the search with the period', async () => {
      await confirmedNote(userId, 'Clínica Sul', '2026-09-10');
      const match = await confirmedNote(userId, 'Clínica Norte', '2026-10-10');
      await confirmedNote(userId, 'Ana Souza', '2026-10-11');

      expect(await reportIds('?search=clínica&startDate=2026-10-01')).toEqual([
        match,
      ]);
    });

    it('pages the list, for the few cards and for "see all"', async () => {
      const first = await confirmedNote(userId, 'A', '2026-10-03');
      const second = await confirmedNote(userId, 'B', '2026-10-02');
      const third = await confirmedNote(userId, 'C', '2026-10-01');

      expect(await reportIds('?limit=2')).toEqual([first, second]);
      expect(await reportIds('?limit=2&page=2')).toEqual([third]);
    });

    it('refuses a start date after the end date', async () => {
      const response = await request(http)
        .get(`${REPORTS}?startDate=2026-11-01&endDate=2026-10-31`)
        .set('Authorization', bearer(ana))
        .expect(400);

      expect(body(response)).toMatchObject({ code: 'INVALID_REQUEST' });
    });

    it.each([
      '?startDate=2026-02-30',
      '?endDate=13/10/2026',
      '?page=0',
      '?limit=101',
      '?userId=someone-else',
    ])('refuses %s', async query => {
      const response = await request(http)
        .get(`${REPORTS}${query}`)
        .set('Authorization', bearer(ana))
        .expect(400);

      expect(body(response)).toMatchObject({ code: 'VALIDATION_ERROR' });
    });

    it("never shows another account's notes", async () => {
      const other = await prisma.user.create({
        data: {
          cognitoSub: 'sub-nfse-bruno',
          email: 'bruno.nfse@example.com',
          name: 'Bruno Lima',
        },
      });
      await confirmedNote(other.id, 'Clínica do Bruno', '2026-10-13');
      const mine = await confirmedNote(userId, 'Clínica da Ana', '2026-10-12');

      expect(await reportIds()).toEqual([mine]);
      expect(await reportIds('?search=bruno')).toEqual([]);
    });

    it('requires a token', async () => {
      await request(http).get(REPORTS).expect(401);
    });
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

  describe('confirmation', () => {
    const ISSUED = '2026-10-13';

    const confirm = (id: string, payload: Record<string, unknown> = {}) =>
      request(http)
        .post(`/service-invoices/${id}/confirm`)
        .set('Authorization', bearer(ana))
        .send(payload);

    /** A draft reviewed with everything a confirmation needs. */
    const reviewedDraft = async (fileHash?: string) => {
      const client = await prisma.client.create({
        data: {
          userId,
          type: 'CLINIC',
          name: 'Clínica Exemplo',
          paymentTermsDays: 30,
        },
      });
      const id = await newDraft(fileHash);
      await saveReview(id, {
        issueDate: ISSUED,
        amount: 1500,
        number: '1287',
        clientId: client.id,
      }).expect(204);
      return id;
    };

    const entryOf = (serviceInvoiceId: string) =>
      prisma.financialEntry.findUnique({ where: { serviceInvoiceId } });

    const statement = async () => {
      const response = await request(http)
        .get('/financial-entries')
        .query({ year: 2026, month: 10 })
        .set('Authorization', bearer(ana))
        .expect(200);
      return response.body as {
        id: string;
        amount: string;
        source: string;
        origin: { type: string; id: string };
      }[];
    };

    it('records the income entry of the note, due after the client terms', async () => {
      const id = await reviewedDraft();

      const response = await confirm(id).expect(200);

      const { financialEntryId } = body(response) as {
        financialEntryId: string;
      };
      expect(body(response)).toEqual({ id, financialEntryId });
      await expect(entryOf(id)).resolves.toMatchObject({
        id: financialEntryId,
        nature: 'INCOME',
        scope: 'PROFESSIONAL',
        source: 'SERVICE_INVOICE',
        status: 'PENDING',
        description: 'NFS-e 1287',
        accrualDate: new Date(`${ISSUED}T00:00:00Z`),
        dueDate: new Date('2026-11-12T00:00:00Z'),
      });
      expect(await statement()).toEqual([
        expect.objectContaining({
          id: financialEntryId,
          amount: '1500',
          source: 'SERVICE_INVOICE',
          origin: { type: 'SERVICE_INVOICE', id },
        }),
      ]);
    });

    it('lists what is missing before confirming', async () => {
      const id = await newDraft();
      await saveReview(id, { amount: 1500 }).expect(204);

      const response = await confirm(id).expect(400);

      expect(body(response)).toMatchObject({
        code: 'SERVICE_INVOICE_NOT_READY',
        details: { missing: ['issueDate', 'clientId'] },
      });
      await expect(entryOf(id)).resolves.toBeNull();
    });

    it('confirms a note once, with one entry', async () => {
      const id = await reviewedDraft();
      await confirm(id).expect(200);

      const response = await confirm(id).expect(409);

      expect(body(response)).toMatchObject({
        code: 'SERVICE_INVOICE_NOT_EDITABLE',
      });
      await expect(
        prisma.financialEntry.count({ where: { serviceInvoiceId: id } }),
      ).resolves.toBe(1);
    });

    it('points to a confirmed note that looks the same until the user insists', async () => {
      const first = await reviewedDraft();
      await confirm(first).expect(200);
      const second = await reviewedDraft();

      const refused = await confirm(second).expect(409);
      expect(body(refused)).toMatchObject({
        code: 'SERVICE_INVOICE_POSSIBLE_DUPLICATE',
        details: {
          duplicateOf: { id: first, reason: 'SAME_AMOUNT_AND_DATE' },
        },
      });
      await expect(entryOf(second)).resolves.toBeNull();

      await confirm(second, { allowDuplicate: true }).expect(200);
      await expect(entryOf(second)).resolves.not.toBeNull();
    });

    it('takes the entry along when a confirmed note is edited', async () => {
      const id = await reviewedDraft();
      await confirm(id).expect(200);

      await saveReview(id, { amount: 1450, issueDate: '2026-10-20' }).expect(
        204,
      );

      await expect(entryOf(id)).resolves.toMatchObject({
        amount: new Prisma.Decimal(1450),
        accrualDate: new Date('2026-10-20T00:00:00Z'),
        dueDate: new Date('2026-11-19T00:00:00Z'),
      });
    });

    it('keeps the required fields of a confirmed note', async () => {
      const id = await reviewedDraft();
      await confirm(id).expect(200);

      await saveReview(id, { amount: null }).expect(400);

      await expect(entryOf(id)).resolves.toMatchObject({
        amount: new Prisma.Decimal(1500),
      });
    });

    it('leaves the amount of the entry to the note', async () => {
      const id = await reviewedDraft();
      const { financialEntryId } = body(await confirm(id).expect(200)) as {
        financialEntryId: string;
      };

      const response = await request(http)
        .patch(`/financial-entries/${financialEntryId}`)
        .set('Authorization', bearer(ana))
        .send({ amount: 10 })
        .expect(400);

      expect(body(response)).toMatchObject({
        code: 'FINANCIAL_ENTRY_CONTROLLED_BY_ORIGIN',
      });
    });

    it('deletes a confirmed note with its entry, freeing its file', async () => {
      const fileHash = newFileHash();
      const id = await reviewedDraft(fileHash);
      await confirm(id).expect(200);

      await discard(id).expect(204);

      expect(await statement()).toEqual([]);
      await expect(
        prisma.serviceInvoice.findUniqueOrThrow({ where: { id } }),
      ).resolves.toMatchObject({ deletedAt: expect.any(Date) as Date });
      await newDraft(fileHash);
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
