import { checkLine } from './arithmetic';
import { parseBrazilianNumber, parseLeadingNumber } from './brazilian-formats';
import { fold } from './labeled-value';
import { TextCell, TextLine } from './text-lines';
import type { ExtractedItem } from '../extraction-result';

export type ItemTable = {
  items: ExtractedItem[];
  /** Header and rows the table used, so the header extraction skips them. */
  lines: Set<TextLine>;
};

type ColumnKind =
  | 'description'
  | 'quantity'
  | 'unit'
  | 'unitValue'
  | 'totalValue'
  | 'code'
  | 'other';

type Column = { kind: ColumnKind; left: number; right: number };

type Header = { columns: Column[]; lines: TextLine[] };

// First rule wins: "Valor Unitário" is a unit value before it is a value.
const COLUMN_RULES: [RegExp, ColumnKind | 'price' | 'weakDescription'][] = [
  // Only so they stay out of the description and values ("VALOR ICMS").
  [
    /\b(cod|codigo|ref|referencia|ncm|cfop|cst|ean|gtin|lote|validade|icms|ipi|aliq|calc|pis|cofins|iss|st)\b/,
    'code',
  ],
  [/\bunit|\bunitario\b/, 'unitValue'],
  [/\b(sub)?total\b/, 'totalValue'],
  [/\b(qtd|qtde|quant|quantidade|qde)\b/, 'quantity'],
  [/^(un|und|unid|unidade|u\.?m\.?|emb|embalagem|medida)\b/, 'unit'],
  [
    /\b(descricao|produto|mercadoria|material|discriminacao|especificacao|insumo)\b/,
    'description',
  ],
  // "Item" names the product in some layouts and numbers the lines in others.
  [/\bitem\b/, 'weakDescription'],
  [/\b(preco|valor|vlr)\b/, 'price'],
];

/** Words that finish a header split over lines ("Valor" / "Unit."). */
const HEADER_CONTINUATION = /^\(?r\$\)?$|^unit\.?$|^total\.?$|^\(un\)$/;

const MAX_HEADER_LINES = 3;

// Matched on the first cell.
const TABLE_END =
  /^(sub ?total|total|valor total|observac|obs\b|informacoes|dados adicionais|desconto|frete|condic|forma de pagamento|vencimento|assinatura)/;

// In line heights.
const MAX_ROW_GAP = 3;
const MAX_WRAP_GAP = 1.8;
// In points.
const DESCRIPTION_EDGE_SLACK = 2;
const LABEL_OVERHANG = 6;

/** Columns come from the table header; without one, quantity × unit ≈ total. */
export function extractItems(lines: TextLine[]): ItemTable {
  const table = readTables(lines);
  return table.items.length > 0 ? table : readByArithmetic(lines);
}

function readTables(lines: TextLine[]): ItemTable {
  const items: DraftItem[] = [];
  const used = new Set<TextLine>();
  // Carried to the next page, with or without the header repeated.
  let carried: Column[] | undefined;

  for (const page of pagesOf(lines)) {
    let columns = carried;
    let start = 0;

    for (let i = 0; i < page.length; i++) {
      const header = headerAt(page, i);
      if (!header) continue;
      header.lines.forEach(line => used.add(line));
      columns = header.columns;
      start = i + header.lines.length;
      break;
    }
    if (!columns) continue;

    const { closed, consumed } = readRows(page.slice(start), columns, items);
    consumed.forEach(line => used.add(line));
    carried = closed ? undefined : columns;
  }

  return { items: items.flatMap(finish), lines: used };
}

type DraftItem = {
  description: string;
  quantity?: number;
  unitValue?: number;
  totalValue?: number;
  /** Line the item last grew on. */
  lastLine: TextLine;
};

type Row = {
  line: TextLine;
  description: string;
  quantity?: number;
  unitValue?: number;
  totalValue?: number;
};

function readRows(
  lines: TextLine[],
  columns: Column[],
  items: DraftItem[],
): { closed: boolean; consumed: TextLine[] } {
  const consumed: TextLine[] = [];
  const rows = lines.map(line => toRow(line, columns));
  // Gaps are measured from the last item line, so a long multi-line item does
  // not read as the end of the page.
  let lastRowLine: TextLine | undefined;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (endsTable(row)) {
      return { closed: true, consumed };
    }
    // A wide gap ends the page (a footer), not the table.
    if (
      lastRowLine &&
      row.line.y - lastRowLine.y > MAX_ROW_GAP * lastRowLine.height
    ) {
      return { closed: false, consumed };
    }
    consumed.push(row.line);

    const last = items.at(-1);
    if (row.description && hasValues(row)) {
      items.push({
        ...values(row),
        description: row.description,
        lastLine: row.line,
      });
      lastRowLine = row.line;
    } else if (row.description) {
      const next = rows[i + 1];
      // The totals line has numbers and no description too.
      if (next && !endsTable(next) && !next.description && hasValues(next)) {
        // Description on one line, numbers on the next.
        items.push({ description: row.description, lastLine: row.line });
        lastRowLine = row.line;
      } else if (last && wrapsOnto(last, row.line)) {
        last.description = joinWrapped(last.description, row.description);
        last.lastLine = row.line;
        lastRowLine = row.line;
      }
      // Otherwise a section title or page furniture: not an item.
    } else if (hasValues(row) && last && !hasValues(last)) {
      Object.assign(last, values(row), { lastLine: row.line });
      lastRowLine = row.line;
    }
  }

  return { closed: false, consumed };
}

