import { Injectable } from '@nestjs/common';
import {
  ExtractionFailureReason as FailureReasonColumn,
  Prisma,
  PurchaseInvoice,
} from '@prisma/client';

import { buildDocumentKey } from './document-key';
import { ExtractionResponseDto } from './dto/extraction-response.dto';
import { fromIsoDate, toIsoDate } from './iso-date';
import { EXTRACTION_TIMEOUT_MS } from './stock-entry.constants';
import { StockEntryRepository } from './stock-entry.repository';
import { DocumentStorage } from '../../infra/storage';
import {
  ExtractionFailureReason,
  ExtractionResult,
  ExtractorStrategy,
} from '../extraction';
import { LineMatch, MatchItemService } from '../item-match';
import { SupplierService } from '../supplier';

/**
 * What the review starts from, kept in `raw_extraction`: the lines only become
 * `purchase_invoice_line` rows when the user saves them.
 */
export type StoredExtraction = {
  result: ExtractionResult;
  /** One per item, in the same order. */
  matches: LineMatch[];
};

export function storedExtractionOf(
  invoice: PurchaseInvoice,
): StoredExtraction | null {
  return invoice.rawExtraction as StoredExtraction | null;
}

const FAILURE_REASONS: Record<ExtractionFailureReason, FailureReasonColumn> = {
  unreadable: 'UNREADABLE',
  no_table_found: 'NO_TABLE_FOUND',
  timeout: 'TIMEOUT',
  unsupported_format: 'UNSUPPORTED_FORMAT',
  no_text_layer: 'NO_TEXT_LAYER',
};

const STALE_PROCESSING_MS = 2 * EXTRACTION_TIMEOUT_MS;

/**
 * Reads the uploaded PDF and matches its lines against the catalog, inside the
 * upload confirmation: reading the text layer takes well under a second, so
 * there is no queue yet. The states are the ones a worker would write.
 */
@Injectable()
export class ExtractionService {
  constructor(
    private readonly stockEntryRepository: StockEntryRepository,
    private readonly documentStorage: DocumentStorage,
    private readonly extractor: ExtractorStrategy,
    private readonly matchItemService: MatchItemService,
    private readonly supplierService: SupplierService,
  ) {}

  /**
   * Reads the document if the invoice is waiting for it, and answers the
   * invoice as it stands. A photo (MANUAL), a finished reading or one another
   * request is running come back as they are.
   */
  async run(invoice: PurchaseInvoice): Promise<PurchaseInvoice> {
    const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS);
    const claimed = await this.stockEntryRepository.claimExtraction(
      invoice.id,
      staleBefore,
    );
    if (!claimed) {
      return (
        (await this.stockEntryRepository.findByIdAndUser(
          invoice.id,
          invoice.userId,
        )) ?? invoice
      );
    }

    try {
      return await this.stockEntryRepository.update(
        invoice.id,
        await this.extract(invoice),
      );
    } catch (error) {
      // Left in PROCESSING, the retry would wait on a reading nobody runs.
      await this.stockEntryRepository.update(invoice.id, {
        extractionStatus: 'PENDING',
      });
      throw error;
    }
  }

  view(invoice: PurchaseInvoice): ExtractionResponseDto {
    const stored = storedExtractionOf(invoice);
    const result = stored?.result;

    return {
      status: invoice.extractionStatus,
      ...(invoice.failureReason && { failureReason: invoice.failureReason }),
      ...(invoice.supplierId && { supplierId: invoice.supplierId }),
      ...(result?.supplier && { supplier: result.supplier }),
      ...(invoice.number && { invoiceNumber: invoice.number }),
      ...(invoice.issueDate && {
        orderDate: toIsoDate(invoice.issueDate),
      }),
      ...(invoice.totalAmount !== null && {
        totalAmount: Number(invoice.totalAmount),
      }),
      items: (result?.items ?? []).map((item, index) => ({
        ...item,
        match: stored?.matches[index] ?? { decision: 'none', candidates: [] },
      })),
      ...(result?.partial && { partial: result.partial }),
    };
  }

  private async extract(
    invoice: PurchaseInvoice,
  ): Promise<Prisma.PurchaseInvoiceUncheckedUpdateInput> {
    const key = buildDocumentKey(invoice.userId, invoice.id);
    // The upload was verified a moment ago; its absence now is not a user error.
    const buffer = await this.documentStorage.getDocument(key);
    if (!buffer) throw new Error(`No document at ${key}`);

    const result = await this.withTimeout(
      this.extractor.extract({
        buffer,
        mimeType: invoice.fileMimeType ?? '',
        userId: invoice.userId,
      }),
    );
    const supplierId = result.supplier?.cnpj
      ? await this.supplierService.findIdByTaxId(
          invoice.userId,
          result.supplier.cnpj,
        )
      : undefined;
    const matches =
      result.items.length > 0
        ? await this.matchItemService.matchLines(
            invoice.userId,
            result.items.map(item => item.extractedDescription),
            supplierId,
          )
        : [];
    const stored: StoredExtraction = { result, matches };

    return {
      extractionStatus: result.status === 'success' ? 'SUCCESS' : 'FAILED',
      failureReason:
        result.status === 'failed'
          ? FAILURE_REASONS[result.failureReason ?? 'unreadable']
          : null,
      rawExtraction: stored as unknown as Prisma.InputJsonValue,
      // A failed reading still fills the header it found: it prefills the
      // manual entry. What the document leaves out keeps its value.
      ...(result.invoiceNumber && { number: result.invoiceNumber }),
      ...(result.orderDate && { issueDate: fromIsoDate(result.orderDate) }),
      ...(result.totalAmount !== undefined && {
        totalAmount: result.totalAmount,
      }),
      ...(supplierId && { supplierId }),
    };
  }

  /** The reading cannot be interrupted: past the limit its answer is dropped. */
  private async withTimeout(
    reading: Promise<ExtractionResult>,
  ): Promise<ExtractionResult> {
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<ExtractionResult>(resolve => {
      timer = setTimeout(
        () =>
          resolve({ status: 'failed', failureReason: 'timeout', items: [] }),
        EXTRACTION_TIMEOUT_MS,
      );
    });
    try {
      return await Promise.race([reading, timedOut]);
    } finally {
      clearTimeout(timer);
    }
  }
}
