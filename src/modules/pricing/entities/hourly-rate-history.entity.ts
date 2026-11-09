import { ApiProperty } from '@nestjs/swagger';

import { HourlyRateResponse } from './hourly-rate.entity';

export class HourlyRateHistoryItemResponse {
  @ApiProperty({ minimum: 2000, maximum: 2100, example: 2026 })
  year!: number;

  @ApiProperty({ minimum: 1, maximum: 12, example: 10 })
  month!: number;

  @ApiProperty({
    type: String,
    example: '98.07',
    description: 'The hour value stored for the month',
  })
  hourlyRate!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-19T20:42:00.000Z',
    description: 'When the stored calculation ran',
  })
  calculatedAt!: Date;
}

/** The US19 goals as they were when the month was calculated. */
export class HourlyRateParametersResponse {
  @ApiProperty({
    type: String,
    example: '8000.00',
    description: 'Monthly income goal in R$',
  })
  monthlyIncomeGoal!: string;

  @ApiProperty({
    type: String,
    example: '30.00',
    description: 'Hours available per week, idle time included',
  })
  weeklyHours!: string;

  @ApiProperty({
    type: String,
    example: '20.00',
    description: 'Safety margin in percent (0–100)',
  })
  safetyMarginPct!: string;
}

/** The same shape as GET /pricing/hourly-rate, plus the goals it used. */
export class HourlyRateHistoryMonthResponse extends HourlyRateResponse {
  @ApiProperty({ type: HourlyRateParametersResponse })
  parameters!: HourlyRateParametersResponse;
}
