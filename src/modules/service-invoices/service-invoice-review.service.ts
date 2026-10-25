import { Injectable } from '@nestjs/common';
import { ServiceInvoice } from '@prisma/client';

import { duplicateCriteria, duplicateReason } from './domain/find-duplicates';
import { matchTaker, TakerMatch } from './domain/match-client';
import {
  ClientOptionDto,
  DuplicateServiceInvoiceDto,
  NfseReviewDto,
} from './dto/nfse-review.dto';
import {
  storedReadingOf,
  toClientOption,
  toDuplicate,
  toReview,
} from './service-invoice.mapper';
import { ServiceInvoicesRepository } from './service-invoices.repository';
import { ClientService } from '../client';

/**
 * The review with what the note alone does not say: which client is the
 * taker, and whether the note was already registered. Worked out on every
 * read, so a client registered meanwhile shows up the next time.
 */
@Injectable()
export class ServiceInvoiceReviewService {
  constructor(
    private readonly repository: ServiceInvoicesRepository,
    private readonly clientService: ClientService,
  ) {}

  async reviewOf(
    userId: string,
    invoice: ServiceInvoice,
  ): Promise<NfseReviewDto> {
    const [taker, duplicateOf] = await Promise.all([
      this.takerOf(userId, invoice),
      this.duplicateOf(userId, invoice),
    ]);
    return {
      ...toReview(invoice),
      ...taker,
      ...(duplicateOf && { duplicateOf }),
    };
  }

  private async takerOf(
    userId: string,
    invoice: ServiceInvoice,
  ): Promise<TakerMatch<ClientOptionDto>> {
    if (invoice.clientId) return {};

    const { clientMatch, clientSuggestions } = await matchTaker(
      {
        name: storedReadingOf(invoice)?.taker?.name,
        taxId: invoice.takerTaxId ?? undefined,
      },
      {
        byTaxId: taxId => this.clientService.findByTaxId(userId, taxId),
        byName: name => this.clientService.suggestByName(userId, name),
      },
    );
    return {
      ...(clientMatch && { clientMatch: toClientOption(clientMatch) }),
      ...(clientSuggestions && {
        clientSuggestions: clientSuggestions.map(toClientOption),
      }),
    };
  }

  private async duplicateOf(
    userId: string,
    invoice: ServiceInvoice,
  ): Promise<DuplicateServiceInvoiceDto | null> {
    const criteria = duplicateCriteria(invoice);
    if (!criteria) return null;

    const duplicate = await this.repository.findDuplicate(
      userId,
      invoice.id,
      criteria,
    );
    return (
      duplicate && toDuplicate(duplicate, duplicateReason(invoice, duplicate))
    );
  }
}
