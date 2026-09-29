import { Prisma, PurchaseInvoice } from '@prisma/client';

import { StoredDocument } from '../../../infra/storage';

/**
 * A fake bucket instead of a mock: the point of the upload confirmation is
 * what is (or is not) at a key, so the double has to hold objects by key.
 */
export class FakeStorage {
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
export class FakeStockEntryRepository {
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

  update(id: string, data: Prisma.PurchaseInvoiceUncheckedUpdateInput) {
    const stored = Object.fromEntries(
      Object.entries(data).map(([field, value]) => [
        field,
        value === Prisma.DbNull ? null : value,
      ]),
    );
    this.invoice = {
      ...this.invoice,
      ...stored,
      updatedAt: new Date(),
    } as PurchaseInvoice;
    return Promise.resolve(this.invoice);
  }

  /** Same rule as the conditional update in the real repository. */
  claimExtraction(id: string, staleBefore: Date) {
    const { invoice } = this;
    const waiting =
      invoice?.extractionStatus === 'PENDING' ||
      invoice?.extractionStatus === 'FAILED';
    const stale =
      invoice?.extractionStatus === 'PROCESSING' &&
      invoice.updatedAt < staleBefore;
    if (!invoice || invoice.id !== id || invoice.status !== 'DRAFT') {
      return Promise.resolve(false);
    }
    if (!waiting && !stale) return Promise.resolve(false);

    this.invoice = {
      ...invoice,
      extractionStatus: 'PROCESSING',
      failureReason: null,
      updatedAt: new Date(),
    };
    return Promise.resolve(true);
  }
}
