import { Prisma, ServiceInvoice } from '@prisma/client';

import { DuplicateReason } from './domain/find-duplicates';
import {
  ClientOptionDto,
  DuplicateServiceInvoiceDto,
  NfseReviewDto,
} from './dto/nfse-review.dto';
import { ServiceInvoiceDetailDto } from './dto/service-invoice-detail.dto';
import { ServiceInvoiceSummaryDto } from './dto/service-invoice-summary.dto';
import { UpdateServiceInvoiceDto } from './dto/update-service-invoice.dto';
import { DuplicateNote } from './service-invoices.repository';
import { fromIsoDate, toIsoDate } from '../../shared/dates/iso-date';
import { ClientEntity } from '../client';
import { NfseResult } from '../extraction';

/** The reading as it came out, kept in `raw_extraction`. */
export function storedReadingOf(invoice: ServiceInvoice): NfseResult | null {
  return invoice.rawExtraction as NfseResult | null;
}

/**
 * The columns hold the note as the user left it; the reading only adds what
 * has no column, the taker's name and the page cap.
 */
export function toReview(invoice: ServiceInvoice): NfseReviewDto {
  const reading = storedReadingOf(invoice);
  const taker = {
    ...(reading?.taker?.name && { name: reading.taker.name }),
    ...(invoice.takerTaxId && { taxId: invoice.takerTaxId }),
  };

  return {
    status: invoice.extractionStatus,
    ...(invoice.failureReason && { failureReason: invoice.failureReason }),
    ...(invoice.issueDate && { issueDate: toIsoDate(invoice.issueDate) }),
    ...(invoice.amount !== null && { amount: Number(invoice.amount) }),
    ...(invoice.number && { number: invoice.number }),
    ...(Object.keys(taker).length > 0 && { taker }),
    ...(invoice.clientId && { clientId: invoice.clientId }),
    ...(reading?.partial && { partial: reading.partial }),
  };
}

export function toSummary(invoice: ServiceInvoice): ServiceInvoiceSummaryDto {
  const takerName = storedReadingOf(invoice)?.taker?.name;

  return {
    id: invoice.id,
    status: invoice.status,
    ...(invoice.fileName && { fileName: invoice.fileName }),
    ...(invoice.number && { number: invoice.number }),
    ...(invoice.issueDate && { issueDate: toIsoDate(invoice.issueDate) }),
    ...(invoice.amount !== null && { amount: Number(invoice.amount) }),
    ...(takerName && { takerName }),
    ...(invoice.clientId && { clientId: invoice.clientId }),
    extractionStatus: invoice.extractionStatus,
    ...(invoice.failureReason && { failureReason: invoice.failureReason }),
    ...(invoice.uploadedAt && { uploadedAt: invoice.uploadedAt.toISOString() }),
    createdAt: invoice.createdAt.toISOString(),
  };
}

export function toClientOption(client: ClientEntity): ClientOptionDto {
  return {
    id: client.id,
    name: client.name,
    ...(client.taxId && { taxId: client.taxId }),
  };
}

export function toDuplicate(
  duplicate: DuplicateNote,
  reason: DuplicateReason,
): DuplicateServiceInvoiceDto {
  return {
    id: duplicate.id,
    ...(duplicate.number && { number: duplicate.number }),
    ...(duplicate.issueDate && { issueDate: toIsoDate(duplicate.issueDate) }),
    ...(duplicate.amount !== null && { amount: Number(duplicate.amount) }),
    ...(duplicate.client && { clientName: duplicate.client.name }),
    reason,
  };
}

export function toDetail(
  invoice: ServiceInvoice,
  review: NfseReviewDto,
): ServiceInvoiceDetailDto {
  return {
    id: invoice.id,
    status: invoice.status,
    ...(invoice.fileName && { fileName: invoice.fileName }),
    review,
    ...(invoice.uploadedAt && { uploadedAt: invoice.uploadedAt.toISOString() }),
    ...(invoice.reviewedAt && { reviewedAt: invoice.reviewedAt.toISOString() }),
  };
}

/** Only the fields sent are written; `null` clears one. */
export function toReviewChanges(
  dto: UpdateServiceInvoiceDto,
): Prisma.ServiceInvoiceUncheckedUpdateManyInput {
  return {
    ...(dto.issueDate !== undefined && {
      issueDate: dto.issueDate === null ? null : fromIsoDate(dto.issueDate),
    }),
    ...(dto.amount !== undefined && { amount: dto.amount }),
    ...(dto.number !== undefined && { number: dto.number }),
    ...(dto.clientId !== undefined && { clientId: dto.clientId }),
    reviewedAt: new Date(),
  };
}
