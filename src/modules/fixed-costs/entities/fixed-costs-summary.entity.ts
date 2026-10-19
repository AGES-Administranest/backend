import { ApiProperty } from '@nestjs/swagger';

export class FixedCostsSummaryResponse {
  @ApiProperty({
    type: String,
    example: '1250.00',
    description: 'Professional expenses of the month, as a decimal string',
  })
  professionalExpenses!: string;

  @ApiProperty({ type: String, example: '830.50' })
  personalExpenses!: string;

  @ApiProperty({
    type: String,
    example: '189.08',
    description: 'Provisional until US15',
  })
  depreciation!: string;

  @ApiProperty({
    type: String,
    example: '300.00',
    description: '0.00 when the user has no pricing settings',
  })
  transport!: string;

  @ApiProperty({
    type: String,
    example: '2569.58',
    description: 'Sum of the four values above',
  })
  total!: string;
}
