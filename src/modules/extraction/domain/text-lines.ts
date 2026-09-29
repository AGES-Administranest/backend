/** `y` is the baseline, measured from the top of the page. */
export type TextFragment = {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PageText = {
  page: number;
  fragments: TextFragment[];
};

export type TextCell = {
  text: string;
  x0: number;
  x1: number;
};

export type TextLine = {
  page: number;
  y: number;
  height: number;
  cells: TextCell[];
};

// Relative to the font size.
const BASELINE_TOLERANCE = 0.5;
const MIN_BASELINE_TOLERANCE = 2;

// In average character widths: a wider gap separates columns.
const CELL_GAP_IN_CHARS = 1.5;
const WORD_GAP_IN_CHARS = 0.2;

// Some generators pad columns with spaces inside a single run.
const PADDING_RUN = / {3,}/;

/** Lines and cells as the eye reads them. */
export function groupLines(pages: PageText[]): TextLine[] {
  return pages.flatMap(({ page, fragments }) => {
    const visible = fragments
      .flatMap(splitOnPadding)
      .map(fragment => ({ ...fragment, text: normalizeText(fragment.text) }))
      .filter(fragment => fragment.text.length > 0);

    return toLines(visible).map(members => toLine(page, members));
  });
}

export function lineText(line: TextLine): string {
  return line.cells.map(cell => cell.text).join('  ');
}

function toLines(fragments: TextFragment[]): TextFragment[][] {
  const tolerance = Math.max(
    MIN_BASELINE_TOLERANCE,
    BASELINE_TOLERANCE * median(fragments.map(f => f.height)),
  );
  const sorted = [...fragments].sort((a, b) => a.y - b.y || a.x - b.x);

  const lines: { baseline: number; members: TextFragment[] }[] = [];
  for (const fragment of sorted) {
    const current = lines.at(-1);
    if (current && Math.abs(fragment.y - current.baseline) <= tolerance) {
      current.members.push(fragment);
      // Running mean: a line drifting a point at a time stays whole.
      current.baseline =
        current.members.reduce((sum, f) => sum + f.y, 0) /
        current.members.length;
    } else {
      lines.push({ baseline: fragment.y, members: [fragment] });
    }
  }
  return lines.map(line => line.members);
}

function toLine(page: number, members: TextFragment[]): TextLine {
  const ordered = [...members].sort((a, b) => a.x - b.x);
  const charWidth = averageCharWidth(ordered);

  const cells: TextCell[] = [];
  let previous: TextFragment | undefined;
  for (const fragment of ordered) {
    if (isOverprint(previous, fragment, charWidth)) continue;
    previous = fragment;

    const cell = cells.at(-1);
    const gap = cell ? fragment.x - cell.x1 : Infinity;

    if (cell && gap <= CELL_GAP_IN_CHARS * charWidth) {
      const glue = gap <= WORD_GAP_IN_CHARS * charWidth ? '' : ' ';
      cell.text = `${cell.text}${glue}${fragment.text}`;
      cell.x1 = Math.max(cell.x1, fragment.x + fragment.width);
    } else {
      cells.push({
        text: fragment.text,
        x0: fragment.x,
        x1: fragment.x + fragment.width,
      });
    }
  }

  return {
    page,
    y: ordered.reduce((sum, f) => sum + f.y, 0) / ordered.length,
    height: Math.max(...ordered.map(f => f.height)),
    cells,
  };
}

// Fake bold: the same run drawn twice, a fraction of a point apart.
function isOverprint(
  previous: TextFragment | undefined,
  fragment: TextFragment,
  charWidth: number,
): boolean {
  return (
    previous !== undefined &&
    previous.text === fragment.text &&
    Math.abs(previous.x - fragment.x) < charWidth / 2
  );
}

function splitOnPadding(fragment: TextFragment): TextFragment[] {
  if (!PADDING_RUN.test(fragment.text)) return [fragment];

  // Positions inside a run are not in the PDF: spread the width evenly.
  const charWidth = fragment.width / Math.max(fragment.text.length, 1);
  const parts: TextFragment[] = [];
  const pattern = /\S+(?: {1,2}\S+)*/g;
  for (const match of fragment.text.matchAll(pattern)) {
    parts.push({
      ...fragment,
      text: match[0],
      x: fragment.x + match.index * charWidth,
      width: match[0].length * charWidth,
    });
  }
  return parts;
}

function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim();
}

function averageCharWidth(fragments: TextFragment[]): number {
  const chars = fragments.reduce((sum, f) => sum + f.text.length, 0);
  const width = fragments.reduce((sum, f) => sum + f.width, 0);
  if (chars > 0 && width > 0) return width / chars;
  return median(fragments.map(f => f.height)) / 2 || 1;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}
