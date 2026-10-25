import { Prisma } from '@prisma/client';

import { costPerKm, formatCostPerKm } from '../../vehicles';

/**
 * What a trip by car costs. Pure arithmetic over `Decimal`, like the vehicle's
 * cost per km it builds on: going through `number` would bring binary
 * floating-point error into money.
 *
 * A trip keeps the 4-place cost per km the API shows, not the full-precision
 * one, so its cost always equals distance × that value, rounded to cents. That
 * can differ from pricing from the raw fuel price and consumption by a cent on
 * a long trip (300 km at 5.899 R$/L and 12.5 km/L: 141.57, not 141.58), and in
 * exchange the user can check every trip against the screen.
 */

type DecimalInput = Prisma.Decimal | number | string;

/** Places a trip cost is stored with, as `trip.cost` (Decimal(14,2)). */
export const TRIP_COST_DECIMAL_PLACES = 2;

const toDecimal = (value: DecimalInput): Prisma.Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

/** The vehicle's cost per km as a trip copies it: 4 places, half-up. */
export function snapshotCostPerKm(
  fuelPrice: DecimalInput,
  avgConsumptionKmL: DecimalInput,
): Prisma.Decimal {
  return new Prisma.Decimal(
    formatCostPerKm(costPerKm(fuelPrice, avgConsumptionKmL)),
  );
}

/**
 * distance (km) × the copied cost per km (R$/km), rounded half-up to cents.
 * A very short trip can come out as 0.00.
 *
 * @throws RangeError when the distance is not positive. The DTOs and the
 * trip_distance_km_positive CHECK already reject that.
 */
export function tripCost(
  distanceKm: DecimalInput,
  perKm: DecimalInput,
): Prisma.Decimal {
  const distance = toDecimal(distanceKm);
  if (!distance.isPositive() || distance.isZero()) {
    throw new RangeError('distanceKm must be greater than zero');
  }
  return distance
    .times(toDecimal(perKm))
    .toDecimalPlaces(TRIP_COST_DECIMAL_PLACES, Prisma.Decimal.ROUND_HALF_UP);
}
