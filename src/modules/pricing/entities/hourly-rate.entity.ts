import { ApiProperty } from '@nestjs/swagger';

import {
  HOURLY_RATE_PART_KEYS,
  type HourlyRatePartKey,
} from '../domain/hourly-rate';

export class HourlyRatePartResponse {
  @ApiProperty({
    enum: HOURLY_RATE_PART_KEYS,
    example: 'OWNER_DRAW',
    description:
      'Stable identifier of the part. The app picks the text it shows from ' +
      'this key, as it does with error codes.',
  })
  key!: HourlyRatePartKey;

  @ApiProperty({
    example: "Owner's draw",
    description:
      'Text for developers. It can change; the app does not depend on it.',
  })
  label!: string;

  @ApiProperty({ type: String, example: '8000.00' })
  amount!: string;

  @ApiProperty({
    type: String,
    example: '62.75',
    description:
      'Share of the total. The four shares add up to exactly 100.00.',
  })
  percentOfTotal!: string;
}

export class HourlyRateResponse {
  @ApiProperty({ minimum: 1, maximum: 12, example: 10 })
  month!: number;

  @ApiProperty({ minimum: 2000, maximum: 2100, example: 2026 })
  year!: number;

  @ApiProperty({
    type: HourlyRatePartResponse,
    isArray: true,
    description:
      'FIXED_COSTS, VARIABLE_COSTS, OWNER_DRAW and SAFETY_MARGIN, in this order',
    example: [
      {
        key: 'FIXED_COSTS',
        label: 'Fixed costs',
        amount: '1399.08',
        percentOfTotal: '10.97',
      },
      {
        key: 'VARIABLE_COSTS',
        label: 'Variable costs',
        amount: '1225.00',
        percentOfTotal: '9.61',
      },
      {
        key: 'OWNER_DRAW',
        label: "Owner's draw",
        amount: '8000.00',
        percentOfTotal: '62.75',
      },
      {
        key: 'SAFETY_MARGIN',
        label: 'Safety margin',
        amount: '2124.82',
        percentOfTotal: '16.67',
      },
    ],
  })
  items!: HourlyRatePartResponse[];

  @ApiProperty({
    type: String,
    example: '12748.90',
    description: 'Sum of the four amounts',
  })
  total!: string;

  @ApiProperty({
    type: String,
    example: '130.00',
    description: 'Weekly hours × 52 ÷ 12, idle time included',
  })
  productiveHours!: string;

  @ApiProperty({
    type: String,
    example: '98.07',
    description: 'total ÷ productive hours: the value to charge per hour',
  })
  hourlyRate!: string;

  @ApiProperty({
    type: String,
    example: '81.72',
    description:
      'The same division without the safety margin. Below it, the costs and ' +
      "the owner's draw are not covered.",
  })
  minimumHourlyRate!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    example: '2026-10-19T20:42:00.000Z',
    description: 'When this calculation ran. It is not stored.',
  })
  calculatedAt!: Date;
}
