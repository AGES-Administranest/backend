// TODO(US15): temporary. Straight-line depreciation straight over the
// equipment table, until the official US15 service replaces it. Swap the body
// of getMonthlyDepreciation and keep its signature: the fixed-costs endpoint
// only calls that method and does no depreciation arithmetic of its own.
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MonthlyDepreciationRepository } from './monthly-depreciation.repository';

const MONTHS_PER_YEAR = 12;

export interface DepreciableEquipment {
  purchaseValue: Prisma.Decimal;
  salvageValue: Prisma.Decimal;
  acquisitionDate: Date;
  usefulLifeMonths: number | null;
}

/**
 * Sum of the monthly quota of every equipment still depreciating in the given
 * month. An equipment depreciates from the month of its acquisition for exactly
 * `usefulLifeYears * 12` months. Each quota stays unrounded; only the total is
 * rounded, once, to 2 places.
 */
export function monthlyDepreciation(
  equipment: DepreciableEquipment[],
  month: number,
  year: number,
): Prisma.Decimal {
  const monthIndex = year * MONTHS_PER_YEAR + (month - 1);
  const total = equipment.reduce((sum, item) => {
    const lifeInMonths = item.usefulLifeMonths ?? 0;
    // acquisition_date is a calendar date (@db.Date), read in UTC
    const startIndex =
      item.acquisitionDate.getUTCFullYear() * MONTHS_PER_YEAR +
      item.acquisitionDate.getUTCMonth();
    if (
      lifeInMonths <= 0 ||
      monthIndex < startIndex ||
      monthIndex >= startIndex + lifeInMonths
    ) {
      return sum;
    }
    return sum.plus(
      item.purchaseValue.minus(item.salvageValue).dividedBy(lifeInMonths),
    );
  }, new Prisma.Decimal(0));
  return total.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

@Injectable()
export class MonthlyDepreciation {
  constructor(private readonly repository: MonthlyDepreciationRepository) {}

  async getMonthlyDepreciation(
    userId: string,
    month: number,
    year: number,
  ): Promise<Prisma.Decimal> {
    const equipment = await this.repository.findDepreciable(userId);
    return monthlyDepreciation(equipment, month, year);
  }
}
