import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { QueryClientPeriodDto } from './query-client-period.dto';

// Keeps (page - 1) * limit inside the database's integer range.
export const MAX_PAGE = 10_000;

export class QueryClientAppointmentsDto extends QueryClientPeriodDto {
  @ApiPropertyOptional({
    type: Number,
    default: 1,
    minimum: 1,
    maximum: MAX_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page: number = 1;

  @ApiPropertyOptional({ type: Number, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
