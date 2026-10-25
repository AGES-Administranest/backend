import { Prisma, ServiceInvoice } from '@prisma/client';

import { UniqueConstraintError } from '../../../../src/infra/prisma/prisma-errors';
import { ClientEntity, ClientService } from '../../../../src/modules/client';
import { DuplicateCriteria } from '../../../../src/modules/service-invoices/domain/find-duplicates';
import { ServiceInvoiceReviewService } from '../../../../src/modules/service-invoices/service-invoice-review.service';
import {
  DuplicateNote,
  ServiceInvoicesRepository,
} from '../../../../src/modules/service-invoices/service-invoices.repository';

export { FakeStorage } from '../../stock-entry/testing/fakes';

export const USER_ID = '0b9f6c1e-7d2a-4f3b-8c5d-1a2b3c4d5e6f';
export const INVOICE_ID = '5f3b7d0c-2a1e-4c7b-9a11-1f2e3d4c5b6a';

/** A draft as the upload url leaves it, before any reading. */
export function draftNote(
  fields: Partial<ServiceInvoice> = {},
): ServiceInvoice {
  return {
    id: INVOICE_ID,
    userId: USER_ID,
    clientId: null,
    number: null,
    issueDate: null,
    amount: null,
    description: null,
    takerTaxId: null,
    status: 'DRAFT',
    extractionStatus: 'PENDING',
    failureReason: null,
    fileUrl: null,
    fileName: 'nfse-1287.pdf',
    fileMimeType: 'application/pdf',
    fileBytesSize: 184320,
    fileHash: 'a'.repeat(64),
    rawExtraction: null,
    uploadRequestedAt: new Date(),
    uploadedAt: null,
    reviewedAt: null,
    createdAt: new Date('2026-10-20T12:00:00Z'),
    updatedAt: new Date('2026-10-20T12:00:00Z'),
    deletedAt: null,
    ...fields,
  };
}

/** One note, stored as the repository would leave it. */
export class FakeServiceInvoicesRepository {
  invoice: ServiceInvoice | null = null;
  /** Other notes of the user, by the hash of the file they hold. */
  readonly invoiceIdsByHash = new Map<string, string>();
  /** The confirmed note `findDuplicate` answers with, whatever is asked. */
  duplicate: DuplicateNote | null = null;
  readonly duplicateQueries: DuplicateCriteria[] = [];

  findByIdAndUser(id: string, userId: string) {
    const { invoice } = this;
    return Promise.resolve(
      invoice && invoice.id === id && invoice.userId === userId
        ? invoice
        : null,
    );
  }

  findIdByFileHash(_userId: string, fileHash: string) {
    return Promise.resolve(this.invoiceIdsByHash.get(fileHash));
  }

  findDuplicate(
    _userId: string,
    _excludeId: string,
    criteria: DuplicateCriteria,
  ) {
    this.duplicateQueries.push(criteria);
    return Promise.resolve(this.duplicate);
  }

  /** Same condition as the real repository's `where`. */
  async updateDraft(
    id: string,
    userId: string,
    data: Prisma.ServiceInvoiceUncheckedUpdateManyInput,
  ) {
    const invoice = await this.findByIdAndUser(id, userId);
    if (invoice?.status !== 'DRAFT') return false;
    await this.update(id, data);
    return true;
  }

  create(data: Prisma.ServiceInvoiceUncheckedCreateInput) {
    if (data.fileHash && this.invoiceIdsByHash.has(data.fileHash)) {
      return Promise.reject(
        new UniqueConstraintError(['service_invoice_user_id_file_hash_key']),
      );
    }
    this.invoice = draftNote(data as Partial<ServiceInvoice>);
    return Promise.resolve(this.invoice);
  }

  update(
    _id: string,
    data:
      | Prisma.ServiceInvoiceUncheckedUpdateInput
      | Prisma.ServiceInvoiceUncheckedUpdateManyInput,
  ) {
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
    } as ServiceInvoice;
    return Promise.resolve(this.invoice);
  }

  /** Same rule as the conditional update in the real repository. */
  claimExtraction(id: string, staleBefore: Date) {
    const { invoice } = this;
    if (!invoice || invoice.id !== id || invoice.status !== 'DRAFT') {
      return Promise.resolve(false);
    }
    const waiting =
      invoice.extractionStatus === 'PENDING' ||
      invoice.extractionStatus === 'FAILED';
    const stale =
      invoice.extractionStatus === 'PROCESSING' &&
      invoice.updatedAt < staleBefore;
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

/** The user's clients, as `ClientService` would find them. */
export class FakeClients {
  byTaxId: ClientEntity | null = null;
  byName: ClientEntity[] = [];
  readonly findOne = jest.fn((id: string) => Promise.resolve({ id }));
  readonly findByTaxId = jest.fn(() => Promise.resolve(this.byTaxId));
  readonly suggestByName = jest.fn(() => Promise.resolve(this.byName));

  get service(): ClientService {
    return this as unknown as ClientService;
  }
}

export function client(fields: Partial<ClientEntity> = {}): ClientEntity {
  return {
    id: '7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
    type: 'CLINIC',
    name: 'Clínica Veterinária Exemplo',
    taxId: '12345678000195',
    taxIdType: 'CNPJ',
    contactName: null,
    email: null,
    phone: null,
    addressLine: null,
    city: null,
    state: null,
    serviceDays: [],
    paymentTermsDays: null,
    preferredPaymentMethod: null,
    active: true,
    createdAt: new Date('2026-10-01T12:00:00Z'),
    updatedAt: new Date('2026-10-01T12:00:00Z'),
    ...fields,
  };
}

export function reviewService(
  repository: FakeServiceInvoicesRepository,
  clients: FakeClients,
): ServiceInvoiceReviewService {
  return new ServiceInvoiceReviewService(
    repository as unknown as ServiceInvoicesRepository,
    clients.service,
  );
}
