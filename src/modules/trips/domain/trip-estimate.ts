import { Prisma } from '@prisma/client';

/**
 * What a day at a client has cost in trips, to price the trip of a new
 * procedure there (US21). No Nest, no Prisma Client.
 */
export interface TripCostEstimate {
  /** false when there is no trip to the client to learn from. */
  available: boolean;
  /** R$ per day at the client, at full precision; 0 when not available. */
  costPerDay: Prisma.Decimal;
  /** The days the average covers. */
  days: number;
}

/**
 * The average of what each day's trips to the client added up to. Summing by
 * day counts the way there and back, and every leg of a day with several stops,
 * as one visit. Only trips marked with the client count: a way back recorded
 * without it is left out, and the estimate comes out lower.
 */
export function averageDailyCost(
  dailyTotals: readonly Prisma.Decimal[],
): TripCostEstimate {
  if (dailyTotals.length === 0) {
    return { available: false, costPerDay: new Prisma.Decimal(0), days: 0 };
  }

  const sum = dailyTotals.reduce(
    (total, day) => total.plus(day),
    new Prisma.Decimal(0),
  );
  return {
    available: true,
    costPerDay: sum.dividedBy(dailyTotals.length),
    days: dailyTotals.length,
  };
}
