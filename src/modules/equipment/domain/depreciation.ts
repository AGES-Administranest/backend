export const DEFAULT_USEFUL_LIFE_MONTHS = 120;

const CENTS_PER_UNIT = 100;

export interface DepreciationInput {
  purchaseValue: number;
  salvageValue: number;
  acquisitionDate: Date;
  usefulLifeMonths?: number | null;
  asOf?: Date;
}

export interface DepreciationResult {
  monthlyDepreciation: number;
  accumulatedDepreciation: number;
  currentValue: number;
  usefulLifeUsedPct: number;
  endOfLife: boolean;
}

export function calculateDepreciation({
  purchaseValue,
  salvageValue,
  acquisitionDate,
  usefulLifeMonths,
  asOf = new Date(),
}: DepreciationInput): DepreciationResult {
  const lifeInMonths = usefulLifeMonths ?? DEFAULT_USEFUL_LIFE_MONTHS;
  const purchaseCents = toCents(purchaseValue);
  const salvageCents = toCents(salvageValue);
  const depreciableCents = purchaseCents - salvageCents;
  const elapsedMonths = fullMonthsBetween(acquisitionDate, asOf);
  const endOfLife = elapsedMonths >= lifeInMonths;
  const accumulatedDepreciationCents = Math.min(
    depreciableCents,
    Math.round((depreciableCents * elapsedMonths) / lifeInMonths),
  );

  return {
    monthlyDepreciation: endOfLife
      ? 0
      : Math.round(depreciableCents / lifeInMonths) / CENTS_PER_UNIT,
    accumulatedDepreciation: accumulatedDepreciationCents / CENTS_PER_UNIT,
    currentValue:
      (purchaseCents - accumulatedDepreciationCents) / CENTS_PER_UNIT,
    usefulLifeUsedPct: Math.min(100, (elapsedMonths / lifeInMonths) * 100),
    endOfLife,
  };
}

function toCents(value: number): number {
  return Math.round(value * CENTS_PER_UNIT);
}

function fullMonthsBetween(start: Date, end: Date): number {
  let months =
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
    end.getUTCMonth() -
    start.getUTCMonth();
  if (end.getUTCDate() < start.getUTCDate() && !isLastDayOfMonth(end)) {
    months -= 1;
  }
  return Math.max(0, months);
}

function isLastDayOfMonth(date: Date): boolean {
  return (
    date.getUTCDate() ===
    new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate()
  );
}
