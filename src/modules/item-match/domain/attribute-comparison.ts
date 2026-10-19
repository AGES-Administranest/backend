import { Attributes } from './attributes';

export type Comparison = {
  /** A stated measure the other side contradicts: never the same product. */
  veto: boolean;
  /** Catalog measures the line states too, with the same value. */
  confirmed: number;
  /** Catalog measures the line does not state. */
  unconfirmed: number;
};

type Verdict = 'confirmed' | 'unconfirmed' | 'veto';

const MEASURES = [
  'concentrations',
  'volumes',
  'masses',
  'lengths',
  'gauges',
  'packageCounts',
] as const;

type Measure = (typeof MEASURES)[number];

/**
 * How the line's attributes stand against the catalog item's. Each thing the
 * item states gets a verdict: only what both sides state can veto, and what
 * the line leaves out is just unconfirmed.
 */
export function compareAttributes(
  line: Attributes,
  item: Attributes,
): Comparison {
  const verdicts = [
    ...compareMeasures(line, item),
    ...compareDimensions(line, item),
    ...compareSizes(line, item),
    ...compareFlags(line, item),
    ...compareBareNumbers(line, item),
  ];

  return {
    veto: verdicts.includes('veto') || dosageFormsDiffer(line, item),
    confirmed: verdicts.filter(verdict => verdict === 'confirmed').length,
    unconfirmed: verdicts.filter(verdict => verdict === 'unconfirmed').length,
  };
}

function compareMeasures(line: Attributes, item: Attributes): Verdict[] {
  return MEASURES.filter(measure => item[measure].length > 0).map(measure => {
    const stated = statedBy(line, measure);
    if (stated.length > 0) {
      return overlaps(stated, item[measure]) ? 'confirmed' : 'veto';
    }
    // "CATETER 22" states the gauge without its unit.
    return overlaps(line.bareNumbers, item[measure])
      ? 'confirmed'
      : 'unconfirmed';
  });
}

// "Esparadrapo 10cm" is compared with both sides of "5cmx4.5m".
function statedBy(line: Attributes, measure: Measure): number[] {
  return measure === 'lengths'
    ? [...line.lengths, ...line.dimensions.flat()]
    : line[measure];
}

function compareDimensions(line: Attributes, item: Attributes): Verdict[] {
  if (item.dimensions.length === 0) return [];
  if (line.dimensions.length === 0) return ['unconfirmed'];

  const same = line.dimensions.some(([a, b]) =>
    item.dimensions.some(([c, d]) => equal(a, c) && equal(b, d)),
  );
  return [same ? 'confirmed' : 'veto'];
}

function compareSizes(line: Attributes, item: Attributes): Verdict[] {
  if (item.sizes.length === 0) return [];
  if (line.sizes.length === 0) return ['unconfirmed'];

  const same = line.sizes.some(size => item.sizes.includes(size));
  return [same ? 'confirmed' : 'veto'];
}

function compareFlags(line: Attributes, item: Attributes): Verdict[] {
  return [...item.flags].map(([flag, value]) => {
    const stated = line.flags.get(flag);
    if (stated === undefined) return 'unconfirmed';
    return stated === value ? 'confirmed' : 'veto';
  });
}

// "Zoletil 50": a line that numbers something else ("ZOLETIL 100") is another
// product; one that numbers nothing may just leave it out.
function compareBareNumbers(line: Attributes, item: Attributes): Verdict[] {
  const numbersSomething =
    line.bareNumbers.length > 0 || line.lengths.length > 0;
  return item.bareNumbers.map(number => {
    if (overlaps(line.allNumbers, [number])) return 'confirmed';
    return numbersSomething ? 'veto' : 'unconfirmed';
  });
}

// Only vetoes: a catalog name rarely states the form, its unit does.
function dosageFormsDiffer(line: Attributes, item: Attributes): boolean {
  return (
    line.dosageForms.length > 0 &&
    item.dosageForms.length > 0 &&
    !line.dosageForms.some(form => item.dosageForms.includes(form))
  );
}

function overlaps(a: number[], b: number[]): boolean {
  return a.some(x => b.some(y => equal(x, y)));
}

function equal(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}
