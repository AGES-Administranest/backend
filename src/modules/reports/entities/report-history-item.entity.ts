import { ApiProperty } from '@nestjs/swagger';
import { ReportKind } from '@prisma/client';

export class ReportHistoryPeriod {
  @ApiProperty({ example: '2026-10-15', format: 'date' })
  from!: string;

  @ApiProperty({ example: '2026-11-14', format: 'date' })
  to!: string;
}

/** A generated report as the history lists it (US32). */
export class ReportHistoryItemEntity {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ReportKind })
  kind!: ReportKind;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'administranest_relatorio-geral_2026-10-15_2026-11-14.pdf',
  })
  fileName!: string | null;

  @ApiProperty({ type: Number, nullable: true, example: 184320 })
  fileBytesSize!: number | null;

  @ApiProperty({ type: ReportHistoryPeriod, nullable: true })
  period!: ReportHistoryPeriod | null;

  @ApiProperty({ type: String, format: 'date-time' })
  generatedAt!: Date;
}
