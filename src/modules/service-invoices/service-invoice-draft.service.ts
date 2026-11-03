import { Injectable } from '@nestjs/common';

import { ServiceInvoiceDownloadUrlDto } from './dto/download-url-response.dto';
import { QueryServiceInvoiceReportDto } from './dto/query-service-invoice-report.dto';
import { QueryServiceInvoiceDto } from './dto/query-service-invoice.dto';
import { ServiceInvoiceDetailDto } from './dto/service-invoice-detail.dto';
import { ServiceInvoiceReportItemDto } from './dto/service-invoice-report-item.dto';
import { ServiceInvoiceSummaryDto } from './dto/service-invoice-summary.dto';
import { UpdateServiceInvoiceDto } from './dto/update-service-invoice.dto';
import { ServiceInvoiceConfirmationService } from './service-invoice-confirmation.service';
import { ServiceInvoiceReviewService } from './service-invoice-review.service';
import {
  toDetail,
  toReportItem,
  toReviewChanges,
  toSummary,
} from './service-invoice.mapper';
import {
  refusalOf,
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
    private readonly confirmationService: ServiceInvoiceConfirmationService,
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

  /** The confirmed notes for the Reports tab, newest issue date first. */
  async listForReports(
    userId: string,
    query: QueryServiceInvoiceReportDto,
  ): Promise<ServiceInvoiceReportItemDto[]> {
    if (query.startDate && query.endDate && query.startDate > query.endDate) {
      throw new DomainError(
        'INVALID_INPUT',
        'INVALID_REQUEST',
        'startDate must not be after endDate',
        { startDate: query.startDate, endDate: query.endDate },
      );
    }

    const notes = await this.repository.findConfirmedForReport(
      userId,
      {
        ...(query.search && { search: query.search }),
        ...(query.startDate && { issuedFrom: fromIsoDate(query.startDate) }),
        ...(query.endDate && { issuedTo: fromIsoDate(query.endDate) }),
      },
      (query.page - 1) * query.limit,
      query.limit,
    );
    return notes.map(toReportItem);
  }

  async get(userId: string, id: string): Promise<ServiceInvoiceDetailDto> {
    const invoice = await this.findOrFail(userId, id);
    return toDetail(
      invoice,
      await this.reviewService.reviewOf(userId, invoice),
    );
  }

  /** A confirmed note is edited along with its income entry. */
  async update(
    userId: string,
    id: string,
    dto: UpdateServiceInvoiceDto,
  ): Promise<void> {
    const invoice = await this.findOrFail(userId, id);
    if (invoice.status === 'CONFIRMED') {
      return this.confirmationService.update(userId, id, dto);
    }

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
    return refusalOf(invoice, id);
  }
}
