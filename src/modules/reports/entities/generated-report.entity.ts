import { ApiProperty } from '@nestjs/swagger';

import { ReportPeriod } from './general-report.entity';
import { REPORT_SECTIONS, type ReportSection } from '../domain/report-sections';

/** The value of `report.kind` for a general report (US29). */
export const GENERAL_REPORT_KIND = 'GENERAL_REPORT';

export class GeneratedReportEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: [GENERAL_REPORT_KIND] })
  kind!: typeof GENERAL_REPORT_KIND;

  @ApiProperty({
    example: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
  })
  fileName!: string;

  @ApiProperty({ type: ReportPeriod })
  period!: ReportPeriod;

  @ApiProperty({
    enum: REPORT_SECTIONS,
    isArray: true,
    description: 'The sections the document has, in its order',
  })
  sections!: ReportSection[];

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: Date;

  @ApiProperty({
    description:
      'Temporary link to the PDF, already named `fileName`. It expires: download right away',
  })
  downloadUrl!: string;

  @ApiProperty({
    example: 1794430000000,
    description: 'When `downloadUrl` stops working, in ms since the epoch',
  })
  downloadUrlExpiresAt!: number;

  @ApiProperty({
    description:
      'False when the profile has no CRMV, so the header shows the name only (US28)',
  })
  professionalIdComplete!: boolean;
}
