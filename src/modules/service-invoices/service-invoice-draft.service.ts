import { Injectable } from '@nestjs/common';

import { downloadFileNameOf } from './domain/download-file-name';
import { parseSearch } from './domain/search';
import {
  ServiceInvoiceDownloadDto,
  ServiceInvoiceDownloadUrlDto,
} from './dto/download-url-response.dto';
import { QueryServiceInvoiceDto } from './dto/query-service-invoice.dto';
import { ServiceInvoiceDetailDto } from './dto/service-invoice-detail.dto';
import { ServiceInvoicePageDto } from './dto/service-invoice-summary.dto';
import { UpdateServiceInvoiceDto } from './dto/update-service-invoice.dto';
import { ServiceInvoiceConfirmationService } from './service-invoice-confirmation.service';
import { ServiceInvoiceReviewService } from './service-invoice-review.service';
import { toDetail, toReviewChanges, toSummary } from './service-invoice.mapper';
import {
  fileNotFound,
  notConfirmed,
  refusalOf,
  serviceInvoiceNotFound,
  uploadNotFinished,
} from './service-invoices.errors';
import { ServiceInvoicesRepository } from './service-invoices.repository';
import { documentKey, DocumentUploads } from '../../infra/storage';
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
    private readonly confirmationService: ServiceInvoiceConfirmationService,
  ) {}

  async list(
    userId: string,
    query: QueryServiceInvoiceDto,
  ): Promise<ServiceInvoicePageDto> {
    const { notes, total } = await this.repository.findConfirmedPage(
      userId,
      parseSearch(query.search),
      (query.page - 1) * query.pageSize,
      query.pageSize,
    );
    return { items: notes.map(toSummary), total };
  }

  async get(userId: string, id: string): Promise<ServiceInvoiceDetailDto> {
    const invoice = await this.findOrFail(userId, id);
    const [review, client] = await Promise.all([
      this.reviewService.reviewOf(userId, invoice),
      invoice.status === 'CONFIRMED' && invoice.clientId
        ? this.repository.findClientSummary(invoice.clientId, userId)
        : null,
    ]);
    return toDetail(invoice, review, client);
  }

  /** A confirmed note is edited along with its income entry. */
  async update(
    userId: string,
    id: string,
    dto: UpdateServiceInvoiceDto,
  ): Promise<ServiceInvoiceDetailDto> {
    const invoice = await this.findOrFail(userId, id);
    if (invoice.status === 'CONFIRMED') {
      await this.confirmationService.update(userId, id, dto);
      return this.get(userId, id);
    }

    // Someone else's client answers 404, as a missing one (ADR-11).
    if (dto.clientId) await this.clientService.findOne(dto.clientId, userId);

    const saved = await this.repository.updateDraft(
      id,
      userId,
      toReviewChanges(dto),
    );
    if (!saved) throw await this.refusal(userId, id);
    return this.get(userId, id);
  }

  /**
   * A discarded draft stays on record as CANCELLED, with its document. Its
   * hash is released so the same file can start a new note. A confirmed note
   * is deleted along with its income entry.
   */
  async discard(userId: string, id: string): Promise<void> {
    const invoice = await this.findOrFail(userId, id);
    if (invoice.status === 'CONFIRMED') {
      return this.confirmationService.remove(userId, id);
    }

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
      { fileName: invoice.fileName ?? undefined },
    );
  }

  /**
   * The PDF of a confirmed note. A note that is missing, another account's or
   * without a file answers the same 404, so the code tells nothing about it.
   */
  async downloadFile(
    userId: string,
    id: string,
  ): Promise<ServiceInvoiceDownloadDto> {
    const invoice = await this.repository.findByIdAndUser(id, userId);
    if (!invoice) throw fileNotFound(id);
    if (invoice.status !== 'CONFIRMED') throw notConfirmed(invoice);
    if (!invoice.uploadedAt) throw fileNotFound(id);

    const filename = downloadFileNameOf(invoice.fileName);
    const { url, expiresAt } = await this.documentUploads.createDownloadUrl(
      documentKey(userId, 'service-invoices', id),
      { fileName: filename, contentType: 'application/pdf' },
    );
    return { url, filename, expiresAt: new Date(expiresAt).toISOString() };
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
    return refusalOf(invoice, id);
  }
}
