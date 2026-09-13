import { ApiProperty } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';

export class ItemLotEntity {
  id!: string;

  itemId!: string;

  lotNumber!: string | null;

  @ApiProperty({ type: String, nullable: true, format: 'date' })
  expirationDate!: Date | null;

  @ApiProperty({ type: String, example: '12.5000' })
  unitCost!: Prisma.Decimal;

  @ApiProperty({ type: String, example: '10.000' })
  currentQuantity!: Prisma.Decimal;

  @ApiProperty({ type: String, format: 'date' })
  receivedOn!: Date;

  createdAt!: Date;

  updatedAt!: Date;
}
