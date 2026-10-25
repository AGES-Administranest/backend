import { Prisma, ServiceInvoice } from '@prisma/client';

import { UniqueConstraintError } from '../../../../src/infra/prisma/prisma-errors';
import { ClientEntity, ClientService } from '../../../../src/modules/client';
import {
  FinancialEntryService,
  ServiceInvoiceIncome,
} from '../../../../src/modules/financial';
import { DuplicateCriteria } from '../../../../src/modules/service-invoices/domain/find-duplicates';
import { ServiceInvoiceConfirmationService } from '../../../../src/modules/service-invoices/service-invoice-confirmation.service';
import { ServiceInvoiceReviewService } from '../../../../src/modules/service-invoices/service-invoice-review.service';
import {
  DuplicateNote,
  IncomeWrite,
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
        value === Prisma.DbNull ? null : readBack(field, value),
      ]),
    );
    this.invoice = {
      ...this.invoice,
      ...stored,
      updatedAt: new Date(),
    } as ServiceInvoice;
    return Promise.resolve(this.invoice);
  }

  async confirmDraft(
    id: string,
    userId: string,
    recordIncome: IncomeWrite<string>,
  ): Promise<string | null> {
    const confirmed = await this.updateInStatus(id, userId, 'DRAFT', {
      status: 'CONFIRMED',
      reviewedAt: new Date(),
    });
    if (!confirmed) return null;

    return this.rollingBackOnError(confirmed.before, () =>
      recordIncome(TX, confirmed.after),
    );
  }

  async updateConfirmed(
    id: string,
    userId: string,
    data: Prisma.ServiceInvoiceUncheckedUpdateManyInput,
    adjustIncome: IncomeWrite<void>,
  ): Promise<boolean> {
    const edited = await this.updateInStatus(id, userId, 'CONFIRMED', data);
    if (!edited) return false;

    await this.rollingBackOnError(edited.before, () =>
      adjustIncome(TX, edited.after),
    );
    return true;
  }

  async deleteConfirmed(
    id: string,
    userId: string,
    removeIncome: IncomeWrite<void>,
  ): Promise<boolean> {
    const deleted = await this.updateInStatus(id, userId, 'CONFIRMED', {
      deletedAt: new Date(),
    });
    if (!deleted) return false;

    await this.rollingBackOnError(deleted.before, () =>
      removeIncome(TX, deleted.after),
    );
    return true;
  }

  private async updateInStatus(
    id: string,
    userId: string,
    status: 'DRAFT' | 'CONFIRMED',
    data: Prisma.ServiceInvoiceUncheckedUpdateManyInput,
  ): Promise<{ before: ServiceInvoice; after: ServiceInvoice } | null> {
    const before = await this.findByIdAndUser(id, userId);
    if (before?.status !== status) return null;

    const after = await this.update(id, data);
    return { before, after };
  }

  /** As the real transaction: a write that throws leaves the note as it was. */
  private async rollingBackOnError<Result>(
    before: ServiceInvoice,
    write: () => Promise<Result>,
  ): Promise<Result> {
    try {
      return await write();
    } catch (error) {
      this.invoice = before;
      throw error;
    }
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

const TX = {} as Prisma.TransactionClient;

/** The column types Prisma reads back: the amount is a Decimal. */
function readBack(field: string, value: unknown): unknown {
  return field === 'amount' && typeof value === 'number'
    ? new Prisma.Decimal(value)
    : value;
}

/** The income entries of the notes, by note id. */
export class FakeFinancialEntries {
  readonly entries = new Map<
    string,
    ServiceInvoiceIncome & { id: string; deletedAt: Date | null }
  >();

  readonly recordServiceInvoice = jest.fn((income: ServiceInvoiceIncome) => {
    const entry = {
      ...income,
      id: `entry-${income.serviceInvoiceId}`,
      deletedAt: null,
    };
    this.entries.set(income.serviceInvoiceId, entry);
    return Promise.resolve(entry.id);
  });

  readonly adjustServiceInvoiceEntry = jest.fn(
    (income: ServiceInvoiceIncome) => {
      const entry = this.entries.get(income.serviceInvoiceId);
      if (entry)
        this.entries.set(income.serviceInvoiceId, { ...entry, ...income });
      return Promise.resolve();
    },
  );

  readonly removeServiceInvoiceEntry = jest.fn(
    (_userId: string, serviceInvoiceId: string) => {
      const entry = this.entries.get(serviceInvoiceId);
      if (entry) {
        this.entries.set(serviceInvoiceId, { ...entry, deletedAt: new Date() });
      }
      return Promise.resolve();
    },
  );

  get service(): FinancialEntryService {
    return this as unknown as FinancialEntryService;
  }
}

export function confirmationService(
  repository: FakeServiceInvoicesRepository,
  clients: FakeClients,
  financialEntries: FakeFinancialEntries,
): ServiceInvoiceConfirmationService {
  return new ServiceInvoiceConfirmationService(
    repository as unknown as ServiceInvoicesRepository,
    reviewService(repository, clients),
    clients.service,
    financialEntries.service,
  );
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
