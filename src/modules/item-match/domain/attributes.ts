export type Form = 'injectable' | 'oral' | 'topical' | 'inhaled';
export type Flag = 'vaso' | 'cuff' | 'agulha' | 'po' | 'esteril';

/** Measures in canonical units, read from a normalized description. */
export type Attributes = {
  /** mg/mL */
  concentrations: number[];
  /** mL */
  volumes: number[];
  /** mg */
  masses: number[];
  lengths: number[];
  /** Sorted pairs: `25x7`, `7.5x7.5`. */
  dimensions: [number, number][];
  gauges: number[];
  /** Units per package: `cx c/ 100`. */
  counts: number[];
  sizes: string[];
  forms: Form[];
  flags: Map<Flag, boolean>;
  /** Numbers with no unit: `nº 4,0`, `Zoletil 50`. */
  bareNumbers: number[];
  allNumbers: number[];
};

const NUM = String.raw`(\d+(?:\.\d+)?)`;
const CONCENTRATION = new RegExp(
  String.raw`${NUM}(mcg|mg|g)\/${NUM}?ml\b`,
  'g',
);
const PERCENT = new RegExp(String.raw`${NUM}%`, 'g');
// 1 g in N mL: epinephrine's 1:1000.
const RATIO = /\b1:(\d{1,3}(?:\.\d{3})+|\d+)\b/g;
const VOLUME = new RegExp(String.raw`(?:^|[\s/])${NUM}(ml|l|cc)\b(?!\/)`, 'g');
const MASS = new RegExp(String.raw`(?:^|\s)${NUM}(mcg|mg|g|kg)\b(?!\/)`, 'g');
const LENGTH = new RegExp(String.raw`(?:^|\s)${NUM}(mm|cm|m)\b`, 'g');
const DIMENSION = new RegExp(String.raw`(?:^|\s)${NUM}x${NUM}(?=\s|$)`, 'g');
const COUNT = /\b(?:com|caixa|pacote|embalagem)\s+(\d+)(?=\s|$)/g;
const FLAG =
  /\b(com|sem|nao)\s+(v|vaso|vasoconstritor|adrenalina|cuff|agulha|po|esteril)\b/g;
const PLAIN_FLAG = /(?<!\b(?:com|sem|nao)\s)\b(cuff|esteril)\b/g;

const SIZES = new Set(['pp', 'p', 'm', 'g', 'gg', 'xg', 'eg']);
const MIN_GAUGE = 14;
const MAX_GAUGE = 34;

const FORM_WORDS: Record<Form, RegExp> = {
  injectable:
    /\b(?:ampola|amp|inj|injetavel|iv|im|liof|liofilizado|endovenoso)\b/,
  oral: /\b(?:comprimidos?|comp|capsulas?|caps|gotas|oral|xarope|orodispersivel|drageas?|mastigavel)\b/,
  topical: /\b(?:geleia|gel|pomada|creme|bisnaga|topico|topica)\b/,
  inhaled: /\b(?:inalacao|inal|inalatorio)\b/,
};

const MASS_IN_MG: Record<string, number> = {
  mcg: 0.001,
  mg: 1,
  g: 1000,
  kg: 1_000_000,
};
const VOLUME_IN_ML: Record<string, number> = { ml: 1, cc: 1, l: 1000 };

export function extractAttributes(normalized: string): Attributes {
  const concentrations = [
    ...matches(CONCENTRATION, normalized).map(
      ([, amount, unit, volume]) =>
        (Number(amount) * MASS_IN_MG[unit]) / Number(volume ?? 1),
    ),
    ...matches(PERCENT, normalized).map(([, percent]) => Number(percent) * 10),
    ...matches(RATIO, normalized).map(
      ([, parts]) => 1000 / Number(parts.replace(/\./g, '')),
    ),
  ];
  const volumes = matches(VOLUME, normalized).map(
    ([, amount, unit]) => Number(amount) * VOLUME_IN_ML[unit],
  );

  const gauges: number[] = [];
  const masses: number[] = [];
  for (const [, amount, unit] of matches(MASS, normalized)) {
    const value = Number(amount);
    const isGauge =
      unit === 'g' &&
      Number.isInteger(value) &&
      value >= MIN_GAUGE &&
      value <= MAX_GAUGE;
    if (isGauge) gauges.push(value);
    else masses.push(value * MASS_IN_MG[unit]);
  }
  if (concentrations.length === 0 && masses.length === 1) {
    if (volumes.length === 1) concentrations.push(masses[0] / volumes[0]);
  }

  const counts = matches(COUNT, normalized).map(([, count]) => Number(count));
  const tokens = normalized.split(' ');
  const bareNumbers = tokens
    .filter(token => /^\d+(?:\.\d+)?$/.test(token))
    .map(Number);
  for (const count of counts) {
    bareNumbers.splice(bareNumbers.indexOf(count), 1);
  }

  return {
    concentrations,
    volumes,
    masses,
    lengths: matches(LENGTH, normalized).map(([, amount]) => Number(amount)),
    dimensions: matches(DIMENSION, normalized).map(([, a, b]) =>
      asPair(Number(a), Number(b)),
    ),
    gauges,
    counts,
    sizes: tokens.filter(token => SIZES.has(token)),
    forms: (Object.keys(FORM_WORDS) as Form[]).filter(form =>
      FORM_WORDS[form].test(normalized),
    ),
    flags: flagsOf(normalized),
    bareNumbers,
    allNumbers: [
      ...(normalized.match(/\d+(?:\.\d+)?/g) ?? []).map(Number),
      ...concentrations,
      ...volumes,
      ...masses,
    ],
  };
}

