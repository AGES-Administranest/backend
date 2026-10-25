import { findMoneyValues, parseBrazilianDate } from '../core/brazilian-formats';
import { anyWord, LabeledField } from '../core/labeled-field';

// Labels are matched on folded text: lowercase, without accents.

export const NOTE_NUMBER: LabeledField<string> = {
  labels: [
    /\bnumero\s+da\s+nfs-?e\b/,
    /\b(?:numero|n\s?[º°o]\.?)\s*(?:da\s+)?(?:nota|nfs-?e)\b/,
    /\bnfs-?e\s*(?:n\s?[º°o]\.?|numero)/,
  ],
  // The DPS (formerly RPS) is the declaration the note was issued from: its
  // number is not the note's.
  notThisField: anyWord(['dps', 'rps', 'chave']),
  parse: parseNoteNumber,
};

export const ISSUE_DATE: LabeledField<string> = {
  labels: [
    /\bdata\s+e\s+hora\s+da\s+emissao\s+da\s+nfs-?e\b/,
    /\bdata\s+(?:de|da)\s+emissao\b/,
    /\bemissao\b/,
    // Last resort: the month of the service, printed as its first day.
    /\bcompetencia\b/,
  ],
  notThisField: anyWord(['dps', 'rps', 'vencimento']),
  parse: parseBrazilianDate,
};

/** Before deductions and withheld taxes: the amount the income is booked at. */
export const GROSS_AMOUNT: LabeledField<number> = {
  labels: [
    /\bvalor\s+do\s+servico\b/,
    /\bvalor\s+(?:total\s+)?d[oa]s?\s+servicos?\b/,
    /\bvalor\s+total\s+da\s+(?:nota|nfs-?e)\b/,
  ],
  notThisField: anyWord([
    'liquido',
    'base de calculo',
    'iss',
    'issqn',
    'aliquota',
    'deducao',
    'deducoes',
    'desconto',
    'retido',
    'retidos',
  ]),
  parse: parseAmountWithCents,
};

// The 50-digit access key also sits under NFS-e labels, and no one types it.
const MAX_NOTE_NUMBER_DIGITS = 15;

/** The first all-digit token among the next three: `Nº 00342` → `00342`. */
function parseNoteNumber(text: string): string | undefined {
  return text
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .map(stripPunctuation)
    .find(isNoteNumber);
}

function stripPunctuation(token: string): string {
  return token.replace(/^[:#.\-º°]+|[:.,;-]+$/g, '');
}

function isNoteNumber(token: string): boolean {
  return /^\d+$/.test(token) && token.length <= MAX_NOTE_NUMBER_DIGITS;
}

// Cents required: otherwise a count ("3 itens") reads as an amount.
function parseAmountWithCents(text: string): number | undefined {
  return findMoneyValues(text)[0];
}
