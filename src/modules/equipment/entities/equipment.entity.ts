import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EquipmentEntity {
  id!: string;

  @ApiProperty({ type: String, nullable: true, format: 'uuid' })
  supplierId!: string | null;

  name!: string;

  purchaseValue!: number;

  salvageValue!: number;

  acquisitionDate!: Date;

  usefulLifeMonths!: number;

  @ApiPropertyOptional({ type: String, nullable: true })
  notes!: string | null;

  active!: boolean;

  createdAt!: Date;

  updatedAt!: Date;

  @ApiProperty({ description: 'Straight-line depreciation per full month' })
  monthlyDepreciation!: number;

  @ApiProperty({
    description: 'Depreciation accumulated through the current date',
  })
  accumulatedDepreciation!: number;

  @ApiProperty({ description: 'Purchase value less accumulated depreciation' })
  currentBookValue!: number;
}
