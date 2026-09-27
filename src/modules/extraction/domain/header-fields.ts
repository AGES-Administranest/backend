import {
  findDates,
  findMoneyValues,
  parseBrazilianDate,
} from './brazilian-formats';
import { findCnpjs } from './cnpj';
import { findLabeledValues, fold } from './labeled-value';
import { lineText, TextCell, TextLine } from './text-lines';
import type { ExtractedSupplier } from '../extraction-result';

export type HeaderFields = {
  supplier?: ExtractedSupplier;
  invoiceNumber?: string;
  orderDate?: string;
  totalAmount?: number;
};

// Wordings are matched on folded text. "Razão social" is left out: it labels
// the buyer's block as often as the supplier's.
const SUPPLIER_CONTEXT = /\b(fornecedor|emitente|vendedor|cedente)\b/;
const BUYER_CONTEXT =
  /\b(destinatario|cliente|comprador|sacado|tomador|faturar para|entregar em)\b/;
const NAME_LABEL = /\b(razao social|fornecedor|emitente|nome empresarial)\b/;

// The letterhead above the first title is the supplier's.
const SECTION_TITLES: { title: RegExp; section: Section }[] = [
  {
    title:
      /^(?:dados\s+do\s+|prezad[oa](?:\(a\))?\s+)?(?:cliente|destinatario|comprador|sacado|tomador|faturar\s+para|entregar\s+em)\b|^cod\.?\s*\/\s*cliente\b/,
    section: 'buyer',
  },
  {
    title:
      /^(?:identificacao\s+do\s+emitente|emitente|dados\s+do\s+fornecedor|fornecedor)\b/,
    section: 'supplier',
  },
  {
    title:
      /^(?:transportador|calculo\s+do\s+imposto|dados\s+adicionais|informacoes\s+complementares)\b/,
    section: 'other',
  },
];
// Its first line below is the name.
const SUPPLIER_TITLE =
  /^(?:identificacao\s+do\s+emitente|emitente|dados\s+do\s+fornecedor|fornecedor)$/;

type Section = 'supplier' | 'buyer' | 'other';
const COMPANY_SUFFIX =
  /\b(ltda|eireli|s\.?\/?a|epp|mei|me|comercio|distribuidora|industria|farmaceutica|hospitalar)\b/;

const NUMBER_SIGN = String.raw`(?:n\s?[º°]|n\.\s?[º°o]|no\.|nr\b\.?|num\.|numero)`;
// Distributors send quotations and budgets as often as orders.
const DOCUMENT_WORD = String.raw`(?:pedido|cotacao|orcamento|proposta)`;

type InvoiceLabel = {
  label: RegExp;
  // Capitals alone ("ABHXSU"): after a bare "Pedido", "APROVADO" is a status.
  lettersOnly: boolean;
};

const INVOICE_LABELS: InvoiceLabel[] = [
  {
    label: new RegExp(
      String.raw`\b(?:${NUMBER_SIGN}\s*(?:d[oa]\s+)?${DOCUMENT_WORD}|${DOCUMENT_WORD}\s*${NUMBER_SIGN})`,
    ),
    lettersOnly: true,
  },
  { label: /\b(?:nota fiscal|nf-?e|n\.f\.)/, lettersOnly: false },
  { label: new RegExp(String.raw`\b${DOCUMENT_WORD}\b`), lettersOnly: false },
  {
    label: new RegExp(String.raw`(?:^|\s)${NUMBER_SIGN}`),
    lettersOnly: true,
  },
  { label: /\bdocumento\b/, lettersOnly: false },
];

const LETTER_CODE = /^[A-Z]{4,20}$/;
const NOT_A_CODE =
  /^(cliente|fornecedor|serie|data|validade|emissao|numero|pedido|cotacao|orcamento|proposta|total|valor|vendedor)$/;

const DATE_LABELS = [
  /\b(?:data\s+(?:de\s+)?emissao|emissao|emitido em)\b/,
  /\bdata\s+d[oa]\s+(?:pedido|compra|documento)\b/,
  /\bdata\b/,
];
const NOT_ORDER_DATE =
  /\b(vencimento|validade|entrega|previsao|saida|embarque|pagamento)\b/;