function toRow(line: TextLine, columns: Column[]): Row {
  const texts = new Map<ColumnKind, string[]>();
  for (const cell of line.cells.flatMap(c => splitAcrossColumns(c, columns))) {
    const kind = columnOf(cell, columns).kind;
    texts.set(kind, [...(texts.get(kind) ?? []), cell.text]);
  }
  const number = (kind: ColumnKind) => {
    const text = texts.get(kind)?.join(' ');
    return text === undefined ? undefined : parseLeadingNumber(text);
  };

  return {
    line,
    description: (texts.get('description') ?? []).join(' ').trim(),
    quantity: number('quantity'),
    unitValue: number('unitValue'),
    totalValue: number('totalValue'),
  };
}

// "frasco-" / "ampola" joins without a space; a lone dash is a separator.
function joinWrapped(text: string, continuation: string): string {
  return /[^\s-]-$/.test(text)
    ? `${text}${continuation}`
    : `${text} ${continuation}`;
}

function endsTable(row: Row): boolean {
  return TABLE_END.test(fold(row.line.cells[0]?.text ?? ''));
}

function wrapsOnto(item: DraftItem, line: TextLine): boolean {
  return (
    line.page === item.lastLine.page &&
    line.y - item.lastLine.y <= MAX_WRAP_GAP * item.lastLine.height
  );
}

function hasValues(row: Pick<Row, 'quantity' | 'unitValue' | 'totalValue'>) {
  return (
    row.quantity !== undefined ||
    row.unitValue !== undefined ||
    row.totalValue !== undefined
  );
}

function values({ quantity, unitValue, totalValue }: Row) {
  return { quantity, unitValue, totalValue };
}

/** A description never completed by numbers was not an item after all. */
function finish(item: DraftItem): ExtractedItem[] {
  if (!hasValues(item)) return [];
  const { description, quantity, unitValue, totalValue } = item;
  return [
    {
      extractedDescription: description,
      ...(quantity !== undefined ? { quantity } : {}),
      ...(unitValue !== undefined ? { unitValue } : {}),
      ...(totalValue !== undefined ? { totalValue } : {}),
      arithmeticCheck: checkLine(quantity, unitValue, totalValue),
    },
  ];
}

// Up to three lines (the DANFE's "VALOR" / "UNIT."); the widest that reads as
// a header wins.
function headerAt(lines: TextLine[], index: number): Header | undefined {
  const band = [lines[index]];
  while (band.length < MAX_HEADER_LINES) {
    const next = lines[index + band.length];
    if (!next || !continuesHeader(band.at(-1)!, next)) break;
    band.push(next);
  }

  for (let size = band.length; size >= 1; size--) {
    const columns = columnsOf(mergeLines(band.slice(0, size)));
    if (columns) return { columns, lines: band.slice(0, size) };
  }
  return undefined;
}

function continuesHeader(line: TextLine, next: TextLine): boolean {
  return (
    next.page === line.page &&
    next.y - line.y <= 1.6 * line.height &&
    next.cells.every(cell => {
      const text = fold(cell.text);
      return HEADER_CONTINUATION.test(text) || classify(text) !== undefined;
    })
  );
}

/** One header line out of several: each cell joins the one it sits under. */
function mergeLines(band: TextLine[]): TextCell[] {
  const cells = band[0].cells.map(cell => ({ ...cell }));
  for (const line of band.slice(1)) {
    for (const lower of line.cells) {
      const above = cells.find(
        cell => lower.x1 > cell.x0 && lower.x0 < cell.x1,
      );
      if (above) {
        above.text = `${above.text} ${lower.text}`;
        above.x0 = Math.min(above.x0, lower.x0);
        above.x1 = Math.max(above.x1, lower.x1);
      } else {
        cells.push({ ...lower });
      }
    }
    cells.sort((a, b) => a.x0 - b.x0);
  }
  return cells;
}

