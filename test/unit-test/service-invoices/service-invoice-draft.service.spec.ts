import { Prisma } from '@prisma/client';

import {
  draftNote,
  FakeServiceInvoicesRepository,
  FakeStorage,
  INVOICE_ID,
  USER_ID,
} from './testing/fakes';
import { documentKey, DocumentUploads } from '../../../src/infra/storage';
import { ClientService } from '../../../src/modules/client';
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
    findClient = jest.fn().mockResolvedValue({ id: CLIENT_ID });
    service = new ServiceInvoiceDraftService(
      repository as unknown as ServiceInvoicesRepository,
      new DocumentUploads(new FakeStorage()),
      { findOne: findClient } as unknown as ClientService,
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
        amount: 1500,
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

    it('does not edit a confirmed note yet', async () => {
      repository.invoice = draftNote({ status: 'CONFIRMED' });

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

    it('does not discard a confirmed note', async () => {
      repository.invoice = draftNote({ status: 'CONFIRMED' });

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
});
