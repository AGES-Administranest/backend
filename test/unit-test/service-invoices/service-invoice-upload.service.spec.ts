import {
  client,
  draftNote,
  FakeClients,
  FakeServiceInvoicesRepository,
  FakeStorage,
  INVOICE_ID,
  reviewService,
  USER_ID,
} from './testing/fakes';
import { documentKey, DocumentUploads } from '../../../src/infra/storage';
import { ExtractionService } from '../../../src/modules/extraction';
import { NfseExtractor } from '../../../src/modules/extraction/nfse/nfse-extractor';
import { PurchaseOrderExtractor } from '../../../src/modules/extraction/purchase-order/purchase-order-extractor';
import { CreateServiceInvoiceUploadUrlDto } from '../../../src/modules/service-invoices/dto/create-upload-url.dto';
import { NfseReadingService } from '../../../src/modules/service-invoices/nfse-reading.service';
import { ServiceInvoiceUploadService } from '../../../src/modules/service-invoices/service-invoice-upload.service';
import { ServiceInvoicesRepository } from '../../../src/modules/service-invoices/service-invoices.repository';
import { UsersService } from '../../../src/modules/users';
import { NATIONAL_DANFSE } from '../extraction/testing/nfse-layouts';
import { buildPdf } from '../extraction/testing/pdf-builder';

const KEY = documentKey(USER_ID, 'service-invoices', INVOICE_ID);

const UPLOAD: CreateServiceInvoiceUploadUrlDto = {
  filename: 'nfse-1287.pdf',
  fileMimeType: 'application/pdf',
  fileHash: 'a'.repeat(64),
  fileBytesSize: 184320,
};

