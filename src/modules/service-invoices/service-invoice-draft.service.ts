import { Injectable } from '@nestjs/common';

import { ServiceInvoiceDownloadUrlDto } from './dto/download-url-response.dto';
import { QueryServiceInvoiceDto } from './dto/query-service-invoice.dto';
import { ServiceInvoiceDetailDto } from './dto/service-invoice-detail.dto';
import { ServiceInvoiceSummaryDto } from './dto/service-invoice-summary.dto';
import { UpdateServiceInvoiceDto } from './dto/update-service-invoice.dto';
import { ServiceInvoiceReviewService } from './service-invoice-review.service';
import { toDetail, toReviewChanges, toSummary } from './service-invoice.mapper';
import {
  serviceInvoiceNotEditable,
  serviceInvoiceNotFound,
  uploadNotFinished,
} from './service-invoices.errors';
import { ServiceInvoicesRepository } from './service-invoices.repository';
import { documentKey, DocumentUploads } from '../../infra/storage';
import { fromIsoDate } from '../../shared/dates/iso-date';
import { DomainError } from '../../shared/errors/domain-error';
import { ClientService } from '../client';

/** The review of a note: listing, reading it back, saving and discarding it. */
@Injectable()
export class ServiceInvoiceDraftService {
  constructor(
    private readonly repository: ServiceInvoicesRepository,
    private readonly documentUploads: DocumentUploads,
    private readonly clientService: ClientService,
    private readonly reviewService: ServiceInvoiceReviewService,
  ) {}

  async list(
    userId: string,
    query: QueryServiceInvoiceDto,
  ): Promise<ServiceInvoiceSummaryDto[]> {
    const invoices = await this.repository.findPage(
      userId,
      {
        status: query.status,
        ...(query.from && { issuedFrom: fromIsoDate(query.from) }),
        ...(query.to && { issuedTo: fromIsoDate(query.to) }),
      },
      (query.page - 1) * query.limit,
      query.limit,
    );
    return invoices.map(toSummary);
  }

  async get(userId: string, id: string): Promise<ServiceInvoiceDetailDto> {
    const invoice = await this.findOrFail(userId, id);
    return toDetail(
      invoice,
      await this.reviewService.reviewOf(userId, invoice),
    );
  }

  /** A confirmed note is edited along with its income entry (subtask 5). */
  async update(
    userId: string,
    id: string,
    dto: UpdateServiceInvoiceDto,
  ): Promise<void> {
    // Someone else's client answers 404, as a missing one (ADR-11).
    if (dto.clientId) await this.clientService.findOne(dto.clientId, userId);

    const saved = await this.repository.updateDraft(
      id,
      userId,
      toReviewChanges(dto),
    );
    if (!saved) throw await this.refusal(userId, id);
  }

  /**
   * A discarded draft stays on record as CANCELLED, with its document. Its
   * hash is released so the same file can start a new note.
   */
  async discard(userId: string, id: string): Promise<void> {
    const discarded = await this.repository.updateDraft(id, userId, {
      status: 'CANCELLED',
      fileHash: null,
    });
    if (!discarded) throw await this.refusal(userId, id);
  }

  async downloadUrl(
    userId: string,
    id: string,
  ): Promise<ServiceInvoiceDownloadUrlDto> {
    const invoice = await this.findOrFail(userId, id);
    if (!invoice.uploadedAt) throw uploadNotFinished(id);

    return this.documentUploads.createDownloadUrl(
      documentKey(userId, 'service-invoices', id),
      invoice.fileName ?? undefined,
    );
  }

  private async findOrFail(userId: string, id: string) {
    const invoice = await this.repository.findByIdAndUser(id, userId);
    if (!invoice) throw serviceInvoiceNotFound(id);
    return invoice;
  }

  /**
   * The writes above carry their own condition — still this user's draft —
   * rather than checking first and writing after. When one matched nothing,
   * this says why.
   */
  private async refusal(userId: string, id: string): Promise<DomainError> {
    const invoice = await this.repository.findByIdAndUser(id, userId);
    return invoice
      ? serviceInvoiceNotEditable(invoice)
      : serviceInvoiceNotFound(id);
  }
}
