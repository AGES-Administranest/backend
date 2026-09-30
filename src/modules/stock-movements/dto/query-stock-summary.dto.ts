import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

/**
 * Query for `GET /stock-movement/summary` (US12).
 *
 * The period is required, unlike the history's. A summary is a statement about
 * a stretch of time — "everything, ever" is not a report anyone asked for, and
 * making it the default would quietly aggregate the whole ledger.
 */
// No `userId`: the summary belongs to the token's owner (ADR-11).
export class QueryStockSummaryDto {
  @ApiProperty({
    description:
      'Start of the period, inclusive. A calendar date (YYYY-MM-DD) is read as ' +
      'the start of that day in UTC.',
    example: '2026-09-01',
  })
  @IsISO8601()
  periodStart!: string;

  @ApiProperty({
    description:
      'End of the period, inclusive. A calendar date covers the whole day.',
    example: '2026-09-30',
  })
  @IsISO8601()
  periodEnd!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Narrows the summary to one item and adds the per-item block: the balance ' +
      'it opened the period with, what moved, and what it closed with.',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string;
}
