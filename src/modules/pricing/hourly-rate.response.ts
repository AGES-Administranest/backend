import {
  formatHourlyRateValue,
  type HourlyRatePartKey,
  type HourlyRateResult,
} from './domain/hourly-rate';
import type { YearMonth } from './domain/hourly-rate-snapshot';
import { HourlyRateResponse } from './entities/hourly-rate.entity';

/** For developers reading the response; the app shows its own text per key. */
const PART_LABELS: Record<HourlyRatePartKey, string> = {
  FIXED_COSTS: 'Fixed costs',
  VARIABLE_COSTS: 'Variable costs',
  OWNER_DRAW: "Owner's draw",
  SAFETY_MARGIN: 'Safety margin',
};

/**
 * One shape for the live calculation and for a stored month, so the two
 * routes cannot drift apart.
 */
export function toHourlyRateResponse(
  { year, month }: YearMonth,
  result: HourlyRateResult,
  calculatedAt: Date,
): HourlyRateResponse {
  return {
    month,
    year,
    items: result.parts.map(part => ({
      key: part.key,
      label: PART_LABELS[part.key],
      amount: formatHourlyRateValue(part.amount),
      percentOfTotal: formatHourlyRateValue(part.percentOfTotal),
    })),
    total: formatHourlyRateValue(result.total),
    productiveHours: formatHourlyRateValue(result.productiveHours),
    hourlyRate: formatHourlyRateValue(result.hourlyRate),
    minimumHourlyRate: formatHourlyRateValue(result.minimumHourlyRate),
    calculatedAt,
  };
}
