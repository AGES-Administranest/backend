import { ApiProperty } from '@nestjs/swagger';
import { Prisma, StockMovementSource, StockMovementType } from '@prisma/client';

export class AppointmentItemMovementEntity {
  id!: string;

  itemId!: string;

  @ApiProperty({ type: String, nullable: true })
  lotId!: string | null;

  @ApiProperty({ enum: StockMovementType })
  type!: StockMovementType;

  @ApiProperty({ enum: StockMovementSource })
  source!: StockMovementSource;

  @ApiProperty({ type: String, example: '2.000' })
  quantity!: Prisma.Decimal;

  @ApiProperty({
    type: String,
    example: '12.5000',
    description: 'Snapshot of the current lot cost at registration time',
  })
  unitCost!: Prisma.Decimal;

  occurredAt!: Date;

  createdAt!: Date;
}

/**
 * The item ended up with a negative balance. The movement was still recorded:
 * a negative balance means the inventory count is wrong, not that the
 * consumption did not happen (ADR-10) — it is fixed later by an adjustment.
 */
export class InsufficientStockWarningEntity {
  @ApiProperty({ enum: ['insufficient_stock'] })
  warning!: 'insufficient_stock';

  itemId!: string;
}

export class RegisterAppointmentItemsResultEntity {
  appointmentId!: string;

  @ApiProperty({ type: [AppointmentItemMovementEntity] })
  movements!: AppointmentItemMovementEntity[];

  @ApiProperty({ type: [InsufficientStockWarningEntity] })
  warnings!: InsufficientStockWarningEntity[];
}
