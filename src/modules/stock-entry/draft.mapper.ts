import { Prisma } from '@prisma/client';

import { DraftDetailDto, DraftLineDto } from './dto/draft-detail.dto';
import { DraftSummaryDto } from './dto/draft-summary.dto';
import { ExtractionResponseDto } from './dto/extraction-response.dto';
import { DraftLineInputDto } from './dto/replace-draft-lines.dto';
import { UpdateDraftHeaderDto } from './dto/update-draft-header.dto';
import { storedExtractionOf } from './extraction.service';
import { fromIsoDate, toIsoDate } from './iso-date';
import {
  DraftLineRow,
  InvoiceWithLines,
  InvoiceWithSupplier,
} from './stock-entry.repository';
import { LineMatch } from '../item-match';

type SavedLine = InvoiceWithLines['lines'][number];

export function toDraftSummary(invoice: InvoiceWithSupplier): DraftSummaryDto {
  const supplierName =
    invoice.supplier?.name ??
    storedExtractionOf(invoice)?.result.supplier?.name;

  return {
    id: invoice.id,
    ...(invoice.fileName && { fileName: invoice.fileName }),
    ...(invoice.fileMimeType && { fileMimeType: invoice.fileMimeType }),
    ...(supplierName && { supplierName }),
    ...(invoice.number && { invoiceNumber: invoice.number }),
    ...(invoice.issueDate && { orderDate: toIsoDate(invoice.issueDate) }),
    ...(invoice.totalAmount !== null && {
      totalAmount: Number(invoice.totalAmount),
    }),
    extractionStatus: invoice.extractionStatus,
    ...(invoice.failureReason && { failureReason: invoice.failureReason }),
    ...(invoice.uploadedAt && { uploadedAt: invoice.uploadedAt.toISOString() }),
    updatedAt: invoice.updatedAt.toISOString(),
  };
}

export function toDraftDetail(
  invoice: InvoiceWithLines,
  extraction: ExtractionResponseDto,
): DraftDetailDto {
  const matches = storedExtractionOf(invoice)?.matches ?? [];

  return {
    id: invoice.id,
    ...(invoice.fileName && { fileName: invoice.fileName }),
    ...(invoice.fileMimeType && { fileMimeType: invoice.fileMimeType }),
    extraction,
    lines: invoice.lines.map(line => toDraftLine(line, matches)),
  };
}

function toDraftLine(line: SavedLine, matches: LineMatch[]): DraftLineDto {
  return {
    ...(line.sourceIndex !== null && { sourceIndex: line.sourceIndex }),
    description: line.description,
    ...(line.item && { item: line.item }),
    ...(line.quantity !== null && { quantity: Number(line.quantity) }),
    ...(line.unitCost !== null && { unitCost: Number(line.unitCost) }),
    ...(line.totalValue !== null && { totalValue: Number(line.totalValue) }),
    ...(line.lotNumber && { lotNumber: line.lotNumber }),
    ...(line.expirationDate && {
      expirationDate: toIsoDate(line.expirationDate),
    }),
    candidates:
      line.sourceIndex === null
        ? []
        : (matches[line.sourceIndex]?.candidates ?? []),
  };
}

/** The order they arrive in is the order the review shows them. */
export function toLineRows(lines: DraftLineInputDto[]): DraftLineRow[] {
  return lines.map((line, position) => ({
    position,
    sourceIndex: line.sourceIndex ?? null,
    description: line.description,
    itemId: line.itemId ?? null,
    quantity: line.quantity ?? null,
    unitCost: line.unitCost ?? null,
    totalValue: line.totalValue ?? null,
    lotNumber: line.lotNumber ?? null,
    expirationDate: line.expirationDate
      ? fromIsoDate(line.expirationDate)
      : null,
  }));
}

export function toHeaderChanges(
  dto: UpdateDraftHeaderDto,
): Prisma.PurchaseInvoiceUncheckedUpdateManyInput {
  return {
    ...(dto.invoiceNumber !== undefined && { number: dto.invoiceNumber }),
    ...(dto.orderDate !== undefined && {
      issueDate: dto.orderDate ? fromIsoDate(dto.orderDate) : null,
    }),
    ...(dto.totalAmount !== undefined && { totalAmount: dto.totalAmount }),
  };
}

export function linkedItemIds(lines: DraftLineInputDto[]): string[] {
  return [
    ...new Set(lines.flatMap(line => (line.itemId ? [line.itemId] : []))),
  ];
}
