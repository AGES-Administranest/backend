import { ApiProperty } from '@nestjs/swagger';

export class EquipmentSummaryEntity {
  @ApiProperty({ description: 'Monthly depreciation of active equipment' })
  monthlyTotal!: number;

  @ApiProperty({ description: 'Annual depreciation of active equipment' })
  yearlyTotal!: number;

  @ApiProperty({ description: 'Number of active equipment items' })
  count!: number;
}
