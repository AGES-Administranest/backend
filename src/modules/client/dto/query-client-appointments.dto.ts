import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { IsIsoDate } from '../../../shared/dates/iso-date';

export class QueryClientAppointmentsDto {
  @ApiPropertyOptional({
    format: 'date',
    example: '2026-11-01',
    description:
      'First day of the period, inclusive, in São Paulo time. Without it, ' +
      'no start',
  })
  @IsOptional()
  @IsIsoDate()
  from?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-11-30',
    description:
      'Last day of the period, inclusive, in São Paulo time. Without it, no ' +
      'end',
  })
  @IsOptional()
  @IsIsoDate()
  to?: string;

  @ApiPropertyOptional({ type: Number, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