const TOTAL_LABELS: { label: RegExp; below: boolean }[] = [
  { label: /\b(?:valor\s+)?total\s+da\s+nota\b/, below: true },
  { label: /\b(?:valor\s+)?total\s+do\s+pedido\b/, below: true },
  { label: /\btotal\s+geral\b/, below: true },
  { label: /\b(?:total|valor)\s+a\s+pagar\b|\btotal\s+liquido\b/, below: true },
  // Also column headers: only a value on their own line.
  { label: /\bvalor\s+total\b/, below: false },
  { label: /\btotal\b/, below: false },
];
const NOT_GRAND_TOTAL =
  /\b(subtotal|total\s+d[eo]s?\s+(?:produtos|itens|servicos)|qtd|quantidade|peso|volumes?|desconto|frete|ipi|icms)\b/;
const PRODUCTS_TOTAL = /\btotal\s+d[eo]s?\s+produtos\b/;

// Lines above a CNPJ that still say whose it is.
const CONTEXT_LINES = 3;

export type TableStart = { page: number; y: number };

/** Expects the lines outside the item table, whose "Total" column is not the grand total. */
export function extractHeader(
  lines: TextLine[],
  tableStart?: TableStart,
): HeaderFields {
  const sections = sectionsOf(lines);
  const supplier = extractSupplier(lines, sections);
  return {
    ...(supplier ? { supplier } : {}),
    ...defined('invoiceNumber', extractInvoiceNumber(lines, tableStart)),
    ...defined('orderDate', extractOrderDate(lines)),
    ...defined('totalAmount', extractTotal(lines)),
  };
}

function sectionsOf(lines: TextLine[]): Map<TextLine, Section> {
  const sections = new Map<TextLine, Section>();
  let section: Section = 'supplier';
  let page = lines[0]?.page;
  for (const line of lines) {
    if (line.page !== page) {
      page = line.page;
      section = 'supplier';
    }
    const first = fold(line.cells[0]?.text ?? '').replace(/^[^\p{L}]+/u, '');
    section =
      SECTION_TITLES.find(({ title }) => title.test(first))?.section ?? section;
    sections.set(line, section);
  }
  return sections;
}

function extractSupplier(
  lines: TextLine[],
  sections: Map<TextLine, Section>,
): ExtractedSupplier | undefined {
  const supplierLines = lines.filter(line => sections.get(line) === 'supplier');
  const anchor = findSupplierCnpj(lines, sections);
  const name =
    nameUnderSupplierTitle(lines) ??
    labeledName(supplierLines) ??
    (anchor ? nameNearCnpj(lines, anchor) : undefined) ??
    companyLineOnFirstPage(supplierLines);

  if (!anchor && !name) return undefined;
  return {
    ...defined('cnpj', anchor?.cnpj),
    ...defined('name', name),
  };
}

type CnpjAnchor = { cnpj: string; lineIndex: number; cell: TextCell };

// The first CNPJ in the supplier's section; else the labels above it in its
// column, or to its left, tell buyer from supplier.
function findSupplierCnpj(
  lines: TextLine[],
  sections: Map<TextLine, Section>,
): CnpjAnchor | undefined {
  const anchors = lines.flatMap((line, lineIndex) =>
    line.cells.flatMap(cell =>
      findCnpjs(cell.text).map(cnpj => ({ cnpj, lineIndex, cell })),
    ),
  );
  const inSupplierSection = anchors.find(
    anchor => sections.get(lines[anchor.lineIndex]) === 'supplier',
  );
  if (inSupplierSection) return inSupplierSection;

  const scored = anchors
    .map(anchor => {
      const context = columnContext(lines, anchor.lineIndex, anchor.cell);
      const score = BUYER_CONTEXT.test(context)
        ? -1
        : SUPPLIER_CONTEXT.test(context)
          ? 1
          : 0;
      return { anchor, score };
    })
    .filter(({ score }) => score >= 0);

  const best = scored.find(({ score }) => score > 0) ?? scored[0];
  return best?.anchor;
}

function columnContext(
  lines: TextLine[],
  lineIndex: number,
  cell: TextCell,
): string {
  const line = lines[lineIndex];
  const texts: string[] = [];
  for (let i = Math.max(0, lineIndex - CONTEXT_LINES); i <= lineIndex; i++) {
    if (lines[i].page !== line.page) continue;
    for (const other of lines[i].cells) {
      const leftOnSameLine = i === lineIndex && other.x0 <= cell.x0;
      if (inColumn(other, cell) || leftOnSameLine) texts.push(other.text);
    }
  }
  return fold(texts.join(' '));
}

