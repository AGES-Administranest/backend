import { Prisma, PurchaseInvoice } from '@prisma/client';

import { buildDocumentKey } from './document-key';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';
import { StockEntryRepository } from './stock-entry.repository';
import { StockEntryService } from './stock-entry.service';
import { StoredDocument } from '../../infra/storage';
import { DomainError } from '../../shared/errors/domain-error';

const USER = { id: 'user-1', cognitoSub: 'sub-123' };
const INVOICE_ID = '5f3b7d0c-2a1e-4c7b-9a11-1f2e3d4c5b6a';
const KEY = buildDocumentKey(USER.id, INVOICE_ID);

const UPLOAD: CreateUploadUrlDto = {
  filename: 'pedido-4521.pdf',
  fileMimeType: 'application/pdf',
  fileHash: 'a'.repeat(64),
  fileBytesSize: 2483911,
};

/**
 * A fake bucket instead of a mock: the point of `confirmUpload` is what is (or
 * is not) at a key, so the double has to hold objects by key.
 */
class FakeStorage {
  private readonly objects = new Map<
    string,
    { document: StoredDocument; bytes: Uint8Array }
  >();

  put(key: string, document: StoredDocument, bytes = new Uint8Array()) {
    this.objects.set(key, { document, bytes });
  }

  headDocument(key: string): Promise<StoredDocument | null> {
    return Promise.resolve(this.objects.get(key)?.document ?? null);
  }

  getDocument(key: string): Promise<Uint8Array | null> {
    return Promise.resolve(this.objects.get(key)?.bytes ?? null);
  }

  createPresignedPost() {
    return Promise.resolve({ url: 'https://bucket', fields: {}, expiresAt: 0 });
  }
}

/** One invoice, stored as the repository would leave it. */
class FakeRepository {
  invoice: PurchaseInvoice | null = null;

  findByIdAndUser(id: string, userId: string) {
    const { invoice } = this;
    return Promise.resolve(
      invoice && invoice.id === id && invoice.userId === userId
        ? invoice
        : null,
    );
  }

  create(data: Prisma.PurchaseInvoiceUncheckedCreateInput) {
    this.invoice = {
      status: 'DRAFT',
      extractionStatus: 'PENDING',
      failureReason: null,
      rawExtraction: null,
      uploadedAt: null,
      ...data,
    } as PurchaseInvoice;
    return Promise.resolve(this.invoice);
  }

  update(id: string, data: Prisma.PurchaseInvoiceUpdateInput) {
    this.invoice = { ...this.invoice, ...data } as PurchaseInvoice;
    return Promise.resolve(this.invoice);
  }
}

describe('StockEntryService', () => {
  let service: StockEntryService;
  let storage: FakeStorage;
  let repository: FakeRepository;

  beforeEach(() => {
    storage = new FakeStorage();
    repository = new FakeRepository();
    service = new StockEntryService(
      repository as unknown as StockEntryRepository,
      storage,
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
      uploadedAt: null,
      ...fields,
    } as PurchaseInvoice;
  };

  describe('upload url', () => {
    const issue = () => service.createUploadUrl(USER.id, INVOICE_ID, UPLOAD);

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

    it('answers with what the bucket holds', async () => {
      storage.put(KEY, {
        contentLength: 2483911,
        contentType: 'application/pdf',
      });

      await expect(confirm()).resolves.toEqual({
        contentLength: 2483911,
        contentType: 'application/pdf',
      });
      expect(repository.invoice?.uploadedAt).toBeInstanceOf(Date);
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
