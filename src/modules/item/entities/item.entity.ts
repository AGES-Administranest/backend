import { ApiProperty } from '@nestjs/swagger';
import { ItemCategory, MeasurementUnit, Prisma } from '@prisma/client';

export class ItemEntity {
  id!: string;

  supplierId!: string | null;

  category!: ItemCategory;

  unit!: MeasurementUnit;

  name!: string;

  @ApiProperty({ type: String, nullable: true, example: '12.5000' })
  defaultUnitCost!: Prisma.Decimal | null;

  @ApiProperty({ type: String, nullable: true, example: '10.000' })
  minimumStock!: Prisma.Decimal | null;

  @ApiProperty({ type: String, example: '0.000' })
  currentQuantity!: Prisma.Decimal;

  @ApiProperty({ description: 'true when currentQuantity <= minimumStock' })
  belowMinimum!: boolean;

  @ApiProperty({
    type: String,
    format: 'date',
    nullable: true,
    example: '2027-03-31',
    description:
      'Earliest expiration date among the lots that still hold stock; null when no such lot has one. Calendar date (YYYY-MM-DD), no time component',
  })
  nearestExpiration!: string | null;

  active!: boolean;

  createdAt!: Date;

  updatedAt!: Date;

  deletedAt!: Date | null;
}
