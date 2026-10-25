import type { ExtractedTaker } from './nfse-result';
import { defined } from '../core/defined';
import { anyWord } from '../core/labeled-field';
import { findLabeledValues, fold } from '../core/labeled-value';
import { SectionTitle, sectionsOf } from '../core/sections';
import { findTaxId, unmaskTaxId } from '../core/tax-id';
import { TextLine } from '../core/text-lines';

type Section = 'header' | 'provider' | 'taker' | 'other';

// Titles are matched on the folded first cell of a line.
const SECTION_TITLES: SectionTitle<Section>[] = [
  { title: /^tomador\b/, section: 'taker' },
  { title: /^(?:emitente|prestador)\b/, section: 'provider' },
  {
    title:
      /^(?:intermediario|servico prestado|descricao do servico|discriminacao|tributacao|valor total|informacoes complementares)\b/,
    section: 'other',
  },
];

// "CNPJ / CPF / NIF" on the DANFSe, "CPF/CNPJ" on municipal layouts.
const TAX_ID_LABEL = /\b(?:cnpj|cpf)\b/;

const NAME_LABEL_WORDINGS = [
  String.raw`nome\s*\/\s*nome\s+empresarial`,
  String.raw`nome\s*\/\s*razao\s+social`,
  String.raw`razao\s+social`,
  'nome',
].join('|');
const NAME_LABEL = new RegExp(String.raw`\b(?:${NAME_LABEL_WORDINGS})\b`);
const ONLY_A_NAME_LABEL = new RegExp(String.raw`^(?:${NAME_LABEL_WORDINGS})$`);

// With the name box empty, the value read is the next box on the row.
const OTHER_FIELD = anyWord([
  'e-mail',
  'email',
  'endereco',
  'telefone',
  'municipio',
  'cep',
  'inscricao',
  'nome fantasia',
  'cnpj',
  'cpf',
  'nif',
]);

const MIN_NAME_LETTERS = 3;

/**
 * The clinic or hospital billed, read from its own block of the note. The
 * user is the provider: their own CNPJ/CPF is never the taker's.
 */
export function extractTaker(
  lines: TextLine[],
  providerTaxId?: string,
): ExtractedTaker | undefined {
  const sections = sectionsOf(lines, SECTION_TITLES, 'header');
  const takerBlock = lines.filter(line => sections.get(line) === 'taker');

  if (takerBlock.length === 0) {
    const outsideProvider = lines.filter(
      line => sections.get(line) !== 'provider',
    );
    const taxId = findTakerTaxId(outsideProvider, providerTaxId);
    // Without the taker's block, a name could be anyone's: left for the review.
    return taxId === undefined ? undefined : { taxId };
  }

  const taxId = findTakerTaxId(takerBlock, providerTaxId);
  const name = findTakerName(takerBlock);
  if (taxId === undefined && name === undefined) return undefined;
  return { ...defined('name', name), ...defined('taxId', taxId) };
}

// Only under a CNPJ/CPF label: an 11-digit phone can pass the CPF check digits.
function findTakerTaxId(
  lines: TextLine[],
  providerTaxId?: string,
): string | undefined {
  const provider = providerTaxId && unmaskTaxId(providerTaxId);
  return findLabeledValues(lines, TAX_ID_LABEL, findTaxId)
    .map(({ value }) => value)
    .find(taxId => taxId !== provider);
}

function findTakerName(takerBlock: TextLine[]): string | undefined {
  return findLabeledValues(takerBlock, NAME_LABEL, parsePartyName)[0]?.value;
}

/** A person's or a company's name, not the label of another box. */
function parsePartyName(text: string): string | undefined {
  const name = text.replace(/^[\s:.\-–]+|[\s:\-–]+$/g, '').trim();
  if (!isMostlyLetters(name)) return undefined;
  if (isAnotherField(name) || isNameLabel(name)) return undefined;
  return name;
}

function isMostlyLetters(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, '').length;
  const visible = text.replace(/\s/g, '').length;
  return letters >= MIN_NAME_LETTERS && letters >= visible / 2;
}

function isAnotherField(text: string): boolean {
  return text.includes('@') || OTHER_FIELD.test(fold(text));
}

function isNameLabel(text: string): boolean {
  return ONLY_A_NAME_LABEL.test(fold(text));
}
