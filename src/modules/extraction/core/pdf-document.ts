import {
  PdfText,
  PdfUnreadableError,
  readPdfText,
} from './pdf/pdf-text-reader';
import { PageText } from './text-lines';

/** Fewer visible characters than this means a scan (a page number at most). */
export const MIN_TEXT_CHARS = 10;

// PDF allows junk before the signature within the first 1 KB.
const PDF_SIGNATURE = '%PDF-';
const SIGNATURE_WINDOW = 1024;

export type DocumentBytes = {
  buffer: Uint8Array;
  /** As declared by the upload; the bytes are still checked. */
  mimeType: string;
};

/** Why any document can fail before its own fields are looked for. */
export type ReadingFailureReason =
  'unreadable' | 'timeout' | 'unsupported_format' | 'no_text_layer';

export type PartialReading = {
  pagesRead: number;
  totalPages: number;
};

export type PdfDocument =
  | { status: 'read'; pages: PageText[]; partial?: PartialReading }
  | { status: 'failed'; failureReason: ReadingFailureReason };

/** A bad document is a `failed` answer, never a throw. */
export async function readPdfDocument({
  buffer,
  mimeType,
}: DocumentBytes): Promise<PdfDocument> {
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

  if (visibleChars(read.pages) < MIN_TEXT_CHARS) return failed('no_text_layer');
  return { status: 'read', pages: read.pages, ...partialOf(read) };
}

function partialOf(read: PdfText): { partial?: PartialReading } {
  if (read.totalPages <= read.pages.length) return {};
  return {
    partial: { pagesRead: read.pages.length, totalPages: read.totalPages },
  };
}

function failed(failureReason: ReadingFailureReason): PdfDocument {
  return { status: 'failed', failureReason };
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
