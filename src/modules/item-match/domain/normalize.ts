import { ABBREVIATIONS, SYNONYMS, UNITS } from './vocabulary';

/**
 * The same form for a document line and a catalog name: no accents, lowercase,
 * decimal point, measures glued to their unit (`20ml`), sizes as `25x7`,
 * shorthand spelled out and synonyms written one way. The order matters.
 */
const STEPS: ((text: string) => string)[] = [
  removeAccents,
  lowercase,
  dropLotAndExpiry,
  useDecimalPoint,
  spaceOutSizes,
  spellOutShorthand,
  separateNumbersFromWords,
  glueUnitsToNumbers,
  writeSizesAsAxB,
  removePunctuation,
  expandAbbreviations,
  applySynonyms,
];

export function normalize(text: string): string {
  return STEPS.reduce((result, step) => step(result), text);
}

function removeAccents(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function lowercase(text: string): string {
  return text.toLowerCase();
}

// A DANFE appends "Lote: D25H071 Val: 31/07/2027" to the description.
function dropLotAndExpiry(text: string): string {
  return text
    .replace(/\blote?\b\s*:?\s*\S+/g, ' ')
    .replace(/\bval(?:idade)?\b\s*:?\s*\d{1,2}\/\d{2,4}(?:\/\d{2,4})?/g, ' ');
}

// 0,5 → 0.5
function useDecimalPoint(text: string): string {
  return text.replace(/(\d),(\d)/g, '$1.$2');
}

// 10cmx4.5m → 10cm x 4.5m, before the next steps read "cmx" as a word.
function spaceOutSizes(text: string): string {
  return text.replace(/(\d(?:mm|cm|m)?)\s*x\s*(?=\d)/g, '$1 x ');
}

// c/ → com, s/ → sem, p/ → para, litro → l
function spellOutShorthand(text: string): string {
  return text
    .replace(/\b([cs])\/\s*/g, (_, letter: string) =>
      letter === 'c' ? ' com ' : ' sem ',
    )
    .replace(/\bp\/\s*/g, ' para ')
    .replace(/\blitros?\b/g, 'l');
}

// cx100 → cx 100, 5amp → 5 amp; a unit stays glued: 20ml.
function separateNumbersFromWords(text: string): string {
  return text
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z]+)\b/g, (match, digit: string, letters: string) =>
      UNITS.has(letters) ? match : `${digit} ${letters}`,
    );
}

// 20 ml → 20ml
function glueUnitsToNumbers(text: string): string {
  return text.replace(/(\d)\s+(mcg|mg|g|kg|ml|l|cc|ui|cm|mm|m)\b/g, '$1$2');
}

// 25 x 7 mm → 25x7, 10cm x 4.5m → 10x4.5
function writeSizesAsAxB(text: string): string {
  return text.replace(
    /(\d+(?:\.\d+)?)(?:mm|cm|m)?\s*x\s*(\d+(?:\.\d+)?)(?:mm|cm|m)?\b/g,
    '$1x$2',
  );
}

// Keeps what measures are written with: %, decimal point, slash and colon.
function removePunctuation(text: string): string {
  return text.replace(/[^a-z0-9%./: ]/g, ' ');
}

// Word by word, after trimming the dot of "amp." and the colon of "lote:".
function expandAbbreviations(text: string): string {
  return text
    .split(/\s+/)
    .map(word => word.replace(/^[./:]+|[./:]+$/g, ''))
    .filter(Boolean)
    .map(word => ABBREVIATIONS[word] ?? word)
    .join(' ');
}

function applySynonyms(text: string): string {
  return SYNONYMS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
}
