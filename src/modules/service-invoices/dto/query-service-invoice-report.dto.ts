import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { IsIsoDate } from '../../../shared/dates/iso-date';
import { REPORT_SEARCH_MAX_LENGTH } from '../service-invoices.constants';

// Trimmed before validation, so "   " counts as no search at all.
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// No `userId`: the listing is scoped to the token's owner (ADR-11).
export class QueryServiceInvoiceReportDto {
  @ApiPropertyOptional({
    example: 'veterinaria',
    maxLength: REPORT_SEARCH_MAX_LENGTH,
    description:
      "Part of the taker's name, in any letter case. Trimmed; blank is ignored",
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(REPORT_SEARCH_MAX_LENGTH)
  search?: string;

  @ApiPropertyOptional({
    example: '2026-10-01',
    format: 'date',
    description: 'Issued on or after this date. Can be sent without endDate',
  })
  @IsOptional()
  @IsIsoDate()
  startDate?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    format: 'date',
    description: 'Issued on or before this date. Can be sent without startDate',
  })
  @IsOptional()
  @IsIsoDate()
  endDate?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    default: 50,
    minimum: 1,
    maximum: 100,
    description:
      'The Reports cards ask for a few; "see all" takes the default. A page ' +
      'shorter than this limit is the last one — there is no total count.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}
