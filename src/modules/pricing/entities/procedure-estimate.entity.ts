import { ApiProperty } from '@nestjs/swagger';

/** Every amount is a decimal string with 2 places, in R$. */
export class ProcedureEstimateResponse {
  @ApiProperty({
    type: String,
    example: '131.47',
    description:
      'hoursCost + tripCost + suppliesCost, with the safety margin in the hours',
  })
  minimumPrice!: string;

  @ApiProperty({
    type: String,
    example: '126.28',
    description:
      'The same sum with the hourly rate without the safety margin: the price ' +
      'that only covers the costs and the owner draw',
  })
  breakEvenPrice!: string;

  @ApiProperty({
    type: String,
    example: '57.12',
    description: 'hourlyRateUsed × durationMinutes ÷ 60',
  })
  hoursCost!: string;

  @ApiProperty({
    type: String,
    example: '49.35',
    description:
      'What a day at the client has cost in trips, over the latest 10 days ' +
      'with trips there; 0.00 when tripEstimateAvailable is false',
  })
  tripCost!: string;

  @ApiProperty({
    type: String,
    example: '25.00',
    description:
      "Σ quantity × the item's defaultUnitCost; items without a cost count as 0",
  })
  suppliesCost!: string;

  @ApiProperty({
    type: String,
    example: '38.08',
    description:
      'The hourly rate with the margin, as GET /pricing/hourly-rate returns it ' +
      'for the current month in Brasília',
  })
  hourlyRateUsed!: string;

  @ApiProperty({
    type: String,
    example: '34.62',
    description: 'The hourly rate without the margin, behind breakEvenPrice',
  })
  minimumHourlyRateUsed!: string;

  @ApiProperty({
    example: true,
    description:
      'false when the request has no clientId, or the client has no trips yet',
  })
  tripEstimateAvailable!: boolean;

  @ApiProperty({
    example: 2,
    description: 'The days with trips to the client that tripCost averages',
  })
  tripEstimateDays!: number;

  @ApiProperty({
    type: String,
    format: 'uuid',
    isArray: true,
    description:
      'Items counted at 0 because they have no cost recorded, each listed once',
  })
  suppliesWithoutCost!: string[];

  @ApiProperty({ example: 90, description: 'The duration priced, as sent' })
  durationMinutes!: number;

  @ApiProperty({
    minimum: 1,
    maximum: 12,
    example: 11,
    description:
      'The month the hourly rate comes from: the current one in Brasília ' +
      '(America/Sao_Paulo)',
  })
  month!: number;

  @ApiProperty({
    example: 2026,
    description: 'The year of the month the hourly rate comes from',
  })
  year!: number;
}
