import { ApiProperty } from '@nestjs/swagger';
import { Prisma, StockMovementSource, StockMovementType } from '@prisma/client';

export class AppointmentItemMovementEntity {
  id!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  clientGeneratedId!: string | null;

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

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'On a CORRECTION_REVERSAL: the movement it reverses',
  })
  reversedMovementId!: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'On a supply that corrects an earlier one (an edit): the movement it replaced',
  })
  replacedMovementId!: string | null;

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

export class EditAppointmentItemResultEntity {
  appointmentId!: string;

  @ApiProperty({
    type: AppointmentItemMovementEntity,
    description:
      'The supply as it stands now: the movement that replaced the edited one (its id is the one to edit or remove next), or the same movement when the quantity did not change',
  })
  movement!: AppointmentItemMovementEntity;

  @ApiProperty({
    type: AppointmentItemMovementEntity,
    nullable: true,
    description:
      'The reversal of the edited movement; null when nothing changed',
  })
  reversal!: AppointmentItemMovementEntity | null;

  @ApiProperty({ type: [InsufficientStockWarningEntity] })
  warnings!: InsufficientStockWarningEntity[];
}

export class RemoveAppointmentItemResultEntity {
  appointmentId!: string;

  @ApiProperty({ type: AppointmentItemMovementEntity })
  reversal!: AppointmentItemMovementEntity;
}
