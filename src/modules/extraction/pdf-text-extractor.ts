import { Injectable } from '@nestjs/common';

import { extractHeader, TableStart } from './domain/header-fields';
import { extractItems } from './domain/item-table';
import { groupLines, PageText, TextLine } from './domain/text-lines';
import { ExtractionFailureReason, ExtractionResult } from './extraction-result';
import { ExtractionInput, ExtractorStrategy } from './extractor-strategy';
import {
  PdfText,
  PdfUnreadableError,
  readPdfText,
} from './pdf/pdf-text-reader';

/** Fewer visible characters than this means a scan (a page number at most). */
export const MIN_TEXT_CHARS = 10;

// PDF allows junk before the signature within the first 1 KB.
const PDF_SIGNATURE = '%PDF-';
const SIGNATURE_WINDOW = 1024;

/** Reads the PDF text layer. A bad document is a `failed` result, never a throw. */
@Injectable()
export class PdfTextExtractor extends ExtractorStrategy {
  async extract({
    buffer,
    mimeType,
  }: ExtractionInput): Promise<ExtractionResult> {
    if (mimeType !== 'application/pdf' || !hasPdfSignature(buffer)) {
      return failed('unsupported_format');
    }

    let read: PdfText;
    try {
      read = await readPdfText(buffer);
    } catch (error) {
      if (error instanceof PdfUnreadableError) return failed('unreadable');
      throw error;
    }
    return withPartial(extractFromPages(read.pages), read);
  }
}

function extractFromPages(pages: PageText[]): ExtractionResult {
  if (visibleChars(pages) < MIN_TEXT_CHARS) return failed('no_text_layer');

  const lines = groupLines(pages);
  const table = extractItems(lines);
  // Table lines are left out: a "Total" column would read as the grand total.
  const header = extractHeader(
    lines.filter(line => !table.lines.has(line)),
    tableStartOf(lines, table.lines),
  );

  // Without items the header still prefills the manual entry.
  return table.items.length > 0
    ? { status: 'success', ...header, items: table.items }
    : { ...failed('no_table_found'), ...header };
}

function tableStartOf(
  lines: TextLine[],
  tableLines: Set<TextLine>,
): TableStart | undefined {
  const first = lines.find(line => tableLines.has(line));
  return first ? { page: first.page, y: first.y } : undefined;
}

function withPartial(
  result: ExtractionResult,
  read: PdfText,
): ExtractionResult {
  if (read.totalPages <= read.pages.length) return result;
  return {
    ...result,
    partial: { pagesRead: read.pages.length, totalPages: read.totalPages },
  };
}

function failed(failureReason: ExtractionFailureReason): ExtractionResult {
  return { status: 'failed', failureReason, items: [] };
}

function hasPdfSignature(bytes: Uint8Array): boolean {
  const head = new TextDecoder('latin1').decode(
    bytes.subarray(0, SIGNATURE_WINDOW),
  );
  return head.includes(PDF_SIGNATURE);
}

function visibleChars(pages: PageText[]): number {
  return pages.reduce(
    (total, page) =>
      total +
      page.fragments.reduce(
        (sum, fragment) => sum + fragment.text.replace(/\s/g, '').length,
        0,
      ),
    0,
  );
}
