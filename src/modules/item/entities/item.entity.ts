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

  /** Estoque mínimo */
  @ApiProperty({ type: String, nullable: true, example: '10.000' })
  minimumStock!: Prisma.Decimal | null;

  @ApiProperty({ type: String, example: '0.000' })
  currentQuantity!: Prisma.Decimal;

  active!: boolean;

  createdAt!: Date;

  updatedAt!: Date;

  deletedAt!: Date | null;
}
