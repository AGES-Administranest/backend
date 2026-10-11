import { MeasurementUnit, Prisma, PurchaseInvoice } from '@prisma/client';

import { UniqueConstraintError } from '../../../../src/infra/prisma/prisma-errors';
import { StoredDocument } from '../../../../src/infra/storage';
import {
  DraftLineRow,
  InvoiceWithLines,
  InvoiceWithSupplier,
} from '../../../../src/modules/stock-entry/stock-entry.repository';

type CatalogItem = { id: string; name: string; unit: MeasurementUnit };

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
  lines: DraftLineRow[] = [];
  /** Other invoices of the user, by the hash of the file they hold. */
  readonly invoiceIdsByHash = new Map<string, string>();
  /** What a saved line's item resolves to, as the join would. */
  readonly catalog = new Map<string, CatalogItem>();

  findDrafts(userId: string): Promise<InvoiceWithSupplier[]> {
    const { invoice } = this;
    const isDraft = invoice?.userId === userId && invoice.status === 'DRAFT';
    return Promise.resolve(isDraft ? [{ ...invoice, supplier: null }] : []);
  }

  async findWithLines(
    id: string,
    userId: string,
  ): Promise<InvoiceWithLines | null> {
    const invoice = await this.findByIdAndUser(id, userId);
    if (!invoice) return null;
    return {
      ...invoice,
      lines: this.lines.map((line, index) => this.savedLine(line, index)),
    };
  }

  findIdByFileHash(_userId: string, fileHash: string) {
    return Promise.resolve(this.invoiceIdsByHash.get(fileHash));
  }

  /** Same condition as the real repository's `where`. */
  async confirmDraft(
    id: string,
    userId: string,
    write: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    if (!(await this.isDraftOf(id, userId))) return false;
    await write({} as Prisma.TransactionClient);
    await this.update(id, { status: 'CONFIRMED', reviewedAt: new Date() });
    return true;
  }

  async updateDraft(
    id: string,
    userId: string,
    data: Prisma.PurchaseInvoiceUncheckedUpdateManyInput,
  ) {
    if (!(await this.isDraftOf(id, userId))) return false;
    await this.update(id, data);
    return true;
  }

  async replaceLines(id: string, userId: string, lines: DraftLineRow[]) {
    if (!(await this.isDraftOf(id, userId))) return false;
    this.lines = lines;
    return true;
  }

  private async isDraftOf(id: string, userId: string) {
    const invoice = await this.findByIdAndUser(id, userId);
    return invoice?.status === 'DRAFT';
  }

  private savedLine(
    line: DraftLineRow,
    index: number,
  ): InvoiceWithLines['lines'][number] {
    const decimal = (value: unknown) =>
      value === null || value === undefined
        ? null
        : new Prisma.Decimal(value as number);
    return {
      id: `line-${index}`,
      purchaseInvoiceId: this.invoice?.id ?? '',
      itemId: line.itemId ?? null,
      lotId: null,
      position: line.position,
      sourceIndex: line.sourceIndex ?? null,
      description: line.description,
      quantity: decimal(line.quantity),
      unitCost: decimal(line.unitCost),
      totalValue: decimal(line.totalValue),
      arithmeticCheck: null,
      matchConfidence: null,
      lotNumber: line.lotNumber ?? null,
      expirationDate: (line.expirationDate as Date | null) ?? null,
      item: line.itemId ? (this.catalog.get(line.itemId) ?? null) : null,
    };
  }

  findByIdAndUser(id: string, userId: string) {
    const { invoice } = this;
    return Promise.resolve(
      invoice && invoice.id === id && invoice.userId === userId
        ? invoice
        : null,
    );
  }

  create(data: Prisma.PurchaseInvoiceUncheckedCreateInput) {
    if (data.fileHash && this.invoiceIdsByHash.has(data.fileHash)) {
      return Promise.reject(
        new UniqueConstraintError(['user_id', 'file_hash']),
      );
    }
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
