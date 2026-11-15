import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsIn, IsOptional } from 'class-validator';

import { QueryReportsAvailabilityDto } from './query-reports-availability.dto';
import { REPORT_SECTIONS, type ReportSection } from '../domain/report-sections';

/**
 * `a,b` and `sections=a&sections=b` both become `['a', 'b']`. Anything that is
 * not text is kept as is, for `@IsIn` to refuse it.
 */
function toSectionList({ value }: { value: unknown }): unknown {
  if (value === undefined || value === null) return undefined;
  return [value].flat().flatMap(item =>
    typeof item === 'string'
      ? item
          .split(',')
          .map(part => part.trim())
          .filter(part => part !== '')
      : [item],
  );
}

// Same period as the availability check (US26), so both read the same records.
export class QueryGeneralReportDto extends QueryReportsAvailabilityDto {
  @ApiPropertyOptional({
    enum: REPORT_SECTIONS,
    isArray: true,
    example: ['FINANCIAL', 'APPOINTMENTS'],
    description:
      'Sections to include, comma-separated. Without it, every section. Present but empty is refused with REPORT_SECTIONS_EMPTY.',
  })
  @IsOptional()
  @Transform(toSectionList)
  @IsArray()
  @IsIn(REPORT_SECTIONS, { each: true })
  sections?: ReportSection[];
}
