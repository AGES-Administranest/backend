import { Prisma } from '@prisma/client';

export const ZERO = new Prisma.Decimal(0);

/** Reais with two decimals, rounded half up, as every money field of the API. */
export function money(value: Prisma.Decimal): string {
  return value.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function sum(values: readonly Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((total, value) => total.plus(value), ZERO);
}
