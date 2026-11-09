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
    }).expect(200);

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
      await saveReview(id, { clientId: client.id }).expect(200);

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
      }).expect(200);
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
      await saveReview(id, { amount: 1500 }).expect(200);

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
      const { clientId } = await prisma.serviceInvoice.findUniqueOrThrow({
        where: { id },
      });

      await saveReview(id, {
        amount: 1450,
        issueDate: '2026-10-20',
        clientId,
      }).expect(200);

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

  describe('consulting, correcting and deleting a confirmed note (US02)', () => {
    type Page = {
      items: {
        id: string;
        number: string | null;
        issueDate: string;
        amount: number;
        client: { id: string; name: string };
        location: string | null;
        hasFile: boolean;
      }[];
      total: number;
    };

    const makeClient = (
      name: string,
      fields: Prisma.ClientUncheckedCreateInput | object = {},
    ) =>
      prisma.client.create({
        data: { userId, type: 'CLINIC', name, ...fields },
      });

    /** A confirmed note, with the income entry the confirmation records. */
    const confirmedNote = async (
      fields: {
        issueDate?: string;
        number?: string | null;
        amount?: number;
        clientId?: string;
        uploaded?: boolean;
      } = {},
    ): Promise<string> => {
      const clientId =
        fields.clientId ?? (await makeClient('Clínica Exemplo')).id;
      const id = await newDraft();
      await saveReview(id, {
        issueDate: fields.issueDate ?? '2026-04-22',
        amount: fields.amount ?? 1284.5,
        clientId,
        ...(fields.number !== null && { number: fields.number ?? '000458' }),
      }).expect(200);
      if (fields.uploaded !== false) {
        await prisma.serviceInvoice.update({
          where: { id },
          data: { uploadedAt: new Date() },
        });
      }
      await request(http)
        .post(`/service-invoices/${id}/confirm`)
        .set('Authorization', bearer(ana))
        .send({ allowDuplicate: true })
        .expect(200);
      return id;
    };

    const list = async (query: Record<string, string | number> = {}) => {
      const response = await request(http)
        .get('/service-invoices')
        .query({
          status: 'CONFIRMED',
          sort: 'issueDate:desc',
          page: 1,
          pageSize: 20,
          ...query,
        })
        .set('Authorization', bearer(ana))
        .expect(200);
      return body(response) as unknown as Page;
    };

    const idsOf = async (query: Record<string, string | number> = {}) =>
      (await list(query)).items.map(note => note.id);

    const entryOf = (serviceInvoiceId: string) =>
      prisma.financialEntry.findFirst({ where: { serviceInvoiceId } });

    describe('listing', () => {
      it('lists only confirmed notes, newest issue date first, with the total', async () => {
        const april = await confirmedNote({ issueDate: '2026-04-22' });
        const june = await confirmedNote({ issueDate: '2026-06-01' });
        const may = await confirmedNote({ issueDate: '2026-05-10' });
        await newDraft();
        const discarded = await newDraft();
        await discard(discarded).expect(204);

        const page = await list();

        expect(page.items.map(note => note.id)).toEqual([june, may, april]);
        expect(page.total).toBe(3);
        expect(page.items[0]).toEqual({
          id: june,
          number: '000458',
          issueDate: '2026-06-01',
          amount: 1284.5,
          client: { id: expect.any(String) as string, name: 'Clínica Exemplo' },
          location: null,
          hasFile: true,
        });
      });

      it('pages the result, breaking ties by id, and totals every match', async () => {
        const ids = [
          await confirmedNote(),
          await confirmedNote(),
          await confirmedNote(),
          await confirmedNote(),
          await confirmedNote(),
        ];
        const sameDay = [...ids].sort().reverse();

        const first = await list({ page: 1, pageSize: 2 });
        const second = await list({ page: 2, pageSize: 2 });
        const last = await list({ page: 3, pageSize: 2 });

        expect(first.total).toBe(5);
        expect(
          [...first.items, ...second.items, ...last.items].map(n => n.id),
        ).toEqual(sameDay);
        expect(last.items).toHaveLength(1);
        expect(await idsOf({ page: 4, pageSize: 2 })).toEqual([]);
      });

      it('says whether the PDF is kept', async () => {
        const withFile = await confirmedNote();
        const withoutFile = await confirmedNote({ uploaded: false });

        const hasFile = Object.fromEntries(
          (await list()).items.map(note => [note.id, note.hasFile]),
        );

        expect(hasFile).toEqual({ [withFile]: true, [withoutFile]: false });
      });

      describe('search', () => {
        let sul: string;
        let norte: string;

        beforeEach(async () => {
          const hospvet = await makeClient('HospVet Sul');
          const clinica = await makeClient('Clínica São José');
          sul = await confirmedNote({
            clientId: hospvet.id,
            number: '000458',
            issueDate: '2026-04-22',
          });
          norte = await confirmedNote({
            clientId: clinica.id,
            number: '7731',
            issueDate: '2026-11-03',
          });
        });

        it.each([
          ['part of the taker name', 'hospvet', 'sul'],
          ['the name without accents or case', 'CLINICA SAO JOSE', 'norte'],
          ['the accented name typed with accents', 'clínica são', 'norte'],
          ['the number', '458', 'sul'],
          ['a partial date with the slash', '22/04', 'sul'],
          ['a partial date with digits only', '2204', 'sul'],
          ['the month and year', '11/2026', 'norte'],
          ['the whole date', '03/11/2026', 'norte'],
        ])('finds by %s', async (_what, search, expected) => {
          const found = await idsOf({ search });

          expect(found).toEqual([expected === 'sul' ? sul : norte]);
        });

        it('totals the matches, not the page', async () => {
          const page = await list({ search: 'hospvet', pageSize: 1 });

          expect(page.total).toBe(1);
          const everyone = await list({ pageSize: 1 });
          expect(everyone.total).toBe(2);
          expect(everyone.items).toHaveLength(1);
        });

        it('finds nothing for a name nobody has', async () => {
          expect(await list({ search: 'zzz' })).toEqual({
            items: [],
            total: 0,
          });
        });

        it('takes % and _ as letters', async () => {
          expect(await list({ search: '%' })).toMatchObject({ total: 0 });
          expect(await list({ search: 'hosp_et' })).toMatchObject({ total: 0 });
        });

        it('does not take a single digit as a date', async () => {
          const found = await idsOf({ search: '2' });

          expect(found).toEqual([]);
        });
      });

      it.each([
        ['without a status', { status: undefined }],
        ['for drafts', { status: 'DRAFT' }],
        ['for discarded drafts', { status: 'CANCELLED' }],
        ['without a sort', { sort: undefined }],
        ['with another sort', { sort: 'amount:asc' }],
        ['without a page', { page: undefined }],
        ['with page 0', { page: 0 }],
        ['with a page beyond any list', { page: 1e300 }],
        ['without a page size', { pageSize: undefined }],
        ['with a page size over 100', { pageSize: 101 }],
        ['with a user id', { userId: randomUUID() }],
      ])('refuses a listing %s', async (_what, override) => {
        await request(http)
          .get('/service-invoices')
          .query({
            status: 'CONFIRMED',
            sort: 'issueDate:desc',
            page: 1,
            pageSize: 20,
            ...override,
          })
          .set('Authorization', bearer(ana))
          .expect(400);
      });
    });

    describe('details', () => {
      const detail = async (id: string) =>
        body(
          await request(http)
            .get(`/service-invoices/${id}`)
            .set('Authorization', bearer(ana))
            .expect(200),
        );

      it('carries the invoice of a confirmed note beside the review', async () => {
        const client = await makeClient('HospVet Sul', {
          taxId: '12345678000190',
          taxIdType: 'CNPJ',
          city: 'São Paulo',
          state: 'SP',
        });
        const id = await confirmedNote({ clientId: client.id });

        expect(await detail(id)).toMatchObject({
          status: 'CONFIRMED',
          uploadedAt: expect.any(String) as string,
          review: expect.objectContaining({ status: 'PENDING' }) as object,
          invoice: {
            id,
            number: '000458',
            issueDate: '2026-04-22',
            amount: 1284.5,
            client: {
              id: client.id,
              name: 'HospVet Sul',
              taxId: '12345678000190',
            },
            location: 'São Paulo, SP',
            hasFile: true,
            file: { name: 'nfse-1287.pdf', bytesSize: 184320 },
          },
        });
      });

      it('has a null tax id, a null location and no file when there are none', async () => {
        const id = await confirmedNote({ uploaded: false });

        expect((await detail(id)).invoice).toMatchObject({
          client: { taxId: null },
          location: null,
          hasFile: false,
          file: null,
        });
      });

      it('has no invoice on a draft, which is still read back for review', async () => {
        const id = await newDraft();

        const draft = await detail(id);

        expect(draft).toMatchObject({
          status: 'DRAFT',
          review: { status: 'PENDING' },
        });
        expect(draft).not.toHaveProperty('invoice');
      });

      it('still shows the client of a note after the client was deleted', async () => {
        const client = await makeClient('Clínica Antiga');
        const id = await confirmedNote({ clientId: client.id });
        await prisma.client.update({
          where: { id: client.id },
          data: { deletedAt: new Date() },
        });

        expect((await detail(id)).invoice).toMatchObject({
          client: { name: 'Clínica Antiga' },
        });
      });
    });

    describe('confirming', () => {
      const confirmWith = async (
        client: { city?: string; state?: string },
        location?: string,
      ) => {
        const { id: clientId } = await makeClient('Clínica', client);
        const id = await newDraft();
        await saveReview(id, {
          issueDate: '2026-04-22',
          amount: 100,
          clientId,
          ...(location && { location }),
        }).expect(200);
        await request(http)
          .post(`/service-invoices/${id}/confirm`)
          .set('Authorization', bearer(ana))
          .send({})
          .expect(200);
        return (
          await prisma.serviceInvoice.findUniqueOrThrow({ where: { id } })
        ).location;
      };

      it("fills the location with the taker's city and state", async () => {
        expect(await confirmWith({ city: 'Campinas', state: 'SP' })).toBe(
          'Campinas, SP',
        );
      });

      it('leaves it null when the taker has only one of them', async () => {
        expect(await confirmWith({ city: 'Campinas' })).toBeNull();
      });

      it('keeps the one the user typed', async () => {
        expect(
          await confirmWith({ city: 'Campinas', state: 'SP' }, 'Santos, SP'),
        ).toBe('Santos, SP');
      });
    });

    describe('correcting', () => {
      const correction = (
        clientId: string,
        over: Record<string, unknown> = {},
      ) => ({
        issueDate: '2026-04-23',
        amount: 1300,
        clientId,
        location: 'Campinas, SP',
        ...over,
      });

      it('changes the note and its income entry together, keeping the link', async () => {
        const id = await confirmedNote({ issueDate: '2026-04-22' });
        const before = await entryOf(id);
        const other = await makeClient('Outra Clínica', {
          paymentTermsDays: 10,
        });

        const response = await saveReview(id, correction(other.id)).expect(200);

        expect(body(response)).toMatchObject({
          status: 'CONFIRMED',
          invoice: {
            id,
            number: '000458',
            issueDate: '2026-04-23',
            amount: 1300,
            client: { id: other.id, name: 'Outra Clínica' },
            location: 'Campinas, SP',
          },
        });
        const after = await entryOf(id);
        expect(after).toMatchObject({
          id: before?.id,
          serviceInvoiceId: id,
          amount: new Prisma.Decimal(1300),
          accrualDate: new Date('2026-04-23T00:00:00Z'),
          dueDate: new Date('2026-05-03T00:00:00Z'),
        });
        await expect(
          prisma.financialEntry.count({ where: { serviceInvoiceId: id } }),
        ).resolves.toBe(1);
      });

      it('clears the location with null, and ignores the number', async () => {
        const id = await confirmedNote();
        const { clientId } = await prisma.serviceInvoice.findUniqueOrThrow({
          where: { id },
        });

        const response = await saveReview(
          id,
          correction(clientId as string, { location: null, number: '999999' }),
        ).expect(200);

        expect(body(response).invoice).toMatchObject({
          location: null,
          number: '000458',
        });
      });

      it('does not run the duplicate check again', async () => {
        const first = await confirmedNote();
        const second = await confirmedNote({
          issueDate: '2026-04-30',
          amount: 10,
          number: '2',
        });
        const { clientId } = await prisma.serviceInvoice.findUniqueOrThrow({
          where: { id: second },
        });

        await saveReview(
          second,
          correction(clientId as string, {
            issueDate: '2026-04-22',
            amount: 1284.5,
          }),
        ).expect(200);

        expect(first).not.toBe(second);
      });

      it.each([
        ['an amount of zero', { amount: 0 }],
        ['a negative amount', { amount: -5 }],
        ['an amount with three decimals', { amount: 10.123 }],
        ['a date that does not exist', { issueDate: '2026-02-30' }],
        ['a date not written YYYY-MM-DD', { issueDate: '23/04/2026' }],
        ['a location over 120 characters', { location: 'x'.repeat(121) }],
        ['a client id that is not a UUID', { clientId: 'abc' }],
        ['a user id', { userId: randomUUID() }],
      ])(
        'refuses %s, leaving note and entry as they were',
        async (_what, over) => {
          const id = await confirmedNote();
          const { clientId } = await prisma.serviceInvoice.findUniqueOrThrow({
            where: { id },
          });

          await saveReview(id, correction(clientId as string, over)).expect(
            400,
          );

          expect(await entryOf(id)).toMatchObject({
            amount: new Prisma.Decimal(1284.5),
          });
          expect(
            await prisma.serviceInvoice.findUniqueOrThrow({ where: { id } }),
          ).toMatchObject({ amount: new Prisma.Decimal(1284.5) });
        },
      );

      it.each(['issueDate', 'amount', 'clientId'])(
        'refuses a correction without %s',
        async field => {
          const id = await confirmedNote();
          const { clientId } = await prisma.serviceInvoice.findUniqueOrThrow({
            where: { id },
          });
          const payload = correction(clientId as string);
          delete (payload as Record<string, unknown>)[field];

          const response = await saveReview(id, payload).expect(400);

          expect(body(response)).toMatchObject({
            code: 'SERVICE_INVOICE_NOT_READY',
            details: { missing: [field] },
          });
        },
      );

      it('leaves everything as it was when the income entry cannot follow', async () => {
        const id = await confirmedNote();
        const { clientId } = await prisma.serviceInvoice.findUniqueOrThrow({
          where: { id },
        });
        await prisma.client.update({
          where: { id: clientId as string },
          data: { deletedAt: new Date() },
        });

        await saveReview(id, correction(clientId as string)).expect(404);

        expect(
          await prisma.serviceInvoice.findUniqueOrThrow({ where: { id } }),
        ).toMatchObject({ amount: new Prisma.Decimal(1284.5), location: null });
        expect(await entryOf(id)).toMatchObject({
          amount: new Prisma.Decimal(1284.5),
        });
      });
    });

    describe('downloading', () => {
      const downloadUrl = (id: string, user: TestUser = ana) =>
        request(http)
          .get(`/service-invoices/${id}/download-url`)
          .set('Authorization', bearer(user));

      it('signs a short-lived URL that names the file', async () => {
        const id = await confirmedNote();

        const response = await downloadUrl(id).expect(200);

        const { url, filename, expiresAt } = body(response) as {
          url: string;
          filename: string;
          expiresAt: string;
        };
        const signed = new URL(url);
        expect(signed.pathname).toContain(
          `users/${userId}/service-invoices/${id}/original`,
        );
        expect(
          signed.searchParams.get('response-content-disposition'),
        ).toContain(`attachment; filename="${filename}"`);
        expect(signed.searchParams.get('response-content-type')).toBe(
          'application/pdf',
        );
        expect(filename).toBe('nfse-1287.pdf');
        const ttlMs = new Date(expiresAt).getTime() - Date.now();
        expect(ttlMs).toBeGreaterThan(4 * 60_000);
        expect(ttlMs).toBeLessThanOrEqual(10 * 60_000);
      });

      it('answers 404 FILE_NOT_FOUND for an unknown note and for one without a file', async () => {
        const withoutFile = await confirmedNote({ uploaded: false });

        for (const id of [randomUUID(), withoutFile]) {
          const response = await downloadUrl(id).expect(404);
          expect(body(response)).toMatchObject({
            code: 'SERVICE_INVOICE_FILE_NOT_FOUND',
          });
        }
      });

      it('answers 409 for a draft', async () => {
        const id = await newDraft();
        await prisma.serviceInvoice.update({
          where: { id },
          data: { uploadedAt: new Date() },
        });

        const response = await downloadUrl(id).expect(409);

        expect(body(response)).toMatchObject({
          code: 'SERVICE_INVOICE_NOT_CONFIRMED',
        });
      });
    });

    describe('deleting', () => {
      it('removes the note and its income entry, and answers 404 the second time', async () => {
        const id = await confirmedNote();

        await discard(id).expect(204);

        expect(await entryOf(id)).toMatchObject({
          deletedAt: expect.any(Date) as Date,
        });
        expect(await idsOf()).toEqual([]);
        expect(await statementTotal()).toBe(0);
        const again = await discard(id).expect(404);
        expect(body(again)).toMatchObject({
          code: 'SERVICE_INVOICE_NOT_FOUND',
        });
        await request(http)
          .get(`/service-invoices/${id}`)
          .set('Authorization', bearer(ana))
          .expect(404);
      });

      it('answers 204 once and 404 for the rest when the app resends it at the same time', async () => {
        const id = await confirmedNote();

        const answers = await Promise.all(
          [1, 2, 3].map(async () => (await discard(id)).status),
        );

        expect(answers.filter(status => status === 204)).toHaveLength(1);
        expect(answers.filter(status => status === 404)).toHaveLength(2);
      });

      const statementTotal = async () => {
        const response = await request(http)
          .get('/financial-entries')
          .query({ year: 2026, month: 4 })
          .set('Authorization', bearer(ana))
          .expect(200);
        return (response.body as unknown[]).length;
      };
    });
  });
});
