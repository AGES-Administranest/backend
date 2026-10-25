import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { IsIsoDate } from '../../../shared/dates/iso-date';

// No `userId`: the listing is scoped to the token's owner (ADR-11).
export class QueryTripDto {
  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-01',
    description: 'First day of the period, inclusive. Without it, no start',
  })
  @IsOptional()
  @IsIsoDate()
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-10-31',
    description: 'Last day of the period, inclusive. Without it, no end',
  })
  @IsOptional()
  @IsIsoDate()
  to?: string;

  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
