import { compareAttributes, Comparison } from './attribute-comparison';
import { Attributes, extractAttributes } from './attributes';
import { normalize } from './normalize';
import { similarity } from './trigram';
import {
  FILLER_WORDS,
  flagWords,
  QUALIFYING_FLAGS,
  UNIT_DOSAGE_FORMS,
  UNITS,
  VARIANT_FLAGS,
  VARIANT_WORDS,
} from './vocabulary';

export type CatalogItem = { id: string; name: string; unit?: string };

export type RankedCandidate = { id: string; score: number };

/** A description read once: its words and what it says of the product. */
type ReadText = { words: string[]; attributes: Attributes };

type PreparedItem = ReadText & { id: string };

export type PreparedCatalog = {
  items: PreparedItem[];
  /** How much each name word tells items apart. */
  weights: Map<string, number>;
};

// Text decides most of the score; the measures the line confirms, the rest.
const TEXT_WEIGHT = 0.7;
// Each variant the line names and the item does not.
const VARIANT_PENALTY = 0.8;

// Supplier abbreviations are mostly truncations: "proced", "hipod", "desc".
const PREFIX_SIMILARITY = 0.9;
const MIN_PREFIX_LENGTH = 3;
const MIN_WORD_SIMILARITY = 0.6;
// A variant word cut this short still counts: "pediat".
const MIN_VARIANT_PREFIX = 5;

// "seringa com agulha" is a syringe: the qualifier is not a name word.
const QUALIFIER_WORD = flagWords(QUALIFYING_FLAGS).join('|');
const QUALIFIER = new RegExp(
  String.raw`\b(?:com|sem|nao)\s+(?:${QUALIFIER_WORD})\b`,
  'g',
);

export function prepareCatalog(catalogItems: CatalogItem[]): PreparedCatalog {
  const items = catalogItems.map(prepareItem);
  return { items, weights: wordWeights(items) };
}

/** Catalog items that can be the product on the line, best first. */
export function rankCandidates(
  catalog: PreparedCatalog,
  description: string,
): RankedCandidate[] {
  const line = readLine(description);
  return catalog.items
    .map(item => ({ id: item.id, score: score(line, item, catalog.weights) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score);
}

function prepareItem(item: CatalogItem): PreparedItem {
  const normalized = normalize(item.name);
  const attributes = extractAttributes(normalized);
  // A catalog name rarely states the dosage form; the unit it is counted in does.
  const unitForm = item.unit ? UNIT_DOSAGE_FORMS[item.unit] : undefined;
  if (attributes.dosageForms.length === 0 && unitForm) {
    attributes.dosageForms.push(unitForm);
  }
  const words = wordsOf(normalized).filter(word => !FILLER_WORDS.has(word));
  return { id: item.id, words: unique(words), attributes };
}

function readLine(description: string): ReadText {
  const normalized = normalize(description);
  return {
    words: unique(wordsOf(normalized)),
    attributes: extractAttributes(normalized),
  };
}

// Rare words tell items apart: "propofol" weighs more than "seringa".
function wordWeights(items: PreparedItem[]): Map<string, number> {
  const itemsWithWord = new Map<string, number>();
  for (const { words } of items) {
    for (const word of words) {
      itemsWithWord.set(word, (itemsWithWord.get(word) ?? 0) + 1);
    }
  }
  return new Map(
    [...itemsWithWord].map(([word, count]) => [
      word,
      Math.log(1 + items.length / count),
    ]),
  );
}

/**
 * How much of the catalog name the line covers, times how many of the item's
 * measures the line confirms, less each variant the line names and the item
 * does not. A measure the line contradicts rules the item out: text alone
 * cannot tell `Propofol 1%` from `Propofol 2%`.
 */
function score(
  line: ReadText,
  item: PreparedItem,
  weights: Map<string, number>,
): number {
  const comparison = compareAttributes(line.attributes, item.attributes);
  if (comparison.veto) return 0;

  return (
    nameCoverage(line.words, item.words, weights) *
    measureAgreement(comparison) *
    variantPenalty(line, item)
  );
}

function nameCoverage(
  lineWords: string[],
  itemWords: string[],
  weights: Map<string, number>,
): number {
  let covered = 0;
  let total = 0;
  for (const word of itemWords) {
    const weight = weights.get(word) ?? 1;
    total += weight;
    covered += weight * bestSimilarity(word, lineWords);
  }
  return total > 0 ? covered / total : 0;
}

function measureAgreement({ confirmed, unconfirmed }: Comparison): number {
  const checked = confirmed + unconfirmed;
  const agreement = checked > 0 ? confirmed / checked : 1;
  return TEXT_WEIGHT + (1 - TEXT_WEIGHT) * agreement;
}

function variantPenalty(line: ReadText, item: PreparedItem): number {
  const extraWords = line.words.filter(
    word => isVariantWord(word) && !item.words.includes(word),
  ).length;
  const extraFlags = VARIANT_FLAGS.filter(
    flag =>
      line.attributes.flags.get(flag) === true &&
      !item.attributes.flags.has(flag),
  ).length;
  return VARIANT_PENALTY ** (extraWords + extraFlags);
}

function isVariantWord(word: string): boolean {
  return VARIANT_WORDS.some(
    variant =>
      word === variant ||
      (word.length >= MIN_VARIANT_PREFIX && variant.startsWith(word)),
  );
}

function bestSimilarity(word: string, candidates: string[]): number {
  return Math.max(0, ...candidates.map(other => wordSimilarity(word, other)));
}

function wordSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= MIN_PREFIX_LENGTH && long.startsWith(short)) {
    return PREFIX_SIMILARITY;
  }
  const trigramScore = similarity(a, b);
  return trigramScore >= MIN_WORD_SIMILARITY ? trigramScore : 0;
}

// Words with letters only: numbers and units are the attributes' business.
function wordsOf(normalized: string): string[] {
  return normalized
    .replace(QUALIFIER, ' ')
    .split(/[\s/]+/)
    .filter(word => /[a-z]/.test(word) && !/\d/.test(word) && !UNITS.has(word));
}

function unique(words: string[]): string[] {
  return [...new Set(words)];
}
