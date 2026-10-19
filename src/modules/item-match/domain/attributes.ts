import {
  DOSAGE_FORM_WORDS,
  DosageForm,
  Flag,
  FLAG_WORDS,
  flagWords,
  FLAGS_NAMED_ALONE,
  SIZE_WORDS,
} from './vocabulary';

/** What a normalized description says about the product, in fixed units. */
export type Attributes = {
  /** mg/mL: `1%`, `10mg/ml`, `1:1000`. */
  concentrations: number[];
  /** mL */
  volumes: number[];
  /** mg */
  masses: number[];
  /** As printed, without converting mm, cm and m. */
  lengths: number[];
  /** Sorted pairs: `25x7`, `7.5x7.5`. */
  dimensions: [number, number][];
  /** Catheter and needle gauges: `22g`. */
  gauges: number[];
  /** Units per package: `caixa 100`, `com 10`. */
  packageCounts: number[];
  sizes: string[];
  dosageForms: DosageForm[];
  /** `true` for "com", `false` for "sem" or "nao". */
  flags: Map<Flag, boolean>;
  /** Numbers standing alone: `nº 4.0`, `Zoletil 50`. */
  bareNumbers: number[];
  /** Every number in the text, plus the measures read from it. */
  allNumbers: number[];
};

// 10mg/ml, 50mcg/ml, 200mg/20ml
const MASS_PER_VOLUME = /(\d+(?:\.\d+)?)(mcg|mg|g)\/(\d+(?:\.\d+)?)?ml\b/g;
// 1%
const PERCENT = /(\d+(?:\.\d+)?)%/g;
// 1:1000, the way epinephrine is written: 1 g in 1000 mL.
const RATIO = /\b1:(\d{1,3}(?:\.\d{3})+|\d+)\b/g;
// 20ml, 1l, 10cc, and not the "ml" of "mg/ml"
const VOLUME = /(?:^|[\s/])(\d+(?:\.\d+)?)(ml|l|cc)\b(?!\/)/g;
// 500mg, 1g, 22g, and not the "mg" of "mg/ml"
const MASS = /(?:^|\s)(\d+(?:\.\d+)?)(mcg|mg|g|kg)\b(?!\/)/g;
// 10cm, 4.5m
const LENGTH = /(?:^|\s)(\d+(?:\.\d+)?)(mm|cm|m)\b/g;
// 25x7, 7.5x7.5
const DIMENSION = /(?:^|\s)(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)(?=\s|$)/g;
// caixa 100, com 10
const PACKAGE_COUNT = /\b(?:com|caixa|pacote|embalagem)\s+(\d+)(?=\s|$)/g;
const NUMBER = /\d+(?:\.\d+)?/g;
const WHOLE_NUMBER = /^\d+(?:\.\d+)?$/;

const ANY_FLAG_WORD = flagWords(Object.keys(FLAG_WORDS) as Flag[]).join('|');
const WORD_NAMED_ALONE = flagWords(FLAGS_NAMED_ALONE).join('|');
// "sem vaso", "com agulha", "nao esteril"
const FLAG_AFTER_MODE = new RegExp(
  String.raw`\b(com|sem|nao)\s+(${ANY_FLAG_WORD})\b`,
  'g',
);
// "cuff", "esteril", not preceded by com, sem or nao
const FLAG_NAMED_ALONE = new RegExp(
  String.raw`(?<!\b(?:com|sem|nao)\s)\b(${WORD_NAMED_ALONE})\b`,
  'g',
);
const DOSAGE_FORM_PATTERNS = Object.entries(DOSAGE_FORM_WORDS).map(
  ([form, words]) => ({
    form: form as DosageForm,
    pattern: new RegExp(String.raw`\b(?:${words.join('|')})\b`),
  }),
);

const MG_PER: Record<string, number> = {
  mcg: 0.001,
  mg: 1,
  g: 1000,
  kg: 1_000_000,
};
const ML_PER: Record<string, number> = { ml: 1, cc: 1, l: 1000 };

// "22g" on a catheter is a gauge, not 22 grams.
const MIN_GAUGE = 14;
const MAX_GAUGE = 34;

