import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional } from 'class-validator';

import { IsIsoDate } from '../../../shared/dates/iso-date';

export class QueryClientPeriodDto {
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
}
