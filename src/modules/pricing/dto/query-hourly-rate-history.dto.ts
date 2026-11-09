import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

import { YEAR_MONTH_PATTERN } from '../domain/hourly-rate-snapshot';

const yearMonth = {
  message: '$property must be a month written as YYYY-MM, year 2000–2100',
};

/** Both bounds are inclusive and optional: a missing one leaves that side open. */
export class QueryHourlyRateHistoryDto {
  @ApiPropertyOptional({
    pattern: YEAR_MONTH_PATTERN.source,
    example: '2026-01',
    description: 'First month listed, inclusive. Without it, the oldest one',
  })
  @IsOptional()
  @Matches(YEAR_MONTH_PATTERN, yearMonth)
  from?: string;

  @ApiPropertyOptional({
    pattern: YEAR_MONTH_PATTERN.source,
    example: '2026-10',
    description: 'Last month listed, inclusive. Without it, the latest one',
  })
  @IsOptional()
  @Matches(YEAR_MONTH_PATTERN, yearMonth)
  to?: string;
}
