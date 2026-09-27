import {
  Attributes,
  compareAttributes,
  extractAttributes,
  Flag,
  Form,
} from './attributes';
import { normalize, UNITS } from './normalize';
import { similarity } from './trigram';

export type CatalogItem = { id: string; name: string; unit?: string };

type PreparedItem = {
  id: string;
  tokens: string[];
  attributes: Attributes;
};

export type PreparedCatalog = {
  items: PreparedItem[];
  weights: Map<string, number>;
};

export type RankedCandidate = { id: string; score: number };

// Words that name no product: packaging, dosage forms, filler.
const IGNORED = new Set([
  ...['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'para', 'com'],
  ...['sem', 'nao', 'uso', 'n', 'no', 'tam', 'tamanho', 'x', 'c', 's', 'p'],
  ...['un', 'und', 'unid', 'unidade', 'unidades', 'emb', 'embalagem'],
  ...['ampola', 'amp', 'frasco', 'caixa', 'pacote', 'bolsa', 'bisnaga'],
  ...['galao', 'rolo', 'envelope', 'injetavel', 'inj', 'solucao', 'sol'],
  ...['emulsao', 'po', 'liofilizado', 'comprimido', 'comp', 'capsula'],
  ...['gotas', 'oral', 'descartavel', 'esteril', 'cuff', 'sistema'],
  ...['fechado', 'vet', 'veterinario'],
]);
const FLAG_PHRASE =
  /\b(?:com|sem|nao)\s+(?:v|vaso|vasoconstritor|adrenalina|agulha|po)\b/g;

// Variants the catalog name would say if the item were one: a line that has
// one the name lacks is never preselected.
const MODIFIERS = [
  ...['fotossensivel', 'aramado', 'preenchida', 'flush', 'bureta'],
  ...['nitrilica', 'nitrilo', 'nitrila', 'vinil', 'hiperbarica'],
  ...['pediatrico', 'neonatal', 'infantil', 'raqui', 'peridural', 'espinhal'],
  ...['heparinizada', 'gasometria'],
];
const MODIFIER_FACTOR = 0.8;
// Stated by the line and left unsaid by the name, these read as variants too:
// a syringe with a needle is another product. Sterile and powdered are the
// default, so they are not.
const VARIANT_FLAGS: Flag[] = ['agulha', 'vaso', 'cuff'];

// Not VIAL: the app calls it "frasco", which holds inhalants, oral solutions and
// antiseptics as well.
const UNIT_FORMS: Record<string, Form> = {
  AMPOULE: 'injectable',
  TABLET: 'oral',
};

// Supplier abbreviations are mostly truncations: "proced", "hipod", "desc".
const PREFIX_SIMILARITY = 0.9;
const MIN_PREFIX_LENGTH = 3;
const MIN_TOKEN_SIMILARITY = 0.6;

const TEXT_WEIGHT = 0.7;

export function prepareCatalog(items: CatalogItem[]): PreparedCatalog {
  const prepared = items.map(item => {
    const normalized = normalize(item.name);
    const attributes = extractAttributes(normalized);
    const unitForm = item.unit ? UNIT_FORMS[item.unit] : undefined;
    if (attributes.forms.length === 0 && unitForm) {
      attributes.forms.push(unitForm);
    }
    return {
      id: item.id,
      tokens: [...new Set(nameTokens(normalized))],
      attributes,
    };
  });

  const frequency = new Map<string, number>();
  for (const { tokens } of prepared) {
    for (const token of tokens) {
      frequency.set(token, (frequency.get(token) ?? 0) + 1);
    }
  }
  // Rare words tell items apart: "propofol" weighs more than "seringa".
  const weights = new Map(
    [...frequency].map(([token, count]) => [
      token,
      Math.log(1 + prepared.length / count),
    ]),
  );

  return { items: prepared, weights };
}

/** Catalog items that can be the product on the line, best first. */
export function rankCandidates(
  catalog: PreparedCatalog,
  description: string,
): RankedCandidate[] {
  const normalized = normalize(description);
  const attributes = extractAttributes(normalized);
  const tokens = [...new Set(words(normalized))];

  return catalog.items
    .map(item => ({
      id: item.id,
      score: scoreCandidate(tokens, attributes, item, catalog.weights),
    }))
    .filter((candidate): candidate is RankedCandidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
}

/**
 * How much of the catalog name the line covers, weighted by how rare each
 * word is, scaled by how many of the item's measures the line confirms. A
 * measure the line contradicts vetoes the item: text alone cannot tell
 * `Propofol 1%` from `Propofol 2%`.
 */
export function scoreCandidate(
  docTokens: string[],
  docAttributes: Attributes,
  item: PreparedItem,
  weights: Map<string, number>,
): number {
  const comparison = compareAttributes(docAttributes, item.attributes);
  if (comparison.veto) return 0;

  let covered = 0;
  let total = 0;
  for (const token of item.tokens) {
    const weight = weights.get(token) ?? 1;
    total += weight;
    covered +=
      weight *
      Math.max(0, ...docTokens.map(doc => tokenSimilarity(token, doc)));
  }
  const coverage = total > 0 ? covered / total : 0;

  const checked = comparison.confirmed + comparison.unconfirmed;
  const agreement = checked > 0 ? comparison.confirmed / checked : 1;
  const extraModifiers =
    docTokens.filter(token => isModifier(token) && !item.tokens.includes(token))
      .length +
    VARIANT_FLAGS.filter(
      flag =>
        docAttributes.flags.get(flag) === true &&
        !item.attributes.flags.has(flag),
    ).length;
  return (
    coverage *
    (TEXT_WEIGHT + (1 - TEXT_WEIGHT) * agreement) *
    MODIFIER_FACTOR ** extraModifiers
  );
}

// "com agulha" qualifies a syringe; it does not name the needle.
function words(normalized: string): string[] {
  return normalized
    .replace(FLAG_PHRASE, ' ')
    .split(/[\s/]+/)
    .filter(isWord);
}

function nameTokens(normalized: string): string[] {
  return words(normalized).filter(token => !IGNORED.has(token));
}

function isModifier(token: string): boolean {
  return MODIFIERS.some(
    modifier =>
      token === modifier || (token.length >= 5 && modifier.startsWith(token)),
  );
}

function isWord(token: string): boolean {
  return /[a-z]/.test(token) && !/\d/.test(token) && !UNITS.has(token);
}

function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= MIN_PREFIX_LENGTH && long.startsWith(short)) {
    return PREFIX_SIMILARITY;
  }
  const score = similarity(a, b);
  return score >= MIN_TOKEN_SIMILARITY ? score : 0;
}
