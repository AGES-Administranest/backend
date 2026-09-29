/**
 * `R$ 1.234,56`, `5,000` (five), `1.000` (a thousand). A dot alone is a thousands
 * separator only when it groups exactly three digits.
 */
export function parseBrazilianNumber(raw: string): number | undefined {
  const text = raw.replace(/R\$/gi, '').replace(/\s/g, '');
  const negative = text.startsWith('-');
  const body = negative ? text.slice(1) : text;

  let normalized: string;
  if (/^\d{1,3}(\.\d{3})*,\d+$|^\d+,\d+$/.test(body)) {
    normalized = body.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(body)) {
    normalized = body.replace(/\./g, '');
  } else if (/^\d+(\.\d+)?$/.test(body)) {
    normalized = body;
  } else {
    return undefined;
  }

  const value = Number(normalized);
  return negative ? -value : value;
}

const LEADING_NUMBER = /^\s*(-?(?:R\$\s*)?\d[\d.,]*)(?=\s|$)/;

/** `5 CX` → 5. Anchored: `PROPOFOL 10MG/ML` holds a number but is not one. */
export function parseLeadingNumber(text: string): number | undefined {
  const token = LEADING_NUMBER.exec(text)?.[1];
  return token === undefined
    ? undefined
    : parseBrazilianNumber(token.replace(/[.,]+$/, ''));
}

const MONEY = /(?:R\$\s*)?-?(?:\d{1,3}(?:\.\d{3})+|\d+),\d{2}(?!\d)/g;

/** Amounts with cents, in order. */
export function findMoneyValues(text: string): number[] {
  return [...text.matchAll(MONEY)]
    .map(match => parseBrazilianNumber(match[0]))
    .filter(value => value !== undefined);
}

const DATE = /(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?!\d)/g;

const MONTHS = [
  'janeiro',
  'fevereiro',
  'marco',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];
// Matched without accents: "março" and "marco" both read.
const WRITTEN_DATE = new RegExp(
  String.raw`(?<!\d)(\d{1,2})\s+de\s+(${MONTHS.join('|')})\s+de\s+(\d{4})(?!\d)`,
  'gi',
);

/**
 * Real calendar dates as `YYYY-MM-DD`, in order. Impossible dates (31/02) are
 * skipped, which also keeps CNPJ fragments out.
 */
export function findDates(text: string): string[] {
  const plain = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const numeric = [...text.matchAll(DATE)].map(match => ({
    index: match.index,
    date: toIsoDate(Number(match[1]), Number(match[2]), Number(match[3])),
  }));
  const written = [...plain.matchAll(WRITTEN_DATE)].map(match => ({
    index: match.index,
    date: toIsoDate(
      Number(match[1]),
      MONTHS.indexOf(match[2].toLowerCase()) + 1,
      Number(match[3]),
    ),
  }));
  return [...numeric, ...written]
    .sort((a, b) => a.index - b.index)
    .map(found => found.date)
    .filter(date => date !== undefined);
}

export function parseBrazilianDate(text: string): string | undefined {
  return findDates(text)[0];
}

function toIsoDate(
  day: number,
  month: number,
  year: number,
): string | undefined {
  const fullYear = year < 100 ? 2000 + year : year;
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  const exists =
    date.getUTCFullYear() === fullYear &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  return exists ? date.toISOString().slice(0, 10) : undefined;
}
