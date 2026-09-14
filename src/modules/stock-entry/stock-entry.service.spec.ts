import { PurchaseInvoice } from '@prisma/client';

import { buildDocumentKey } from './document-key';
import { StockEntryRepository } from './stock-entry.repository';
import { StockEntryService } from './stock-entry.service';
import { StoredDocument } from '../../infra/storage';
import { DomainError } from '../../shared/errors/domain-error';

const USER = { id: 'user-1', cognitoSub: 'sub-123' };
const INVOICE_ID = '5f3b7d0c-2a1e-4c7b-9a11-1f2e3d4c5b6a';
const KEY = buildDocumentKey(USER.id, INVOICE_ID);

/**
 * A fake bucket instead of a mock: the point of `confirmUpload` is what is (or
 * is not) at a key, so the double has to hold objects by key.
 */
class FakeStorage {
  private readonly objects = new Map<string, StoredDocument>();

  put(key: string, document: StoredDocument) {
    this.objects.set(key, document);
  }

  headDocument(key: string): Promise<StoredDocument | null> {
    return Promise.resolve(this.objects.get(key) ?? null);
  }

  createPresignedPost() {
    return Promise.reject(new Error('not used in these tests'));
  }
}

describe('StockEntryService — upload confirmation', () => {
  let service: StockEntryService;
  let storage: FakeStorage;
  let invoice: PurchaseInvoice | null;

  beforeEach(() => {
    storage = new FakeStorage();
    invoice = {
      id: INVOICE_ID,
      userId: USER.id,
      fileMimeType: 'application/pdf',
    } as PurchaseInvoice;

    const repository = {
      findByIdAndUser: (id: string, userId: string) =>
        Promise.resolve(
          invoice && invoice.id === id && invoice.userId === userId
            ? invoice
            : null,
        ),
    };
    service = new StockEntryService(
      repository as unknown as StockEntryRepository,
      storage,
    );
  });

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

  it('does not confirm an invoice that belongs to someone else', async () => {
    invoice = null;
    storage.put(KEY, { contentLength: 1, contentType: 'application/pdf' });

    await expect(confirm()).rejects.toMatchObject({
      code: 'INVOICE_NOT_FOUND',
      kind: 'NOT_FOUND',
    });
  });
});