// A header has a description, a quantity and at least one value.
function columnsOf(cells: TextCell[]): Column[] | undefined {
  if (cells.length < 3 || cells.some(cell => isNumber(cell.text))) {
    return undefined;
  }

  const raw = cells.map(cell => classify(fold(cell.text)) ?? 'other');
  const hasDescription = raw.includes('description');
  const hasTotal = raw.includes('totalValue');
  const kinds: ColumnKind[] = raw.map(kind => {
    if (kind === 'weakDescription')
      return hasDescription ? 'other' : 'description';
    if (kind === 'price') return hasTotal ? 'unitValue' : 'totalValue';
    return kind;
  });

  const isHeader =
    kinds.includes('description') &&
    kinds.includes('quantity') &&
    (kinds.includes('unitValue') || kinds.includes('totalValue'));
  if (!isHeader) return undefined;

  // Halfway between labels, except around the description, which runs wide:
  // up to the next label, and from just past the previous one (the DANFE
  // centres its label over a column that starts further left).
  const edges = cells.slice(1).map((cell, i) => {
    const previous = cells[i];
    const halfway = (previous.x1 + cell.x0) / 2;
    if (kinds[i] === 'description') return cell.x0 - DESCRIPTION_EDGE_SLACK;
    if (kinds[i + 1] === 'description') {
      return Math.min(halfway, previous.x1 + LABEL_OVERHANG);
    }
    return halfway;
  });
  return cells.map((_, i) => ({
    kind: kinds[i],
    left: i === 0 ? -Infinity : edges[i - 1],
    right: i === cells.length - 1 ? Infinity : edges[i],
  }));
}

function classify(
  text: string,
): ColumnKind | 'price' | 'weakDescription' | undefined {
  return COLUMN_RULES.find(([pattern]) => pattern.test(text))?.[1];
}

function columnOf(cell: TextCell, columns: Column[]): Column {
  let best = columns[0];
  let bestOverlap = -Infinity;
  for (const column of columns) {
    const overlap =
      Math.min(cell.x1, column.right) - Math.max(cell.x0, column.left);
    if (overlap > bestOverlap) {
      best = column;
      bestOverlap = overlap;
    }
  }
  return best;
}

// A cell across a column edge is two values glued together (a truncated
// description touching the next column): split it word by word.
function splitAcrossColumns(cell: TextCell, columns: Column[]): TextCell[] {
  const touched = columns.filter(
    column =>
      Math.min(cell.x1, column.right) - Math.max(cell.x0, column.left) > 0,
  );
  if (touched.length < 2 || !cell.text.includes(' ')) return [cell];

  const charWidth = (cell.x1 - cell.x0) / cell.text.length;
  const words = [...cell.text.matchAll(/\S+/g)].map(word => {
    const x0 = cell.x0 + word.index * charWidth;
    return { text: word[0], x0, x1: x0 + word[0].length * charWidth };
  });

  // Only whole words inside two columns prove two values; a word straddling an
  // edge ("Lote:") just sits a little off.
  const holders = new Set(
    words.flatMap(word =>
      touched.filter(c => word.x0 >= c.left && word.x1 <= c.right),
    ),
  );
  if (holders.size < 2) return [cell];

  const parts = new Map<Column, TextCell>();
  for (const word of words) {
    const middle = (word.x0 + word.x1) / 2;
    const column =
      touched.find(c => middle >= c.left && middle < c.right) ?? touched[0];
    const part = parts.get(column);
    if (part) {
      part.text = `${part.text} ${word.text}`;
      part.x1 = word.x1;
    } else {
      parts.set(column, { ...word });
    }
  }
  return [...parts.values()];
}

function pagesOf(lines: TextLine[]): TextLine[][] {
  const pages = new Map<number, TextLine[]>();
  for (const line of lines) {
    pages.set(line.page, [...(pages.get(line.page) ?? []), line]);
  }
  return [...pages.values()];
}

// No header: only lines ending in quantity × unit ≈ total are items.
function readByArithmetic(lines: TextLine[]): ItemTable {
  const items: ExtractedItem[] = [];
  const used = new Set<TextLine>();

  for (const line of lines) {
    const numbers = line.cells.map(cell => parseBrazilianNumber(cell.text));
    let firstNumeric = numbers.length;
    while (firstNumeric > 0 && numbers[firstNumeric - 1] !== undefined) {
      firstNumeric--;
    }
    const trailing = numbers.slice(firstNumeric) as number[];
    const triple = closingTriple(trailing);
    if (!triple) continue;
    const [quantity, unitValue, totalValue] = triple;

    const description = line.cells
      .slice(0, firstNumeric)
      .map(cell => cell.text)
      .join(' ')
      .trim();
    if (!description) continue;

    items.push({
      extractedDescription: description,
      quantity,
      unitValue,
      totalValue,
      arithmeticCheck: true,
    });
    used.add(line);
  }

  return { items, lines: used };
}

// From the right. A zero total is refused: tax columns of 0,00 close trivially.
function closingTriple(
  numbers: number[],
): [number, number, number] | undefined {
  for (let end = numbers.length; end >= 3; end--) {
    const [quantity, unitValue, totalValue] = numbers.slice(end - 3, end);
    if (totalValue > 0 && checkLine(quantity, unitValue, totalValue)) {
      return [quantity, unitValue, totalValue];
    }
  }
  return undefined;
}

function isNumber(text: string): boolean {
  return parseBrazilianNumber(text) !== undefined;
}
