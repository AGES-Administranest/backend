import { Prisma } from '@prisma/client';

import { type DecimalInput, HOURLY_RATE_DECIMAL_PLACES } from './hourly-rate';

/**
 * The minimum price of a procedure (US21). Pure arithmetic: no Nest, no Prisma
 * Client.
 *
 *   minimum price = hours + trip + supplies
 *   hours         = hourly rate × duration in minutes ÷ 60
 *   trip          = what a day at the client has cost in trips (0 without one)
 *   supplies      = Σ quantity × unit cost (0 for an item without a cost)
 *
 * Each part is rounded half-up to cents, and the price is the sum of the
 * rounded parts, so the parts on screen always add up to it. The break-even
 * price is the same sum with the hourly rate without the safety margin.
 *
 * The hourly rate (US20) already spreads the month's trips and supply
 * purchases over every hour, so adding this procedure's own trip and supplies
 * counts part of them twice: the estimate errs on the high side, never below
 * cost.
 */

export const MINUTES_PER_HOUR = 60;

export interface EstimatedSupply {
  itemId: string;
  quantity: DecimalInput;
  /** null when the item has no cost recorded yet. */
  unitCost: Prisma.Decimal | null;
}

export interface ProcedureEstimateInput {
  durationMinutes: number;
  /** With the safety margin, as US20 returns it. */
  hourlyRate: DecimalInput;
  /** Without the safety margin, as US20 returns it. */
  minimumHourlyRate: DecimalInput;
  /** What a day at the client has cost in trips; null without an estimate. */
  tripCostPerDay: DecimalInput | null;
  supplies: readonly EstimatedSupply[];
}

export interface ProcedureEstimate {
  minimumPrice: Prisma.Decimal;
  breakEvenPrice: Prisma.Decimal;
  hoursCost: Prisma.Decimal;
  tripCost: Prisma.Decimal;
  suppliesCost: Prisma.Decimal;
  /** Items counted at 0 because they have no cost, each listed once. */
  suppliesWithoutCost: string[];
}

const toDecimal = (value: DecimalInput): Prisma.Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

const round = (value: Prisma.Decimal): Prisma.Decimal =>
  value.toDecimalPlaces(
    HOURLY_RATE_DECIMAL_PLACES,
    Prisma.Decimal.ROUND_HALF_UP,
  );

/** rate × minutes ÷ 60, rounded once at the end. */
function costOfHours(rate: DecimalInput, minutes: number): Prisma.Decimal {
  return round(toDecimal(rate).times(minutes).dividedBy(MINUTES_PER_HOUR));
}

export function estimateProcedure(
  input: ProcedureEstimateInput,
): ProcedureEstimate {
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes <= 0) {
    throw new RangeError('durationMinutes must be a positive integer');
  }

  const hoursCost = costOfHours(input.hourlyRate, input.durationMinutes);
  const breakEvenHoursCost = costOfHours(
    input.minimumHourlyRate,
    input.durationMinutes,
  );
  const tripCost =
    input.tripCostPerDay === null
      ? new Prisma.Decimal(0)
      : round(toDecimal(input.tripCostPerDay));

  let supplies = new Prisma.Decimal(0);
  const withoutCost: string[] = [];
  for (const supply of input.supplies) {
    if (supply.unitCost === null) {
      if (!withoutCost.includes(supply.itemId)) withoutCost.push(supply.itemId);
      continue;
    }
    supplies = supplies.plus(toDecimal(supply.quantity).times(supply.unitCost));
  }
  const suppliesCost = round(supplies);

  return {
    minimumPrice: hoursCost.plus(tripCost).plus(suppliesCost),
    breakEvenPrice: breakEvenHoursCost.plus(tripCost).plus(suppliesCost),
    hoursCost,
    tripCost,
    suppliesCost,
    suppliesWithoutCost: withoutCost,
  };
}
