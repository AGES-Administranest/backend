import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ServiceInvoice } from '@prisma/client';

import {
  dueDateOf,
  missingForConfirmation,
  ReadyNote,
  RequiredField,
} from './domain/confirmation';
import { locationOf } from './domain/location';
import { ConfirmServiceInvoiceDto } from './dto/confirm-service-invoice.dto';
import { ServiceInvoiceConfirmationDto } from './dto/confirmation-response.dto';
import { UpdateServiceInvoiceDto } from './dto/update-service-invoice.dto';
import { ServiceInvoiceReviewService } from './service-invoice-review.service';
import { toReviewChanges } from './service-invoice.mapper';
import {
  possibleDuplicate,
  refusalOf,
  serviceInvoiceNotEditable,
  serviceInvoiceNotFound,
  serviceInvoiceNotReady,
} from './service-invoices.errors';
import { ServiceInvoicesRepository } from './service-invoices.repository';
import { documentKey, DocumentUploads } from '../../infra/storage';
import { ClientService } from '../client';
import { FinancialEntryService, ServiceInvoiceIncome } from '../financial';

/**
 * A confirmed note and its income entry (US03) move together: confirming
 * records the entry, editing adjusts it, deleting removes it, each in the
 * note's own transaction.
 */
@Injectable()
export class ServiceInvoiceConfirmationService {
  private readonly logger = new Logger(ServiceInvoiceConfirmationService.name);

  constructor(
    private readonly repository: ServiceInvoicesRepository,
    private readonly reviewService: ServiceInvoiceReviewService,
    private readonly clientService: ClientService,
    private readonly financialEntries: FinancialEntryService,
    private readonly documentUploads: DocumentUploads,
  ) {}

  async confirm(
    userId: string,
    id: string,
    dto: ConfirmServiceInvoiceDto,
  ): Promise<ServiceInvoiceConfirmationDto> {
    const draft = await this.findDraft(userId, id);
    ensureReady(draft);
    if (!dto.allowDuplicate) {
      await this.ensureNotDuplicated(userId, draft);
    }

    const taker = await this.clientService.findOne(draft.clientId, userId);

    const financialEntryId = await this.repository.confirmDraft(
      id,
      userId,
      // Typed by the user, the location stays; otherwise it is the taker's.
      { location: draft.location?.trim() || locationOf(taker) },
      (tx, confirmed) => this.recordIncome(userId, confirmed, tx),
    );
    if (financialEntryId === null) throw await this.refusal(userId, id);

    return { id, financialEntryId };
  }

  async update(
    userId: string,
    id: string,
    dto: UpdateServiceInvoiceDto,
  ): Promise<void> {
    const missing = missingInCorrection(dto);
    if (missing.length > 0) throw serviceInvoiceNotReady(id, missing);

    const saved = await this.repository.updateConfirmed(
      id,
      userId,
      toReviewChanges(dto, { confirmed: true }),
      (tx, edited) => this.adjustIncome(userId, edited, tx),
    );
    if (!saved) throw await this.refusal(userId, id);
  }

  /**
   * The note and its entry go in one transaction; the PDF goes after it. A
   * bucket cannot join the transaction, and the other order would leave a
   * note without its file if the commit failed. A PDF that survives a failed
   * delete is an orphan nobody can reach: the note it belonged to is gone and
   * the key is derived from the note id.
   */
  async remove(userId: string, id: string): Promise<void> {
    const removed = await this.repository.deleteConfirmed(id, userId, tx =>
      this.financialEntries.removeServiceInvoiceEntry(userId, id, tx),
    );
    if (!removed) throw await this.refusal(userId, id);

    try {
      await this.documentUploads.deleteDocument(
        documentKey(userId, 'service-invoices', id),
      );
    } catch (error) {
      this.logger.error(
        `Service invoice ${id} was deleted but its PDF was not`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private async findDraft(userId: string, id: string): Promise<ServiceInvoice> {
    const invoice = await this.repository.findByIdAndUser(id, userId);
    if (!invoice) throw serviceInvoiceNotFound(id);
    if (invoice.status !== 'DRAFT') throw serviceInvoiceNotEditable(invoice);
    return invoice;
  }

  private async ensureNotDuplicated(
    userId: string,
    draft: ServiceInvoice,
  ): Promise<void> {
    const duplicate = await this.reviewService.findDuplicate(userId, draft);
    if (duplicate) throw possibleDuplicate(duplicate);
  }

  private async recordIncome(
    userId: string,
    note: ServiceInvoice,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const income = await this.incomeOf(userId, note);
    return this.financialEntries.recordServiceInvoice(income, tx);
  }

  /**
   * Runs on the note as edited: an edit that clears a required field or
   * points to someone else's client throws here and is rolled back.
   */
  private async adjustIncome(
    userId: string,
    note: ServiceInvoice,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const income = await this.incomeOf(userId, note);
    await this.financialEntries.adjustServiceInvoiceEntry(income, tx);
  }

  /** What the note dictates to its income entry. */
  private async incomeOf(
    userId: string,
    note: ServiceInvoice,
  ): Promise<ServiceInvoiceIncome> {
    ensureReady(note);
    const client = await this.clientService.findOne(note.clientId, userId);

    return {
      userId,
      serviceInvoiceId: note.id,
      number: note.number,
      amount: note.amount,
      issueDate: note.issueDate,
      dueDate: dueDateOf(note.issueDate, client.paymentTermsDays),
    };
  }

  private async refusal(userId: string, id: string) {
    const invoice = await this.repository.findByIdAndUser(id, userId);
    return refusalOf(invoice, id);
  }
}

/** The correction sends the three fields every time; none may be cleared. */
function missingInCorrection(dto: UpdateServiceInvoiceDto): RequiredField[] {
  const missing: RequiredField[] = [];
  if (!dto.issueDate) missing.push('issueDate');
  if (dto.amount === undefined || dto.amount === null) missing.push('amount');
  if (!dto.clientId) missing.push('clientId');
  return missing;
}

function ensureReady(
  note: ServiceInvoice,
): asserts note is ReadyNote<ServiceInvoice> {
  const missing = missingForConfirmation(note);
  if (missing.length > 0) throw serviceInvoiceNotReady(note.id, missing);
}
