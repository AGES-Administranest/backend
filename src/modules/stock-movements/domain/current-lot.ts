import { Prisma } from '@prisma/client';

export interface LotLike {
  id: string;
  unitCost: Prisma.Decimal;
  currentQuantity: Prisma.Decimal;
  expirationDate: Date | null;
  receivedOn: Date;
  createdAt: Date;
}

/**
 * The lot a consumption is drawn from — the one whose `unitCost` becomes the
 * movement's cost snapshot. The schema has no `item.currentLot` column, so it
 * is derived here:
 *
 *   1. among lots that still hold stock, the one expiring first (FEFO — the
 *      same order `nearestExpiration` exposes to the app), lots without an
 *      expiration date last, oldest received first on a tie;
 *   2. with no lot holding stock, the most recently received one — its cost is
 *      the latest price the professional actually paid;
 *   3. with no lot at all, `null`.
 */
export function currentLot<T extends LotLike>(lots: readonly T[]): T | null {
  const withStock = lots.filter(lot => lot.currentQuantity.greaterThan(0));
  if (withStock.length > 0) return [...withStock].sort(byFefo)[0];

  const [latest] = [...lots].sort(
    (a, b) =>
      compareDates(b.receivedOn, a.receivedOn) ||
      compareDates(b.createdAt, a.createdAt),
  );
  return latest ?? null;
}

function byFefo(a: LotLike, b: LotLike): number {
  if (a.expirationDate && !b.expirationDate) return -1;
  if (!a.expirationDate && b.expirationDate) return 1;
  return (
    (a.expirationDate && b.expirationDate
      ? compareDates(a.expirationDate, b.expirationDate)
      : 0) ||
    compareDates(a.receivedOn, b.receivedOn) ||
    compareDates(a.createdAt, b.createdAt)
  );
}

const compareDates = (a: Date, b: Date): number => a.getTime() - b.getTime();
