import { PurchaseInvoice } from '@prisma/client';

import { buildDocumentKey } from './document-key';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { ExtractionService } from './extraction.service';
import { StockEntryRepository } from './stock-entry.repository';
import { StockEntryService } from './stock-entry.service';
import { FakeStockEntryRepository, FakeStorage } from './testing/fakes';
import { DomainError } from '../../shared/errors/domain-error';
import { ExtractionResult } from '../extraction';
import { MatchItemService } from '../item-match';
import { SupplierService } from '../supplier';

const USER = { id: 'user-1', cognitoSub: 'sub-123' };
const INVOICE_ID = '5f3b7d0c-2a1e-4c7b-9a11-1f2e3d4c5b6a';
const KEY = buildDocumentKey(USER.id, INVOICE_ID);

const UPLOAD: CreateUploadUrlDto = {
  filename: 'pedido-4521.pdf',
  fileMimeType: 'application/pdf',
  fileHash: 'a'.repeat(64),
  fileBytesSize: 2483911,
};

const READ: ExtractionResult = {
  status: 'success',
  invoiceNumber: '4521',
  items: [
    { extractedDescription: 'PROPOFOL 1% 20ML AMP', arithmeticCheck: false },
  ],
};

describe('StockEntryService', () => {
  let service: StockEntryService;
  let storage: FakeStorage;
  let repository: FakeStockEntryRepository;
  let extract: jest.Mock;

  beforeEach(() => {
    storage = new FakeStorage();
    repository = new FakeStockEntryRepository();
    extract = jest.fn().mockResolvedValue(READ);
    const extraction = new ExtractionService(
      repository as unknown as StockEntryRepository,
      storage,
      { extract },
      {
        matchLines: () =>
          Promise.resolve([{ decision: 'none', candidates: [] }]),
      } as unknown as MatchItemService,
      {
        findIdByTaxId: () => Promise.resolve(undefined),
      } as unknown as SupplierService,
    );
    service = new StockEntryService(
      repository as unknown as StockEntryRepository,
      storage,
      extraction,
    );
  });

  const draft = (fields: Partial<PurchaseInvoice> = {}) => {
    repository.invoice = {
      id: INVOICE_ID,
      userId: USER.id,
      status: 'DRAFT',
      extractionStatus: 'PENDING',
      failureReason: null,
      fileMimeType: 'application/pdf',
      fileBytesSize: 2483911,
      supplierId: null,
      number: null,
      issueDate: null,
      totalAmount: null,
      rawExtraction: null,
      uploadedAt: null,
      ...fields,
    } as PurchaseInvoice;
  };

  describe('upload url', () => {
    const issue = () => service.createUploadUrl(USER.id, INVOICE_ID, UPLOAD);

    it('tells which entry already holds the same file', async () => {
      repository.invoiceIdsByHash.set(UPLOAD.fileHash, 'other-invoice');

      await expect(issue()).rejects.toMatchObject({
        code: 'INVOICE_FILE_DUPLICATED',
        details: { purchaseInvoiceId: 'other-invoice' },
      });
    });

    it('creates the draft with what the app declared', async () => {
      await issue();

      expect(repository.invoice).toMatchObject({
        id: INVOICE_ID,
        fileUrl: KEY,
        fileName: 'pedido-4521.pdf',
        fileBytesSize: 2483911,
        uploadRequestedAt: expect.any(Date) as Date,
      });
    });

    it('makes a photo the receipt of a manual entry', async () => {
      await service.createUploadUrl(USER.id, INVOICE_ID, {
        ...UPLOAD,
        fileMimeType: 'image/jpeg',
      });

      expect(repository.invoice?.extractionStatus).toBe('MANUAL');
    });

    it.each([
      [{ status: 'CONFIRMED' as const }],
      [{ extractionStatus: 'PROCESSING' as const }],
      [{ extractionStatus: 'SUCCESS' as const }],
    ])('does not take a new file for %p', async fields => {
      draft(fields);

      await expect(issue()).rejects.toMatchObject({
        code: 'INVOICE_NOT_EDITABLE',
        kind: 'CONFLICT',
      });
    });

    it('reads a replacement for a failed file from scratch', async () => {
      draft({
        extractionStatus: 'FAILED',
        failureReason: 'NO_TEXT_LAYER',
        uploadedAt: new Date(),
      });

      await issue();

      expect(repository.invoice).toMatchObject({
        extractionStatus: 'PENDING',
        failureReason: null,
        uploadedAt: null,
      });
    });
  });

  describe('upload confirmation', () => {
    beforeEach(() => draft());

    const confirm = () => service.confirmUpload(USER.id, INVOICE_ID);

    it('answers with what the bucket holds and what the PDF says', async () => {
      storage.put(KEY, {
        contentLength: 2483911,
        contentType: 'application/pdf',
      });

      await expect(confirm()).resolves.toEqual({
        contentLength: 2483911,
        contentType: 'application/pdf',
        extraction: {
          status: 'SUCCESS',
          invoiceNumber: '4521',
          items: [
            {
              extractedDescription: 'PROPOFOL 1% 20ML AMP',
              arithmeticCheck: false,
              match: { decision: 'none', candidates: [] },
            },
          ],
        },
      });
      expect(repository.invoice?.uploadedAt).toBeInstanceOf(Date);
    });

    it('does not read a photo', async () => {
      draft({
        extractionStatus: 'MANUAL',
        fileMimeType: 'image/jpeg',
        fileBytesSize: 1024,
      });
      storage.put(KEY, { contentLength: 1024, contentType: 'image/jpeg' });

      await expect(confirm()).resolves.toMatchObject({
        extraction: { status: 'MANUAL', items: [] },
      });
      expect(extract).not.toHaveBeenCalled();
    });

    it('rejects when nothing was uploaded', async () => {
      await expect(confirm()).rejects.toMatchObject({
        code: 'INVOICE_UPLOAD_NOT_FINISHED',
        kind: 'CONFLICT',
      });
    });

    // The client claiming success is not evidence: only the key it should have
    // written to is.
    it('does not accept an object written under another key', async () => {
      storage.put(buildDocumentKey(USER.id, 'another-invoice'), {
        contentLength: 10,
        contentType: 'application/pdf',
      });

      await expect(confirm()).rejects.toBeInstanceOf(DomainError);
    });

    it('rejects a type that diverges from the declared one', async () => {
      storage.put(KEY, { contentLength: 2483911, contentType: 'image/jpeg' });

      await expect(confirm()).rejects.toMatchObject({
        code: 'INVOICE_UPLOAD_MISMATCH',
      });
    });

    it('rejects a size that diverges from the declared one', async () => {
      storage.put(KEY, { contentLength: 10, contentType: 'application/pdf' });

      await expect(confirm()).rejects.toMatchObject({
        code: 'INVOICE_UPLOAD_MISMATCH',
        details: { field: 'contentLength', declared: 2483911, stored: 10 },
      });
    });

    it('does not confirm an invoice that is no longer a draft', async () => {
      draft({ status: 'CONFIRMED' });
      storage.put(KEY, {
        contentLength: 2483911,
        contentType: 'application/pdf',
      });

      await expect(confirm()).rejects.toMatchObject({
        code: 'INVOICE_NOT_EDITABLE',
      });
    });

    it('does not confirm an invoice that belongs to someone else', async () => {
      repository.invoice = null;
      storage.put(KEY, { contentLength: 1, contentType: 'application/pdf' });

      await expect(confirm()).rejects.toMatchObject({
        code: 'INVOICE_NOT_FOUND',
        kind: 'NOT_FOUND',
      });
    });
  });
});
