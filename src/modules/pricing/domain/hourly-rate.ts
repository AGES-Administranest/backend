import { Prisma } from '@prisma/client';

/**
 * The billable-hour value (US20). Pure arithmetic: no Nest, no Prisma Client.
 *
 *   margin      = margin % × (fixed costs + variable costs + owner's draw)
 *   hourly rate = (fixed costs + variable costs + owner's draw + margin)
 *                 ÷ productive hours per month
 *
 * Everything stays in `Decimal`, as in `vehicle-cost.ts`: going through
 * `number` would bring binary floating-point error into money.
 */

export type DecimalInput = Prisma.Decimal | number | string;

/** The parts of the formula, in the order the app shows them. */
export const HOURLY_RATE_PART_KEYS = [
  'FIXED_COSTS',
  'VARIABLE_COSTS',
  'OWNER_DRAW',
  'SAFETY_MARGIN',
] as const;

export type HourlyRatePartKey = (typeof HOURLY_RATE_PART_KEYS)[number];

/** Places every amount, percentage and hour count is returned with. */
export const HOURLY_RATE_DECIMAL_PLACES = 2;

export const WEEKS_PER_YEAR = 52;
export const MONTHS_PER_YEAR = 12;

/** 100% in hundredths of a percent: the unit the percentages are shared in. */
const WHOLE_IN_HUNDREDTHS = 10_000;

export interface HourlyRateInput {
  /** Personal expenses + equipment depreciation + transport, for the month. */
  fixedCosts: DecimalInput;
  /** Professional expenses of the month (trips included). */
  variableCosts: DecimalInput;
  /** The monthly income goal (US19): owner's draw plus desired profit. */
  ownerDraw: DecimalInput;
  /** 0 to 100. */
  safetyMarginPct: DecimalInput;
  /** Hours available per week, idle time included (US19). */
  weeklyHours: DecimalInput;
}

export interface HourlyRatePart {
  key: HourlyRatePartKey;
  /** Rounded to 2 places. The parts add up to `total` exactly. */
  amount: Prisma.Decimal;
  /** Share of `total`, 2 places. The shares add up to exactly 100. */
  percentOfTotal: Prisma.Decimal;
}

export interface HourlyRateResult {
  parts: HourlyRatePart[];
  /** Sum of the rounded parts. */
  total: Prisma.Decimal;
  /** Rounded to 2 places for display; the rates use the full value. */
  productiveHours: Prisma.Decimal;
  /** `total ÷ productive hours`, 2 places. */
  hourlyRate: Prisma.Decimal;
  /** The same division without the margin: below it, costs are not covered. */
  minimumHourlyRate: Prisma.Decimal;
}

const toDecimal = (value: DecimalInput): Prisma.Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

const round = (value: Prisma.Decimal): Prisma.Decimal =>
  value.toDecimalPlaces(
    HOURLY_RATE_DECIMAL_PLACES,
    Prisma.Decimal.ROUND_HALF_UP,
  );

/**
 * Hours available per week × 52 ÷ 12, at full precision. Idle time counts:
 * the hour has to pay for the whole month, not only the billed hours.
 */
export function productiveHoursPerMonth(
  weeklyHours: DecimalInput,
): Prisma.Decimal {
  return toDecimal(weeklyHours)
    .times(WEEKS_PER_YEAR)
    .dividedBy(MONTHS_PER_YEAR);
}

/**
 * Each amount's share of the total, in hundredths of a percent, adding up to
 * exactly 100%. Rounding each share on its own can land on 99.99 or 100.01,
 * so this is the largest remainder method: every share is rounded down, and
 * the hundredths left over go to the largest remainders (ties to the earlier
 * part, so the result is deterministic).
 */
export function percentagesOf(amounts: Prisma.Decimal[]): Prisma.Decimal[] {
  const total = amounts.reduce(
    (sum, amount) => sum.plus(amount),
    new Prisma.Decimal(0),
  );
  if (total.isZero()) return amounts.map(() => new Prisma.Decimal(0));

  const exact = amounts.map(amount =>
    amount.times(WHOLE_IN_HUNDREDTHS).dividedBy(total),
  );
  const shares = exact.map(value => value.floor());
  const assigned = shares.reduce(
    (sum, share) => sum.plus(share),
    new Prisma.Decimal(0),
  );
  let leftover = WHOLE_IN_HUNDREDTHS - assigned.toNumber();

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value.minus(shares[index]) }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.index - b.index);
  for (const { index } of byRemainder) {
    if (leftover <= 0) break;
    shares[index] = shares[index].plus(1);
    leftover -= 1;
  }

  return shares.map(share => share.dividedBy(100));
}

/**
 * @throws RangeError when the weekly hours are not positive or the margin is
 * outside 0–100. The US19 DTO and the table CHECKs already refuse both, so
 * reaching it means a bad row, not bad input.
 */
export function calculateHourlyRate(input: HourlyRateInput): HourlyRateResult {
  const weeklyHours = toDecimal(input.weeklyHours);
  if (weeklyHours.lessThanOrEqualTo(0)) {
    throw new RangeError('weeklyHours must be greater than zero');
  }
  const marginPct = toDecimal(input.safetyMarginPct);
  if (marginPct.lessThan(0) || marginPct.greaterThan(100)) {
    throw new RangeError('safetyMarginPct must be between 0 and 100');
  }

  const fixedCosts = round(toDecimal(input.fixedCosts));
  const variableCosts = round(toDecimal(input.variableCosts));
  const ownerDraw = round(toDecimal(input.ownerDraw));
  const base = fixedCosts.plus(variableCosts).plus(ownerDraw);
  const margin = round(base.times(marginPct).dividedBy(100));
  const total = base.plus(margin);

  const amounts = [fixedCosts, variableCosts, ownerDraw, margin];
  const percentages = percentagesOf(amounts);
  const hours = productiveHoursPerMonth(weeklyHours);

  return {
    parts: HOURLY_RATE_PART_KEYS.map((key, index) => ({
      key,
      amount: amounts[index],
      percentOfTotal: percentages[index],
    })),
    total,
    productiveHours: round(hours),
    hourlyRate: round(total.dividedBy(hours)),
    minimumHourlyRate: round(base.dividedBy(hours)),
  };
}

/** A domain value as the API returns it: a decimal string, half-up, 2 places. */
export function formatHourlyRateValue(value: DecimalInput): string {
  return toDecimal(value).toFixed(
    HOURLY_RATE_DECIMAL_PLACES,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}
