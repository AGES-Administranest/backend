import { ApiProperty } from '@nestjs/swagger';
import { ReportKind } from '@prisma/client';

export class ReportHistoryPeriod {
  @ApiProperty({ example: '2026-10-15', format: 'date' })
  from!: string;

  @ApiProperty({
    example: '2026-11-14',
    format: 'date',
    description: 'Included, like from',
  })
  to!: string;
}

/** A generated report as the history lists it (US32). */
export class ReportHistoryItemEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: ReportKind,
    description:
      'GENERAL_REPORT: the general report PDF (US28). TAX_PACKAGE: the package for the accountant (US30)',
  })
  kind!: ReportKind;

  @ApiProperty({
    type: String,
    example: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
    description: 'The name the file downloads under, with its extension',
  })
  fileName!: string;

  @ApiProperty({
    type: Number,
    example: 184320,
    description: 'Size of the file in bytes',
  })
  fileBytesSize!: number;

  @ApiProperty({
    type: ReportHistoryPeriod,
    nullable: true,
    description:
      'The period the file covers. Null only for a report recorded without one',
  })
  period!: ReportHistoryPeriod | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'When the report was generated',
  })
  generatedAt!: Date;
}
