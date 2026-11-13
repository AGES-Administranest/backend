import { Prisma, ServiceInvoice } from '@prisma/client';

import { ClientEntity } from '../client';
import { NfseResult } from '../extraction';
import { DuplicateReason } from './domain/find-duplicates';
import { normalizeLocation } from './domain/location';
import {
  ClientOptionDto,
  DuplicateServiceInvoiceDto,
  NfseReviewDto,
} from './dto/nfse-review.dto';
import {
  ServiceInvoiceDataDto,
  ServiceInvoiceDetailDto,
} from './dto/service-invoice-detail.dto';
import { ServiceInvoiceReportItemDto } from './dto/service-invoice-report-item.dto';
import { ServiceInvoiceSummaryDto } from './dto/service-invoice-summary.dto';
import { UpdateServiceInvoiceDto } from './dto/update-service-invoice.dto';
import {
  ClientSummary,
  DuplicateNote,
  ListedNote,
  ReportNote,
} from './service-invoices.repository';
import { fromIsoDate, toIsoDate } from '../../shared/dates/iso-date';

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

/**
 * A confirmed note always has a date, an amount and a client (confirming
 * demands them), so the list can promise them. The file counts as kept once
 * its upload was verified; the list does not ask the bucket for every row.
 */
export function toSummary(note: ListedNote): ServiceInvoiceSummaryDto {
  const ready = note as ReadyListedNote;
  return {
    id: ready.id,
    number: ready.number,
    issueDate: toIsoDate(ready.issueDate),
    amount: Number(ready.amount),
    client: { id: ready.client.id, name: ready.client.name },
    location: ready.location,
    hasFile: ready.uploadedAt !== null,
  };
}

type ReadyListedNote = ListedNote & {
  issueDate: Date;
  amount: Prisma.Decimal;
  client: { id: string; name: string };
};

/** What a confirmed note is, with the values as they stand. */
export function toInvoiceData(
  invoice: ServiceInvoice,
  client: ClientSummary,
): ServiceInvoiceDataDto {
  const hasFile = invoice.uploadedAt !== null;
  return {
    id: invoice.id,
    number: invoice.number,
    issueDate: toIsoDate(invoice.issueDate as Date),
    amount: Number(invoice.amount),
    client: { id: client.id, name: client.name, taxId: client.taxId },
    location: invoice.location,
    hasFile,
    file:
      hasFile && invoice.fileName
        ? { name: invoice.fileName, bytesSize: invoice.fileBytesSize ?? 0 }
        : null,
  };
}

/** A confirmed note always has its issue date and client; the type does not. */
export function toReportItem(note: ReportNote): ServiceInvoiceReportItemDto {
  return {
    id: note.id,
    issueDate: toIsoDate(note.issueDate!),
    takerName: note.client!.name,
    hasFile: note.fileUrl !== null,
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
  client?: ClientSummary | null,
): ServiceInvoiceDetailDto {
  return {
    id: invoice.id,
    status: invoice.status,
    ...(invoice.fileName && { fileName: invoice.fileName }),
    review,
    ...(invoice.uploadedAt && { uploadedAt: invoice.uploadedAt.toISOString() }),
    ...(invoice.reviewedAt && { reviewedAt: invoice.reviewedAt.toISOString() }),
    ...(invoice.status === 'CONFIRMED' &&
      client && { invoice: toInvoiceData(invoice, client) }),
  };
}

/**
 * Only the fields sent are written; `null` clears one. The number is read from
 * the PDF and printed on it: once the note is confirmed it is not edited.
 */
export function toReviewChanges(
  dto: UpdateServiceInvoiceDto,
  { confirmed = false }: { confirmed?: boolean } = {},
): Prisma.ServiceInvoiceUncheckedUpdateManyInput {
  return {
    ...(dto.issueDate !== undefined && {
      issueDate: dto.issueDate === null ? null : fromIsoDate(dto.issueDate),
    }),
    ...(dto.amount !== undefined && { amount: dto.amount }),
    ...(dto.number !== undefined && !confirmed && { number: dto.number }),
    ...(dto.clientId !== undefined && { clientId: dto.clientId }),
    ...(dto.location !== undefined && {
      location: dto.location === null ? null : normalizeLocation(dto.location),
    }),
    reviewedAt: new Date(),
  };
}
