import { ApiProperty } from '@nestjs/swagger';

/**
 * The US19 goals as JSON numbers, the shape the app sends them in. The
 * columns hold at most 2 decimal places, which a number carries exactly as
 * far as the app is concerned.
 */
export class PricingSettingsEntity {
  @ApiProperty({
    example: 8000,
    description: 'Monthly income goal in R$ (owner draw plus desired profit)',
  })
  monthlyIncomeGoal!: number;

  @ApiProperty({
    example: 40,
    description: 'Hours available per week, idle time included',
  })
  weeklyHours!: number;

  @ApiProperty({ example: 10, description: 'Safety margin in percent (0–100)' })
  safetyMarginPct!: number;

  @ApiProperty({
    description:
      'Last change to the row, including a transport cost change (US18)',
  })
  updatedAt!: Date;
}
