import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

import { IsIsoDate } from '../../../shared/validation/iso-date';

// No `userId`: the listing is scoped to the token's owner (ADR-11).
export class QueryTripDto {
  /** First day of the period, inclusive. */
  @IsOptional()
  @IsIsoDate()
  from?: string;

  /** Last day of the period, inclusive. */
  @IsOptional()
  @IsIsoDate()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}
