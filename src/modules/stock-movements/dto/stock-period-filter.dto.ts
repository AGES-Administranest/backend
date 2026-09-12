import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * Period filter shared by the history and the summary endpoints.
 *
 * Every field is optional: with none of them the user's whole ledger is in
 * scope. There is deliberately no `userId` here — it comes from the token,
 * never from the request (ADR-11).
 */
export class StockPeriodFilterDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Restricts the result to one item',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-09-01T00:00:00.000Z',
    description: 'Inclusive lower bound on occurredAt (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    example: '2026-09-30T23:59:59.999Z',
    description: 'Inclusive upper bound on occurredAt (ISO 8601)',
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
