import { fold } from './labeled-value';
import { TextLine } from './text-lines';

export type SectionTitle<S> = { title: RegExp; section: S };

/**
 * Each line belongs to the last title above it, matched on the folded first
 * cell. Every page starts over at `initial`.
 */
export function sectionsOf<S>(
  lines: TextLine[],
  titles: SectionTitle<S>[],
  initial: S,
): Map<TextLine, S> {
  const sections = new Map<TextLine, S>();
  let section = initial;
  let page = lines[0]?.page;
  for (const line of lines) {
    if (line.page !== page) {
      page = line.page;
      section = initial;
    }
    const first = fold(line.cells[0]?.text ?? '').replace(/^[^\p{L}]+/u, '');
    section = titles.find(({ title }) => title.test(first))?.section ?? section;
    sections.set(line, section);
  }
  return sections;
}
