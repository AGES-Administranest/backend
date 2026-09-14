import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AdjustmentReason,
  MeasurementUnit,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

/**
 * Shown when the movement came out of an appointment, so the history can offer
 * a link back to it.
 */
export class MovementAppointmentEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    description:
      'Ready to display: "procedure — patient". Falls back to whichever of the ' +
      'two the appointment has, since both are optional on an appointment.',
    example: 'Orquiectomia — Mel',
  })
  label!: string;

  @ApiProperty({ nullable: true })
  procedureName!: string | null;

  @ApiProperty({ nullable: true })
  patientName!: string | null;
}

/**
 * A stock movement as the API returns it.
 *
 * `Decimal` columns travel as strings, the same convention `GET /item` follows:
 * a quantity of `10.005` does not survive a round trip through a JavaScript
 * number, and stock arithmetic is exactly where that matters.
 */
export class StockMovementEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @ApiProperty({
    description:
      "The item's current name. The ledger does not snapshot it, so renaming " +
      'an item relabels its past movements — the movement still points at the ' +
      'same item, which is what the history is about.',
  })
  itemName!: string;

  @ApiProperty({ enum: MeasurementUnit })
  unit!: MeasurementUnit;

  @ApiProperty({ format: 'uuid', nullable: true })
  lotId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  supplierId!: string | null;

  @ApiProperty({
    enum: StockMovementType,
    description: 'INBOUND adds to the balance, OUTBOUND subtracts',
  })
  type!: StockMovementType;

  @ApiProperty({ enum: StockMovementSource })
  source!: StockMovementSource;

  @ApiProperty({
    enum: AdjustmentReason,
    nullable: true,
    description:
      'Always present when source is MANUAL_ADJUSTMENT, never otherwise',
  })
  adjustmentReason!: AdjustmentReason | null;

  @ApiProperty({
    type: String,
    example: '2.000',
    description: 'Always positive — the sign comes from `type`',
  })
  quantity!: string;

  @ApiProperty({
    type: String,
    example: '19.9000',
    description: 'Cost of ONE unit, not the line total',
  })
  unitCost!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'ISO 8601 in UTC (trailing Z)',
  })
  occurredAt!: Date;

  @ApiProperty({ format: 'uuid', nullable: true })
  appointmentId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  purchaseOrderId!: string | null;

  @ApiPropertyOptional({ type: MovementAppointmentEntity, nullable: true })
  appointment!: MovementAppointmentEntity | null;

  @ApiProperty({ nullable: true })
  notes!: string | null;
}