describe('ServiceInvoiceUploadService', () => {
  let service: ServiceInvoiceUploadService;
  let storage: FakeStorage;
  let repository: FakeServiceInvoicesRepository;
  let extraction: ExtractionService;
  let clients: FakeClients;

  beforeEach(() => {
    storage = new FakeStorage();
    repository = new FakeServiceInvoicesRepository();
    clients = new FakeClients();
    extraction = new ExtractionService(
      new PurchaseOrderExtractor(),
      new NfseExtractor(),
    );
    const reading = new NfseReadingService(
      repository as unknown as ServiceInvoicesRepository,
      storage,
      extraction,
      {
        findOne: () => Promise.resolve({ taxId: '12345678909' }),
      } as unknown as UsersService,
    );
    service = new ServiceInvoiceUploadService(
      repository as unknown as ServiceInvoicesRepository,
      new DocumentUploads(storage),
      reading,
      reviewService(repository, clients),
    );
  });

  describe('upload url', () => {
    const issue = () => service.createUploadUrl(USER_ID, INVOICE_ID, UPLOAD);

    it('creates the draft with what the app declared', async () => {
      await issue();

      expect(repository.invoice).toMatchObject({
        id: INVOICE_ID,
        userId: USER_ID,
        status: 'DRAFT',
        fileUrl: KEY,
        fileName: 'nfse-1287.pdf',
        fileHash: UPLOAD.fileHash,
        fileBytesSize: 184320,
      });
    });

    it('refuses a file over the limit before signing anything', async () => {
      await expect(
        service.createUploadUrl(USER_ID, INVOICE_ID, {
          ...UPLOAD,
          fileBytesSize: 15 * 1024 * 1024 + 1,
        }),
      ).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_FILE_TOO_LARGE',
        kind: 'PAYLOAD_TOO_LARGE',
      });
      expect(repository.invoice).toBeNull();
    });

    it('tells which note already holds the same file', async () => {
      repository.invoiceIdsByHash.set(UPLOAD.fileHash, 'other-note');

      await expect(issue()).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_FILE_DUPLICATED',
        details: { serviceInvoiceId: 'other-note' },
      });
    });

    it.each([
      [{ status: 'CONFIRMED' as const }],
      [{ status: 'CANCELLED' as const }],
      [{ extractionStatus: 'PROCESSING' as const }],
      [{ extractionStatus: 'SUCCESS' as const }],
    ])('does not take a new file for %p', async fields => {
      repository.invoice = draftNote(fields);

      await expect(issue()).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_NOT_EDITABLE',
        kind: 'CONFLICT',
      });
    });

    it('reads a replacement for a failed file from scratch, keeping the review', async () => {
      repository.invoice = draftNote({
        extractionStatus: 'FAILED',
        failureReason: 'NO_TEXT_LAYER',
        uploadedAt: new Date(),
        number: '1287',
      });

      await issue();

      expect(repository.invoice).toMatchObject({
        extractionStatus: 'PENDING',
        failureReason: null,
        uploadedAt: null,
        number: '1287',
      });
    });
  });

  describe('upload confirmation', () => {
    const confirm = () => service.confirmUpload(USER_ID, INVOICE_ID);

    const upload = (bytes: Uint8Array) => {
      repository.invoice = draftNote({ fileBytesSize: bytes.length });
      storage.put(
        KEY,
        { contentLength: bytes.length, contentType: 'application/pdf' },
        bytes,
      );
    };

    it('answers with what the bucket holds and what the NFSe says', async () => {
      const pdf = await buildPdf([NATIONAL_DANFSE]);
      upload(pdf);

      await expect(confirm()).resolves.toEqual({
        contentLength: pdf.length,
        contentType: 'application/pdf',
        review: {
          status: 'SUCCESS',
          issueDate: '2026-10-13',
          amount: 1500,
          number: '1287',
          taker: {
            name: 'CLINICA VETERINARIA EXEMPLO LTDA',
            taxId: '12345678000195',
          },
        },
      });
      expect(repository.invoice).toMatchObject({
        extractionStatus: 'SUCCESS',
        takerTaxId: '12345678000195',
        uploadedAt: expect.any(Date) as Date,
      });
    });

    it('links the taker the NFSe names to the client with its tax id', async () => {
      clients.byTaxId = client();
      upload(await buildPdf([NATIONAL_DANFSE]));

      await expect(confirm()).resolves.toMatchObject({
        review: {
          clientMatch: {
            id: client().id,
            name: 'Clínica Veterinária Exemplo',
            taxId: '12345678000195',
          },
        },
      });
      expect(clients.findByTaxId).toHaveBeenCalledWith(
        USER_ID,
        '12345678000195',
      );
    });

    it('fails a note where no field is found, for the review to be filled by hand', async () => {
      upload(await buildPdf([[[40, 40, 'Relatório de atendimentos']]]));

      await expect(confirm()).resolves.toMatchObject({
        review: { status: 'FAILED', failureReason: 'NO_FIELDS_FOUND' },
      });
    });

    it('reads the file once, however many times the app confirms', async () => {
      upload(await buildPdf([NATIONAL_DANFSE]));
      const extract = jest.spyOn(extraction, 'extract');

      await confirm();
      const again = await confirm();

      expect(extract).toHaveBeenCalledTimes(1);
      expect(again.review).toMatchObject({ status: 'SUCCESS', number: '1287' });
    });

    it('rejects when nothing was uploaded', async () => {
      repository.invoice = draftNote();

      await expect(confirm()).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_UPLOAD_NOT_FINISHED',
        kind: 'CONFLICT',
      });
    });

    it('rejects a size that diverges from the declared one', async () => {
      repository.invoice = draftNote();
      storage.put(KEY, { contentLength: 10, contentType: 'application/pdf' });

      await expect(confirm()).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_UPLOAD_MISMATCH',
        details: { field: 'contentLength', declared: 184320, stored: 10 },
      });
    });

    it('does not confirm a note that is no longer a draft', async () => {
      repository.invoice = draftNote({ status: 'CANCELLED' });

      await expect(confirm()).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_NOT_EDITABLE',
      });
    });

    it('does not confirm a note that belongs to someone else', async () => {
      await expect(confirm()).rejects.toMatchObject({
        code: 'SERVICE_INVOICE_NOT_FOUND',
        kind: 'NOT_FOUND',
      });
    });
  });
});
