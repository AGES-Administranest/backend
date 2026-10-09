import { Prisma } from '@prisma/client';

/**
 * What a kilometre costs in fuel. Pure arithmetic: no Nest, no Prisma Client.
 *
 * Everything stays in `Decimal`: going through `number` would bring binary
 * floating-point error into money. The full-precision value is what US14 must
 * multiply by the distance of a trip; rounding happens once, on the way out.
 */

export type DecimalInput = Prisma.Decimal | number | string;

/** Places `costPerKm` is returned with. The app rounds to cents for display. */
export const COST_PER_KM_DECIMAL_PLACES = 4;

const toDecimal = (value: DecimalInput): Prisma.Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

/**
 * fuel price (R$/L) ÷ average consumption (km/L) = R$/km, at full precision.
 *
 * @throws RangeError when the consumption is not positive. The DTOs already
 * reject that, so reaching it means a bad row, not bad input.
 */
export function costPerKm(
  fuelPrice: DecimalInput,
  avgConsumptionKmL: DecimalInput,
): Prisma.Decimal {
  const consumption = toDecimal(avgConsumptionKmL);
  if (!consumption.isPositive() || consumption.isZero()) {
    throw new RangeError('avgConsumptionKmL must be greater than zero');
  }
  return toDecimal(fuelPrice).dividedBy(consumption);
}

/** `costPerKm` as the API returns it: a decimal string, half-up, 4 places. */
export function formatCostPerKm(value: DecimalInput): string {
  return toDecimal(value).toFixed(
    COST_PER_KM_DECIMAL_PLACES,
    Prisma.Decimal.ROUND_HALF_UP,
  );
}