// Needles print diameter × length in mm (`0,70x25`) as well as length × tenths
// of a mm (`25x7`).
function asPair(a: number, b: number): [number, number] {
  const [small, large] = a <= b ? [a, b] : [b, a];
  const scaled = small < 2 && large >= 10 ? small * 10 : small;
  return scaled <= large ? [scaled, large] : [large, scaled];
}

function flagsOf(normalized: string): Map<Flag, boolean> {
  const flags = new Map<Flag, boolean>();
  for (const [, word] of matches(PLAIN_FLAG, normalized)) {
    flags.set(word as Flag, true);
  }
  for (const [, mode, word] of matches(FLAG, normalized)) {
    const flag = ['v', 'vasoconstritor', 'adrenalina'].includes(word)
      ? 'vaso'
      : (word as Flag);
    flags.set(flag, mode === 'com');
  }
  return flags;
}

export type Comparison = {
  /** A stated measure the other side contradicts: never the same product. */
  veto: boolean;
  /** Catalog measures the document states too, with the same value. */
  confirmed: number;
  /** Catalog measures the document does not state. */
  unconfirmed: number;
};

type NumericKey =
  'concentrations' | 'volumes' | 'masses' | 'lengths' | 'gauges' | 'counts';
const NUMERIC_KEYS: NumericKey[] = [
  'concentrations',
  'volumes',
  'masses',
  'lengths',
  'gauges',
  'counts',
];

/**
 * How the document's measures stand against the catalog item's. Only what
 * both sides state can veto; a measure the document leaves out is only
 * unconfirmed, and one it prints bare (`CATETER 22`) still confirms.
 */
export function compareAttributes(
  doc: Attributes,
  item: Attributes,
): Comparison {
  const result: Comparison = { veto: false, confirmed: 0, unconfirmed: 0 };
  const tally = (outcome: 'confirmed' | 'unconfirmed' | 'veto') => {
    if (outcome === 'veto') result.veto = true;
    else result[outcome]++;
  };

  for (const key of NUMERIC_KEYS) {
    if (item[key].length === 0) continue;
    // `Esparadrapo 10cm` against `5cmx4,5m`.
    const stated =
      key === 'lengths' ? [...doc.lengths, ...doc.dimensions.flat()] : doc[key];
    if (stated.length > 0) {
      tally(overlaps(stated, item[key]) ? 'confirmed' : 'veto');
    } else {
      tally(overlaps(doc.bareNumbers, item[key]) ? 'confirmed' : 'unconfirmed');
    }
  }

  if (item.dimensions.length > 0) {
    if (doc.dimensions.length === 0) tally('unconfirmed');
    else {
      const same = doc.dimensions.some(([a, b]) =>
        item.dimensions.some(([c, d]) => equal(a, c) && equal(b, d)),
      );
      tally(same ? 'confirmed' : 'veto');
    }
  }

  if (item.sizes.length > 0) {
    if (doc.sizes.length === 0) tally('unconfirmed');
    else
      tally(
        doc.sizes.some(size => item.sizes.includes(size))
          ? 'confirmed'
          : 'veto',
      );
  }

  for (const [flag, value] of item.flags) {
    const stated = doc.flags.get(flag);
    if (stated === undefined) tally('unconfirmed');
    else tally(stated === value ? 'confirmed' : 'veto');
  }

  for (const number of item.bareNumbers) {
    if (overlaps(doc.allNumbers, [number])) tally('confirmed');
    else if (doc.bareNumbers.length > 0 || doc.lengths.length > 0)
      tally('veto');
    else tally('unconfirmed');
  }

  // Forms only veto: a catalog name rarely says it, the unit does.
  if (
    doc.forms.length > 0 &&
    item.forms.length > 0 &&
    !doc.forms.some(form => item.forms.includes(form))
  ) {
    result.veto = true;
  }

  return result;
}

function overlaps(a: number[], b: number[]): boolean {
  return a.some(x => b.some(y => equal(x, y)));
}

function equal(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

function matches(pattern: RegExp, text: string): RegExpExecArray[] {
  return [...text.matchAll(pattern)];
}
