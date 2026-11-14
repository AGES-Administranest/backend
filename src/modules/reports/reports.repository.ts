import { Injectable } from '@nestjs/common';
import { Prisma, Report, ReportStatus } from '@prisma/client';

import { runQuery } from '../../infra/prisma/prisma-errors';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface GeneratedReportRecord {
  id: string;
  userId: string;
  kind: string;
  periodStart: Date;
  periodEnd: Date;
  filters: Prisma.InputJsonValue;
  /** The key of the file in the bucket, not a URL: a signed URL expires. */
  fileKey: string;
}

/** The only place the reports module writes to the database (ADR-01). */
@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Records a report whose file is already in the bucket. */
  createGenerated(record: GeneratedReportRecord): Promise<Report> {
    return runQuery(() =>
      this.prisma.report.create({
        data: {
          id: record.id,
          userId: record.userId,
          kind: record.kind,
          periodStart: record.periodStart,
          periodEnd: record.periodEnd,
          filters: record.filters,
          fileUrl: record.fileKey,
          status: ReportStatus.DONE,
        },
      }),
    );
  }
}
