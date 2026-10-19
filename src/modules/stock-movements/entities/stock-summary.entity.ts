import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AdjustmentReason, MeasurementUnit } from '@prisma/client';

/** One bucket of the summary: how many movements, how much, worth how much. */
export class SummaryTotalsEntity {
  @ApiProperty({ description: 'Movements in this bucket' })
  count!: number;

  @ApiProperty({ type: String, example: '12.5' })
  quantity!: string;

  @ApiProperty({
    type: String,
    example: '248.50',
    description: 'Sum of quantity x unitCost, in reais',
  })
  value!: string;
}

export class ProcedureTotalsEntity extends SummaryTotalsEntity {
  @ApiProperty({
    example: 'Castração',
    description:
      'Procedure name. Spellings that differ only by case, accents or spacing ' +
      'are counted as one procedure and shown with the most common spelling — ' +
      'the field is free text, typed on a phone.',
  })
  label!: string;
}

export class AdjustmentTotalsEntity extends SummaryTotalsEntity {
  @ApiProperty({ enum: AdjustmentReason })
  reason!: AdjustmentReason;
}

/** The per-item block, present only when the query names an item. */
export class ItemPeriodSummaryEntity {
  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @ApiProperty()
  itemName!: string;

  @ApiProperty({ enum: MeasurementUnit })
  unit!: MeasurementUnit;

  @ApiProperty({
    type: String,
    example: '8',
    description:
      'Balance the item opened the period with, summed from the movements ' +
      'before it — not from the balance it carries today.',
  })
  openingBalance!: string;

  @ApiProperty({ type: SummaryTotalsEntity })
  inbound!: SummaryTotalsEntity;

  @ApiProperty({ type: SummaryTotalsEntity })
  outbound!: SummaryTotalsEntity;

  @ApiProperty({
    type: String,
    example: '14',
    description:
      'openingBalance + inbound - outbound. Checks against the ledger.',
  })
  closingBalance!: string;
}

/**
 * The period summary (US12): what came in, what went out, what it was worth.
 *
 * `adjustments` is the block worth reading first. The row with reason
 * `EXPIRATION` is money that expired on the shelf — the one number here that
 * changes what someone does next.
 */
export class StockSummaryEntity {
  @ApiProperty({ type: String, format: 'date-time' })
  periodStart!: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  periodEnd!: Date;

  @ApiProperty({ type: SummaryTotalsEntity })
  inbound!: SummaryTotalsEntity;

  @ApiProperty({ type: SummaryTotalsEntity })
  outbound!: SummaryTotalsEntity;

  @ApiProperty({
    type: ProcedureTotalsEntity,
    isArray: true,
    description: 'Consumption by appointment, heaviest first',
  })
  byProcedure!: ProcedureTotalsEntity[];

  @ApiProperty({
    type: AdjustmentTotalsEntity,
    isArray: true,
    description: 'Manual adjustments by reason, most expensive first',
  })
  adjustments!: AdjustmentTotalsEntity[];

  @ApiProperty({
    type: String,
    example: '312.40',
    description:
      'Shortcut to the number this report exists for: the value of everything ' +
      'written off as expired in the period. Zero when nothing expired.',
  })
  expiredValue!: string;

  @ApiPropertyOptional({ type: ItemPeriodSummaryEntity, nullable: true })
  item!: ItemPeriodSummaryEntity | null;
}