const COLUMN_SLACK = 20;

// Supplier and buyer boxes often sit side by side.
function inColumn(other: TextCell, cell: TextCell): boolean {
  return (
    other.x1 >= cell.x0 - COLUMN_SLACK && other.x0 <= cell.x1 + COLUMN_SLACK
  );
}

/** The DANFE prints the issuer's name as the first line of its block. */
function nameUnderSupplierTitle(lines: TextLine[]): string | undefined {
  for (const [index, line] of lines.entries()) {
    const title = line.cells.find(cell =>
      SUPPLIER_TITLE.test(fold(cell.text).trim()),
    );
    if (!title) continue;
    for (const [offset, next] of lines.slice(index + 1, index + 4).entries()) {
      if (next.page !== line.page) break;
      const name = asCompanyName(columnText(next, title));
      if (name) return withLegalSuffix(name, lines, index + 1 + offset, title);
    }
  }
  return undefined;
}

const LEGAL_SUFFIX = /\b(ltda|eireli|s\.?\/?a|epp|mei|me|cia)\.?$/;

// A name in a narrow box wraps and leaves its legal form alone on the next
// line ("…Hospitalares" / "Ltda").
function withLegalSuffix(
  name: string,
  lines: TextLine[],
  lineIndex: number,
  column: TextCell,
): string {
  if (LEGAL_SUFFIX.test(fold(name))) return name;
  const line = lines[lineIndex];
  // Lines of other boxes may come in between.
  for (const next of lines.slice(lineIndex + 1)) {
    if (next.page !== line.page) break;
    if (next.y - line.y > NAME_WRAP_GAP * line.height) break;
    const text = columnText(next, column).trim();
    if (!text) continue;
    const completes =
      text.split(/\s+/).length <= 3 &&
      !/[\d:]/.test(text) &&
      LEGAL_SUFFIX.test(fold(text));
    return completes ? `${name} ${text}` : name;
  }
  return name;
}

function labeledName(lines: TextLine[]): string | undefined {
  return findLabeledValues(lines, NAME_LABEL, asCompanyName).find(
    ({ line }) => !BUYER_CONTEXT.test(fold(lineText(line))),
  )?.value;
}

/** Text before "CNPJ" on the same line, else a line just above it. */
function nameNearCnpj(
  lines: TextLine[],
  { lineIndex, cell }: CnpjAnchor,
): string | undefined {
  const line = lines[lineIndex];
  const previousCell = line.cells[line.cells.indexOf(cell) - 1];
  const sameLine =
    asCompanyName(cell.text.split(/cnpj/i)[0] ?? '') ??
    (previousCell ? asCompanyName(previousCell.text) : undefined);
  if (sameLine) return sameLine;

  const above = lines
    .slice(Math.max(0, lineIndex - CONTEXT_LINES), lineIndex)
    .filter(other => other.page === line.page)
    .reverse()
    .map(other => ({ line: other, name: columnText(other, cell) }))
    .filter(({ name }) => asCompanyName(name) !== undefined);
  const chosen =
    above.find(({ name }) => COMPANY_SUFFIX.test(fold(name))) ?? above[0];
  return chosen ? withWrappedStart(lines, chosen.line, cell) : undefined;
}

function columnCells(line: TextLine, cell: TextCell): TextCell[] {
  return line.cells.filter(candidate => inColumn(candidate, cell));
}

function columnText(line: TextLine, cell: TextCell): string {
  return columnCells(line, cell)
    .map(candidate => candidate.text)
    .join(' ');
}

// In line heights.
const NAME_WRAP_GAP = 1.6;

// A long letterhead name wraps: lines right above, starting at the same x, are
// its start.
function withWrappedStart(
  lines: TextLine[],
  line: TextLine,
  cell: TextCell,
): string | undefined {
  const parts = [columnText(line, cell)];
  let current = line;
  for (let i = lines.indexOf(line) - 1; i >= 0 && parts.length < 3; i--) {
    const previous = lines[i];
    // On the name's own cells: a title on the same line must not break it.
    const start = columnCells(previous, cell)[0];
    const currentStart = columnCells(current, cell)[0];
    const continues =
      start !== undefined &&
      currentStart !== undefined &&
      previous.page === current.page &&
      current.y - previous.y <= NAME_WRAP_GAP * current.height &&
      Math.abs(start.x0 - currentStart.x0) < 4;
    const text = columnText(previous, cell);
    if (!continues || text.includes(':') || !asCompanyName(text)) break;
    parts.unshift(text);
    current = previous;
  }
  return asCompanyName(parts.join(' '));
}

