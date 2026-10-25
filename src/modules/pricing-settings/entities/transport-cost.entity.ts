import { ApiProperty } from '@nestjs/swagger';

export class TransportCostEntity {
  @ApiProperty({
    example: 450,
    description: 'Monthly transport cost in R$. Zero means no transport cost',
  })
  transportCostMonthly!: number;

  @ApiProperty({ description: 'Last change to the settings row' })
  updatedAt!: Date;
}
