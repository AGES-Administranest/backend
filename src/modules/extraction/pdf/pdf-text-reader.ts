import type {
  PDFDocumentProxy,
  TextItem,
  TextMarkedContent,
} from 'pdfjs-dist/types/src/display/api';

import { loadPdfjs } from './pdfjs-loader';
import { PageText, TextFragment } from '../domain/text-lines';

/** Bounds the CPU a hostile upload can take; beyond it the reading is partial. */
export const MAX_PAGES = 50;

export type PdfText = {
  pages: PageText[];
  totalPages: number;
};

/** Corrupt, truncated or encrypted. */
export class PdfUnreadableError extends Error {
  constructor(reason: string) {
    super(`The PDF could not be read: ${reason}`);
    this.name = 'PdfUnreadableError';
  }
}

const UNREADABLE_ERRORS = new Set([
  'InvalidPDFException',
  'PasswordException',
  'FormatError',
]);

export async function readPdfText(bytes: Uint8Array): Promise<PdfText> {
  const task = loadPdfjs().getDocument({
    // pdf.js detaches the buffer it gets.
    data: new Uint8Array(bytes),
    verbosity: 0,
    disableFontFace: true,
    useSystemFonts: false,
  });

  try {
    const document = await task.promise;
    const pages: PageText[] = [];
    const count = Math.min(document.numPages, MAX_PAGES);
    for (let number = 1; number <= count; number++) {
      pages.push(await readPage(document, number));
    }
    return { pages, totalPages: document.numPages };
  } catch (error) {
    throw asUnreadable(error);
  } finally {
    await task.destroy();
  }
}

async function readPage(
  document: PDFDocumentProxy,
  number: number,
): Promise<PageText> {
  const page = await document.getPage(number);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const fragments = content.items.flatMap(item =>
      toFragment(item, viewport.transform),
    );
    return { page: number, fragments };
  } finally {
    page.cleanup();
  }
}

/** Viewport space: top-left origin, crop box and rotation already applied. */
function toFragment(
  item: TextItem | TextMarkedContent,
  viewportTransform: number[],
): TextFragment[] {
  if (!('str' in item) || item.str.trim().length === 0) return [];

  const [a, b, c, d, x, y] = loadPdfjs().Util.transform(
    viewportTransform,
    item.transform as number[],
  ) as number[];

  // Rotated text (stamps, margin notes) is never a table cell.
  if (Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3 || a <= 0) return [];

  return [
    {
      text: item.str,
      x,
      y,
      width: item.width,
      height: Math.abs(d) || item.height,
    },
  ];
}

function asUnreadable(error: unknown): unknown {
  if (error instanceof PdfUnreadableError) return error;
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && UNREADABLE_ERRORS.has(name)) {
    return new PdfUnreadableError(name);
  }
  return error;
}
