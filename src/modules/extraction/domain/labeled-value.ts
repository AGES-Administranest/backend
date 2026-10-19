import { TextCell, TextLine } from './text-lines';

/** Lowercase, no accents, same length as the NFC input (indexes carry over). */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

export type LabeledValue<T> = {
  value: T;
  line: TextLine;
  labelCell: TextCell;
};

type Options = {
  /** Also look in the cell under the label (boxed layouts). */
  below?: boolean;
};

// In line heights.
const BELOW_DISTANCE = 2.5;

/**
 * Values that follow `label`, in document order: in the same cell after the
 * label, in the next cell, or in the cell under it.
 */
export function findLabeledValues<T>(
  lines: TextLine[],
  label: RegExp,
  parse: (text: string) => T | undefined,
  { below = true }: Options = {},
): LabeledValue<T>[] {
  const found: LabeledValue<T>[] = [];

  lines.forEach((line, lineIndex) => {
    line.cells.forEach((cell, cellIndex) => {
      const match = label.exec(fold(cell.text));
      if (!match) return;

      const candidates = [
        cell.text.slice(match.index + match[0].length),
        line.cells[cellIndex + 1]?.text,
        below ? cellBelow(lines, lineIndex, cell)?.text : undefined,
      ];
      for (const text of candidates) {
        const value = text === undefined ? undefined : parse(text);
        if (value !== undefined) {
          found.push({ value, line, labelCell: cell });
          return;
        }
      }
    });
  });

  return found;
}

// Every line in reach, not only the next: in a DANFE it usually belongs to
// another box.
function cellBelow(
  lines: TextLine[],
  lineIndex: number,
  label: TextCell,
): TextCell | undefined {
  const line = lines[lineIndex];
  for (const next of lines.slice(lineIndex + 1)) {
    if (next.page !== line.page || next.y <= line.y) continue;
    if (next.y - line.y > BELOW_DISTANCE * line.height) return undefined;
    const cell = next.cells.find(c => c.x1 > label.x0 && c.x0 < label.x1);
    if (cell) return cell;
  }
  return undefined;
}
