import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

import {
  MAX_MONTHLY_INCOME_GOAL,
  PRICING_DECIMAL_PLACES,
} from '../pricing-settings.constants';

/**
 * The US18 transport cost. No `userId`: the owner comes from the token, never
 * from the request (ADR-11). The US19 goals are not accepted here either.
 */
export class SaveTransportCostDto {
  @ApiProperty({
    example: 450,
    minimum: 0,
    maximum: MAX_MONTHLY_INCOME_GOAL,
    description:
      'Monthly transport cost in R$. Zero is valid (a professional who does ' +
      'not drive). Up to 2 decimal places',
  })
  @IsNumber({ maxDecimalPlaces: PRICING_DECIMAL_PLACES })
  @Min(0)
  @Max(MAX_MONTHLY_INCOME_GOAL)
  transportCostMonthly!: number;
}
