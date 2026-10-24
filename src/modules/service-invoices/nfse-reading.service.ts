import { Injectable } from '@nestjs/common';
import {
  ExtractionFailureReason as FailureReasonColumn,
  Prisma,
  ServiceInvoice,
} from '@prisma/client';

import { ServiceInvoicesRepository } from './service-invoices.repository';
import { documentKey, DocumentStorage } from '../../infra/storage';
import { fromIsoDate } from '../../shared/dates/iso-date';
import {
  ExtractionService,
  NFSE_SETTINGS,
  NfseFailureReason,
  NfseResult,
  runClaimedReading,
} from '../extraction';
import { UsersService } from '../users';

const FAILURE_REASONS: Record<NfseFailureReason, FailureReasonColumn> = {
  unreadable: 'UNREADABLE',
  timeout: 'TIMEOUT',
  unsupported_format: 'UNSUPPORTED_FORMAT',
  no_text_layer: 'NO_TEXT_LAYER',
  no_fields_found: 'NO_FIELDS_FOUND',
};

/**
 * Reads the uploaded NFSe inside the upload confirmation, as the purchase
 * invoice does: reading the text layer takes well under a second.
 */
@Injectable()
export class NfseReadingService {
  constructor(
    private readonly repository: ServiceInvoicesRepository,
    private readonly documentStorage: DocumentStorage,
    private readonly extractionService: ExtractionService,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Reads the document if the note is waiting for it, and answers the note as
   * it stands. A finished reading, or one another request is running, comes
   * back as it is.
   */
  run(invoice: ServiceInvoice): Promise<ServiceInvoice> {
    const { repository } = this;

    return runClaimedReading(NFSE_SETTINGS.timeoutMs, {
      claim: staleBefore => repository.claimExtraction(invoice.id, staleBefore),
      current: async () =>
        (await repository.findByIdAndUser(invoice.id, invoice.userId)) ??
        invoice,
      read: async () => repository.update(invoice.id, await this.read(invoice)),
      release: async () => {
        await repository.update(invoice.id, { extractionStatus: 'PENDING' });
      },
    });
  }

  private async read(
    invoice: ServiceInvoice,
  ): Promise<Prisma.ServiceInvoiceUncheckedUpdateInput> {
    const key = documentKey(invoice.userId, 'service-invoices', invoice.id);
    // The upload was verified a moment ago; its absence now is not a user error.
    const buffer = await this.documentStorage.getDocument(key);
    if (!buffer) throw new Error(`No document at ${key}`);

    const provider = await this.usersService.findOne(invoice.userId);
    const result = await this.extractionService.extract('nfse', {
      buffer,
      mimeType: invoice.fileMimeType ?? '',
      ...(provider.taxId && { providerTaxId: provider.taxId }),
    });

    return readingColumns(result);
  }
}

/**
 * A failed reading still fills what it found: it prefills the manual review.
 * What the document leaves out keeps its value.
 */
function readingColumns(
  result: NfseResult,
): Prisma.ServiceInvoiceUncheckedUpdateInput {
  return {
    extractionStatus: result.status === 'success' ? 'SUCCESS' : 'FAILED',
    failureReason:
      result.status === 'failed'
        ? FAILURE_REASONS[result.failureReason ?? 'unreadable']
        : null,
    rawExtraction: result,
    ...(result.issueDate && { issueDate: fromIsoDate(result.issueDate) }),
    ...(result.grossAmount !== undefined && { amount: result.grossAmount }),
    ...(result.number && { number: result.number }),
    ...(result.taker?.taxId && { takerTaxId: result.taker.taxId }),
  };
}
