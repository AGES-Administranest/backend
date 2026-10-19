import { PdfText } from './pdf-builder';
import {
  groupLines,
  TextFragment,
  TextLine,
} from '../../../../src/modules/extraction/core/text-lines';

// Helvetica at 10 pt averages about 5 pt per glyph.
const CHAR_WIDTH = 5;
const FONT_SIZE = 10;

type Cell = [x: number, text: string];
type Row = [y: number, ...cells: Cell[]];

export function fragment(text: string, x: number, y: number): TextFragment {
  return { text, x, y, width: text.length * CHAR_WIDTH, height: FONT_SIZE };
}

/** A page as rows of `[x, text]`, run through `groupLines`. */
export function layout(rows: Row[], page = 1): TextLine[] {
  return pages([rows, page]);
}

export function pages(...spec: [rows: Row[], page: number][]): TextLine[] {
  return groupLines(
    spec.map(([rows, page]) => ({
      page,
      fragments: rows.flatMap(([y, ...cells]) =>
        cells.map(([x, text]) => fragment(text, x, y)),
      ),
    })),
  );
}

/** The same page `buildPdf` would draw, without going through a PDF. */
export function fromPdfTexts(texts: PdfText[], page = 1): TextLine[] {
  return groupLines([
    { page, fragments: texts.map(([x, y, text]) => fragment(text, x, y)) },
  ]);
}
