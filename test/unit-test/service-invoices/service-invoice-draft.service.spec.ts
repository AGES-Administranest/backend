import { Prisma } from '@prisma/client';

import {
  confirmationService,
  draftNote,
  FakeClients,
  FakeFinancialEntries,
  FakeServiceInvoicesRepository,
  FakeStorage,
  INVOICE_ID,
  reviewService,
  USER_ID,
} from './testing/fakes';
import { documentKey, DocumentUploads } from '../../../src/infra/storage';
import { QueryServiceInvoiceReportDto } from '../../../src/modules/service-invoices/dto/query-service-invoice-report.dto';
import { ServiceInvoiceDraftService } from '../../../src/modules/service-invoices/service-invoice-draft.service';
import { ServiceInvoicesRepository } from '../../../src/modules/service-invoices/service-invoices.repository';
import { DomainError } from '../../../src/shared/errors/domain-error';

const CLIENT_ID = '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

describe('ServiceInvoiceDraftService', () => {
  let service: ServiceInvoiceDraftService;
  let repository: FakeServiceInvoicesRepository;
  let findClient: jest.Mock;

  beforeEach(() => {
    repository = new FakeServiceInvoicesRepository();
    const clients = new FakeClients();
    findClient = clients.findOne;
    service = new ServiceInvoiceDraftService(
      repository as unknown as ServiceInvoicesRepository,
      new DocumentUploads(new FakeStorage()),
      clients.service,
      reviewService(repository, clients),
      confirmationService(repository, clients, new FakeFinancialEntries()),
    );
  });

  describe('detail', () => {
    it('shows the review as the user left it, with the taker as read', async () => {
      repository.invoice = draftNote({
        extractionStatus: 'SUCCESS',
        issueDate: new Date('2026-10-13T00:00:00Z'),
        amount: new Prisma.Decimal(1450),
        number: '1287',
        takerTaxId: '12345678000195',
        clientId: CLIENT_ID,
        rawExtraction: {
          status: 'success',
          grossAmount: 1500,
          taker: { name: 'CLINICA VETERINARIA EXEMPLO LTDA' },
        },
      });

      await expect(service.get(USER_ID, INVOICE_ID)).resolves.toMatchObject({
        id: INVOICE_ID,
        status: 'DRAFT',
        review: {
          status: 'SUCCESS',
          issueDate: '2026-10-13',
          amount: 1450,
          number: '1287',
          taker: {
            name: 'CLINICA VETERINARIA EXEMPLO LTDA',
            taxId: '12345678000195',
          },
          clientId: CLIENT_ID,
        },
      });
    });

    it("answers 404 for a note that is not the user's", async () => {
      await expect(service.get(USER_ID, INVOICE_ID)).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_NOT_FOUND',
        kind: 'NOT_FOUND',
      });
    });
  });

  describe('detail of a confirmed note', () => {
    const confirmedNote = (fields = {}) =>
      draftNote({
        status: 'CONFIRMED',
        issueDate: new Date('2026-04-22T00:00:00Z'),
        amount: new Prisma.Decimal('1284.5'),
        number: '000458',
        clientId: CLIENT_ID,
        location: 'São Paulo, SP',
        uploadedAt: new Date('2026-04-22T13:02:11Z'),
        ...fields,
      });

    beforeEach(() => {
      repository.clientSummary = {
        id: CLIENT_ID,
        name: 'HospVet Sul',
        taxId: '12345678000190',
      };
    });

    it('carries the invoice with the values as they stand', async () => {
      repository.invoice = confirmedNote();

      await expect(service.get(USER_ID, INVOICE_ID)).resolves.toMatchObject({
        status: 'CONFIRMED',
        uploadedAt: '2026-04-22T13:02:11.000Z',
        review: { status: 'PENDING' },
        invoice: {
          id: INVOICE_ID,
          number: '000458',
          issueDate: '2026-04-22',
          amount: 1284.5,
          client: {
            id: CLIENT_ID,
            name: 'HospVet Sul',
            taxId: '12345678000190',
          },
          location: 'São Paulo, SP',
          hasFile: true,
          file: { name: 'nfse-1287.pdf', bytesSize: 184320 },
        },
      });
    });

    it('has no file and no tax id when there are none', async () => {
      repository.invoice = confirmedNote({ uploadedAt: null, location: null });
      repository.clientSummary = { id: CLIENT_ID, name: 'Ana', taxId: null };

      const { invoice } = await service.get(USER_ID, INVOICE_ID);

      expect(invoice).toMatchObject({
        hasFile: false,
        file: null,
        location: null,
        client: { taxId: null },
      });
    });

    it('is absent on a draft, so resuming it works as before', async () => {
      repository.invoice = draftNote();

      const detail = await service.get(USER_ID, INVOICE_ID);

      expect(detail).not.toHaveProperty('invoice');
    });

    it('is what a correction answers, with the new values', async () => {
      repository.invoice = confirmedNote();

      const detail = await service.update(USER_ID, INVOICE_ID, {
        issueDate: '2026-04-23',
        amount: 1300,
        clientId: CLIENT_ID,
        location: 'Campinas, SP',
      });

      expect(detail.invoice).toMatchObject({
        issueDate: '2026-04-23',
        amount: 1300,
        location: 'Campinas, SP',
      });
    });
  });

  describe('reports list', () => {
    const query = (fields: Partial<QueryServiceInvoiceReportDto> = {}) =>
      Object.assign(new QueryServiceInvoiceReportDto(), fields);

    it('shows the issue date, the taker name and whether the file exists', async () => {
      repository.reportNotes = [
        {
          id: INVOICE_ID,
          issueDate: new Date('2026-10-13T00:00:00Z'),
          fileUrl: 'service-invoice/abc.pdf',
          client: { name: 'Clinica Exemplo' },
        },
        {
          id: 'other',
          issueDate: new Date('2026-10-01T00:00:00Z'),
          fileUrl: null,
          client: { name: 'Ana Souza' },
        },
      ];

      await expect(service.listForReports(USER_ID, query())).resolves.toEqual([
        {
          id: INVOICE_ID,
          issueDate: '2026-10-13',
          takerName: 'Clinica Exemplo',
          hasFile: true,
        },
        {
          id: 'other',
          issueDate: '2026-10-01',
          takerName: 'Ana Souza',
          hasFile: false,
        },
      ]);
    });

    it("asks for the token's owner only, with no filter by default", async () => {
      await service.listForReports(USER_ID, query());

      expect(repository.reportQueries).toEqual([
        { userId: USER_ID, filters: {}, skip: 0, take: 50 },
      ]);
    });

    it('passes the search and the period, and pages from the limit', async () => {
      await service.listForReports(
        USER_ID,
        query({
          search: 'vet',
          startDate: '2026-10-01',
          endDate: '2026-10-31',
          page: 3,
          limit: 10,
        }),
      );

      expect(repository.reportQueries).toEqual([
        {
          userId: USER_ID,
          filters: {
            search: 'vet',
            issuedFrom: new Date('2026-10-01T00:00:00Z'),
            issuedTo: new Date('2026-10-31T00:00:00Z'),
          },
          skip: 20,
          take: 10,
        },
      ]);
    });

    it.each([
      ['startDate', { startDate: '2026-10-01' }, 'issuedFrom'],
      ['endDate', { endDate: '2026-10-31' }, 'issuedTo'],
    ])('accepts %s alone, as an open period', async (_name, dates, bound) => {
      await service.listForReports(USER_ID, query(dates));

      expect(Object.keys(repository.reportQueries[0].filters)).toEqual([bound]);
    });

    it('accepts a one-day period', async () => {
      await expect(
        service.listForReports(
          USER_ID,
          query({ startDate: '2026-10-13', endDate: '2026-10-13' }),
        ),
      ).resolves.toEqual([]);
    });

    it('refuses a start date after the end date', async () => {
      await expect(
        service.listForReports(
          USER_ID,
          query({ startDate: '2026-11-01', endDate: '2026-10-31' }),
        ),
      ).rejects.toMatchObject({
        kind: 'INVALID_INPUT',
        code: 'INVALID_REQUEST',
      });
      expect(repository.reportQueries).toEqual([]);
    });
  });

  describe('review', () => {
    it('saves only the fields sent, and clears the ones sent as null', async () => {
      repository.invoice = draftNote({ number: '1287', takerTaxId: '123' });

      await service.update(USER_ID, INVOICE_ID, {
        issueDate: '2026-10-13',
        amount: 1500,
        number: null,
        clientId: CLIENT_ID,
      });

      expect(repository.invoice).toMatchObject({
        issueDate: new Date('2026-10-13T00:00:00Z'),
        amount: new Prisma.Decimal(1500),
        number: null,
        clientId: CLIENT_ID,
        takerTaxId: '123',
        reviewedAt: expect.any(Date) as Date,
      });
    });

    it('checks the client belongs to the user before linking it', async () => {
      repository.invoice = draftNote();
      findClient.mockRejectedValue(
        new DomainError('NOT_FOUND', 'CLIENT_NOT_FOUND', 'Client not found'),
      );

      await expect(
        service.update(USER_ID, INVOICE_ID, { clientId: CLIENT_ID }),
      ).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
      expect(findClient).toHaveBeenCalledWith(CLIENT_ID, USER_ID);
      expect(repository.invoice?.clientId).toBeNull();
    });

    it('does not edit a discarded draft', async () => {
      repository.invoice = draftNote({ status: 'CANCELLED' });

      await expect(
        service.update(USER_ID, INVOICE_ID, { number: '1288' }),
      ).rejects.toMatchObject({ code: 'SERVICE_INVOICE_NOT_EDITABLE' });
    });
  });

  describe('discard', () => {
    it('cancels the draft and frees its file', async () => {
      repository.invoice = draftNote();

      await service.discard(USER_ID, INVOICE_ID);

      expect(repository.invoice).toMatchObject({
        status: 'CANCELLED',
        fileHash: null,
      });
    });

    it('does not discard a note twice', async () => {
      repository.invoice = draftNote({ status: 'CANCELLED' });

      await expect(service.discard(USER_ID, INVOICE_ID)).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_NOT_EDITABLE',
        kind: 'CONFLICT',
      });
    });
  });

  describe('download', () => {
    it('signs a GET on the note key', async () => {
      repository.invoice = draftNote({ uploadedAt: new Date() });

      await expect(
        service.downloadUrl(USER_ID, INVOICE_ID),
      ).resolves.toMatchObject({
        url: `https://bucket/${documentKey(USER_ID, 'service-invoices', INVOICE_ID)}`,
      });
    });

    it('has nothing to download before the upload is confirmed', async () => {
      repository.invoice = draftNote();

      await expect(
        service.downloadUrl(USER_ID, INVOICE_ID),
      ).rejects.toMatchObject({ code: 'SERVICE_INVOICE_UPLOAD_NOT_FINISHED' });
    });
  });

  describe('download of the PDF', () => {
    const confirmed = (fields = {}) =>
      draftNote({
        status: 'CONFIRMED',
        uploadedAt: new Date('2026-04-22T13:02:11Z'),
        ...fields,
      });

    it('signs the note key and names the file safely', async () => {
      repository.invoice = confirmed({ fileName: '../../etc/pas"swd\n.PDF' });

      const download = await service.downloadFile(USER_ID, INVOICE_ID);

      expect(download).toEqual({
        url: `https://bucket/${documentKey(USER_ID, 'service-invoices', INVOICE_ID)}`,
        filename: '_.._etc_pas_swd.pdf',
        expiresAt: '1970-01-01T00:00:00.000Z',
      });
    });

    it('answers FILE_NOT_FOUND for a note that is missing or not the userʼs', async () => {
      repository.invoice = confirmed();

      for (const [user, id] of [
        [USER_ID, 'other-id'],
        ['another-user', INVOICE_ID],
      ]) {
        await expect(service.downloadFile(user, id)).rejects.toMatchObject({
          code: 'SERVICE_INVOICE_FILE_NOT_FOUND',
          kind: 'NOT_FOUND',
        });
      }
    });

    it('answers FILE_NOT_FOUND for a note without its file', async () => {
      repository.invoice = confirmed({ uploadedAt: null });

      await expect(
        service.downloadFile(USER_ID, INVOICE_ID),
      ).rejects.toMatchObject({ code: 'SERVICE_INVOICE_FILE_NOT_FOUND' });
    });

    it('answers 409 for a draft', async () => {
      repository.invoice = draftNote({ uploadedAt: new Date() });

      await expect(
        service.downloadFile(USER_ID, INVOICE_ID),
      ).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_NOT_CONFIRMED',
        kind: 'CONFLICT',
      });
    });
  });
});