export function extractAttributes(normalized: string): Attributes {
  const words = normalized.split(' ');
  const { masses, gauges } = readMassesAndGauges(normalized);
  const volumes = readVolumes(normalized);
  const concentrations = readConcentrations(normalized, masses, volumes);
  const packageCounts = readPackageCounts(normalized);

  return {
    concentrations,
    volumes,
    masses,
    lengths: readLengths(normalized),
    dimensions: readDimensions(normalized),
    gauges,
    packageCounts,
    sizes: words.filter(word => SIZE_WORDS.has(word)),
    dosageForms: readDosageForms(normalized),
    flags: readFlags(normalized),
    bareNumbers: readBareNumbers(words, packageCounts),
    allNumbers: [
      ...findAll(NUMBER, normalized).map(([number]) => Number(number)),
      ...concentrations,
      ...volumes,
      ...masses,
    ],
  };
}

function readConcentrations(
  normalized: string,
  masses: number[],
  volumes: number[],
): number[] {
  const stated = [
    ...findAll(MASS_PER_VOLUME, normalized).map(
      ([, amount, unit, volume]) =>
        (Number(amount) * MG_PER[unit]) / Number(volume ?? 1),
    ),
    ...findAll(PERCENT, normalized).map(([, percent]) => Number(percent) * 10),
    ...findAll(RATIO, normalized).map(
      ([, parts]) => 1000 / Number(parts.replace(/\./g, '')),
    ),
  ];
  if (stated.length > 0) return stated;

  // "TRAMADOL 100MG INJ AMP 2ML": one mass in one volume.
  if (masses.length === 1 && volumes.length === 1) {
    return [masses[0] / volumes[0]];
  }
  return [];
}

function readVolumes(normalized: string): number[] {
  return findAll(VOLUME, normalized).map(
    ([, amount, unit]) => Number(amount) * ML_PER[unit],
  );
}

function readMassesAndGauges(normalized: string) {
  const masses: number[] = [];
  const gauges: number[] = [];
  for (const [, amount, unit] of findAll(MASS, normalized)) {
    const value = Number(amount);
    if (isGauge(value, unit)) gauges.push(value);
    else masses.push(value * MG_PER[unit]);
  }
  return { masses, gauges };
}

function isGauge(value: number, unit: string): boolean {
  return (
    unit === 'g' &&
    Number.isInteger(value) &&
    value >= MIN_GAUGE &&
    value <= MAX_GAUGE
  );
}

function readLengths(normalized: string): number[] {
  return findAll(LENGTH, normalized).map(([, amount]) => Number(amount));
}

function readDimensions(normalized: string): [number, number][] {
  return findAll(DIMENSION, normalized).map(([, a, b]) =>
    asNeedleSize(Number(a), Number(b)),
  );
}

// Needles print diameter × length in mm (`0.70x25`) as well as length × tenths
// of a mm (`25x7`); both become `[7, 25]`.
function asNeedleSize(a: number, b: number): [number, number] {
  const [small, large] = a <= b ? [a, b] : [b, a];
  const scaled = small < 2 && large >= 10 ? small * 10 : small;
  return scaled <= large ? [scaled, large] : [large, scaled];
}

function readPackageCounts(normalized: string): number[] {
  return findAll(PACKAGE_COUNT, normalized).map(([, count]) => Number(count));
}

// A package count is not a bare number: "cx c/ 10" says nothing of the item.
function readBareNumbers(words: string[], packageCounts: number[]): number[] {
  const numbers = words.filter(word => WHOLE_NUMBER.test(word)).map(Number);
  for (const count of packageCounts) {
    numbers.splice(numbers.indexOf(count), 1);
  }
  return numbers;
}

function readDosageForms(normalized: string): DosageForm[] {
  return DOSAGE_FORM_PATTERNS.filter(({ pattern }) =>
    pattern.test(normalized),
  ).map(({ form }) => form);
}

function readFlags(normalized: string): Map<Flag, boolean> {
  const flags = new Map<Flag, boolean>();
  for (const [, word] of findAll(FLAG_NAMED_ALONE, normalized)) {
    flags.set(flagOf(word), true);
  }
  for (const [, mode, word] of findAll(FLAG_AFTER_MODE, normalized)) {
    flags.set(flagOf(word), mode === 'com');
  }
  return flags;
}

function flagOf(word: string): Flag {
  const [flag] = Object.entries(FLAG_WORDS).find(([, words]) =>
    words.includes(word),
  ) as [Flag, string[]];
  return flag;
}

function findAll(pattern: RegExp, text: string): RegExpExecArray[] {
  return [...text.matchAll(pattern)];
}
