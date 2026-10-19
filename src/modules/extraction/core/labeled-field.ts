import { findLabeledValues, fold } from './labeled-value';
import { TextLine } from './text-lines';

/** How one value of a document is found: by the labels printed next to it. */
export type LabeledField<T> = {
  /** In priority order: the first label that yields a value wins. */
  labels: RegExp[];
  /** Label cells that match one of the labels but name another value. */
  notThisField: RegExp;
  parse: (text: string) => T | undefined;
};

export function readLabeledField<T>(
  lines: TextLine[],
  field: LabeledField<T>,
): T | undefined {
  for (const label of field.labels) {
    const match = findLabeledValues(lines, label, field.parse).find(
      ({ labelCell }) => !field.notThisField.test(fold(labelCell.text)),
    );
    if (match) return match.value;
  }
  return undefined;
}

/**
 * Any of `words`, as whole words, for folded text. A space in a word stands
 * for any run of spaces.
 */
export function anyWord(words: string[]): RegExp {
  const alternatives = words.map(word => word.replace(/ /g, String.raw`\s+`));
  return new RegExp(String.raw`\b(?:${alternatives.join('|')})\b`);
}
