import { ApiPropertyOptional } from '@nestjs/swagger';
import { ReportKind } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

// Keeps (page - 1) * limit inside the database's integer range.
export const REPORT_HISTORY_MAX_PAGE = 10_000;

// No `userId`: the history is scoped to the token's owner (ADR-11).
export class QueryReportHistoryDto {
  @ApiPropertyOptional({
    enum: ReportKind,
    description: 'Only reports of this kind. Without it, every kind',
  })
  @IsOptional()
  @IsEnum(ReportKind)
  kind?: ReportKind;

  @ApiPropertyOptional({
    default: 1,
    minimum: 1,
    maximum: REPORT_HISTORY_MAX_PAGE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(REPORT_HISTORY_MAX_PAGE)
  page: number = 1;

  @ApiPropertyOptional({
    default: 20,
    minimum: 1,
    maximum: 100,
    description:
      'A page shorter than this limit is the last one — there is no total count.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;
}