function companyLineOnFirstPage(lines: TextLine[]): string | undefined {
  return lines
    .filter(line => line.page === lines[0]?.page)
    .slice(0, 10)
    .map(line => asCompanyName(lineText(line)))
    .find(name => name !== undefined && COMPANY_SUFFIX.test(fold(name)));
}

/** Letters enough to be a name, cut before a trailing "CNPJ ...". */
function asCompanyName(text: string): string | undefined {
  const name = text
    .split(/\bcnpj\b/i)[0]
    // A final dot stays: it belongs to "S.A." and "Ltda.".
    .replace(/^[\s:.\-–]+|[\s:\-–]+$/g, '')
    .trim();
  const letters = name.replace(/[^\p{L}]/gu, '').length;
  if (letters < 3 || letters < name.replace(/\s/g, '').length / 2) {
    return undefined;
  }
  if (NAME_LABEL.test(fold(name)) && name.split(/\s+/).length <= 2) {
    return undefined;
  }
  return name;
}

// Above the table first: notes and footers below it quote other documents.
function extractInvoiceNumber(
  lines: TextLine[],
  tableStart?: TableStart,
): string | undefined {
  const top = tableStart
    ? lines.filter(
        line =>
          line.page < tableStart.page ||
          (line.page === tableStart.page && line.y < tableStart.y),
      )
    : lines;
  return invoiceNumberIn(top) ?? invoiceNumberIn(lines);
}

function invoiceNumberIn(lines: TextLine[]): string | undefined {
  for (const { label, lettersOnly } of INVOICE_LABELS) {
    const match = findLabeledValues(lines, label, text =>
      asDocumentNumber(text, lettersOnly),
    )[0];
    if (match) return match.value;
  }
  return undefined;
}

// The first code among the next few tokens that is not a date or a CNPJ.
function asDocumentNumber(
  text: string,
  lettersOnly: boolean,
): string | undefined {
  const tokens = text.trim().split(/\s+/).slice(0, 3);
  for (const raw of tokens) {
    const token = raw.replace(/^[:#.\-º°]+|[:.,;-]+$/g, '');
    if (/^(?=.*\d)[A-Z0-9][A-Z0-9./-]*$/i.test(token)) {
      if (findDates(token).length > 0 || findCnpjs(token).length > 0) {
        return undefined;
      }
      return token.length <= 20 ? token : undefined;
    }
    if (lettersOnly && isLetterCode(raw, token)) return token;
  }
  return undefined;
}

// "CLIENTE:" ends in a colon because it is the next label, not a value.
function isLetterCode(raw: string, token: string): boolean {
  return (
    !raw.endsWith(':') &&
    LETTER_CODE.test(token) &&
    !NOT_A_CODE.test(fold(token))
  );
}

function extractOrderDate(lines: TextLine[]): string | undefined {
  for (const label of DATE_LABELS) {
    const match = findLabeledValues(lines, label, parseBrazilianDate).find(
      ({ labelCell }) => !NOT_ORDER_DATE.test(fold(labelCell.text)),
    );
    if (match) return match.value;
  }

  // No label: the first date on the first page that is not a due date.
  return lines
    .filter(line => line.page === lines[0]?.page)
    .filter(line => !NOT_ORDER_DATE.test(fold(lineText(line))))
    .map(line => parseBrazilianDate(lineText(line)))
    .find(date => date !== undefined);
}

function extractTotal(lines: TextLine[]): number | undefined {
  for (const { label, below } of TOTAL_LABELS) {
    const matches = findLabeledValues(lines, label, asAmount, {
      below,
    }).filter(({ labelCell }) => !NOT_GRAND_TOTAL.test(fold(labelCell.text)));
    // Totals close the document: with the same wording twice, the last wins.
    if (matches.length > 0) return matches.at(-1)?.value;
  }

  // Last resort: the products total.
  return findLabeledValues(lines, PRODUCTS_TOTAL, asAmount).at(-1)?.value;
}

// Cents required: otherwise "Total: 12 itens" reads as twelve reais.
function asAmount(text: string): number | undefined {
  return findMoneyValues(text).at(-1);
}

function defined<K extends string, V>(
  key: K,
  value: V | undefined,
): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V };
}
