import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, Max, Min } from 'class-validator';

import {
  MAX_MONTHLY_INCOME_GOAL,
  MAX_SAFETY_MARGIN_PCT,
  MAX_WEEKLY_HOURS,
  PRICING_DECIMAL_PLACES,
} from '../pricing-settings.constants';

const decimal = { maxDecimalPlaces: PRICING_DECIMAL_PLACES };

/**
 * The three US19 goals, always sent together: the settings only count as
 * configured when all three are filled in, so a partial save is refused.
 *
 * No `userId`: the owner comes from the token, never from the request (ADR-11).
 * No transport cost either: it belongs to US18 and is not touched here.
 */
export class SavePricingSettingsDto {
  @ApiProperty({
    example: 8000,
    exclusiveMinimum: true,
    minimum: 0,
    maximum: MAX_MONTHLY_INCOME_GOAL,
    description:
      'Monthly income goal in R$: the owner draw plus the desired profit, ' +
      'as a single amount. Up to 2 decimal places',
  })
  @IsNumber(decimal)
  @IsPositive()
  @Max(MAX_MONTHLY_INCOME_GOAL)
  monthlyIncomeGoal!: number;

  @ApiProperty({
    example: 40,
    exclusiveMinimum: true,
    minimum: 0,
    maximum: MAX_WEEKLY_HOURS,
    description:
      'Hours available per week, not only the billed ones (idle time ' +
      'included). The hour value divides by it, so zero is refused. Up to 2 ' +
      'decimal places',
  })
  @IsNumber(decimal)
  @IsPositive()
  @Max(MAX_WEEKLY_HOURS)
  weeklyHours!: number;

  @ApiProperty({
    example: 10,
    minimum: 0,
    maximum: MAX_SAFETY_MARGIN_PCT,
    description:
      'Safety margin in percent, from 0 to 100 inclusive. Up to 2 decimal places',
  })
  @IsNumber(decimal)
  @Min(0)
  @Max(MAX_SAFETY_MARGIN_PCT)
  safetyMarginPct!: number;
}
