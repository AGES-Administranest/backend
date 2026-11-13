import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { GenerateReportDto } from './dto/generate-report.dto';
import {
  GENERAL_REPORT_KIND,
  GeneratedReportEntity,
} from './entities/generated-report.entity';
import { GeneralReportService } from './general-report.service';
import {
  generalReportDocument,
  generalReportFileName,
} from './pdf/general-report-document';
import { PdfRenderer } from './pdf/pdf-renderer';
import { ReportsRepository } from './reports.repository';
import {
  documentKey,
  DocumentStorage,
  DOWNLOAD_TTL_MS,
} from '../../infra/storage';
import { fromIsoDate } from '../../shared/dates/iso-date';
import { UsersService } from '../users';

const PDF_CONTENT_TYPE = 'application/pdf';

/**
 * Generates the PDF of the general report and keeps it (US28, ADR-04).
 *
 * The data comes from `GeneralReportService`, the same that answers
 * `GET /reports/general`, so the document cannot disagree with it. The file
 * goes to the bucket and a row in `report` records it, which is what the
 * history (US32) lists.
 */
@Injectable()
export class ReportExportService {
  constructor(
    private readonly generalReport: GeneralReportService,
    private readonly users: UsersService,
    private readonly renderer: PdfRenderer,
    private readonly storage: DocumentStorage,
    private readonly repository: ReportsRepository,
  ) {}

  /**
   * @throws DomainError `REPORT_PERIOD_INVALID` when `from` is after `to`.
   * @throws DomainError `REPORT_SECTIONS_EMPTY` when no section is selected.
   */
  async generate(
    userId: string,
    dto: GenerateReportDto,
  ): Promise<GeneratedReportEntity> {
    const [report, profile] = await Promise.all([
      this.generalReport.generate(userId, dto),
      this.users.findProfile(userId),
    ]);
    const owner = { name: profile.name, crmv: profile.crmv?.trim() || null };
    const pdf = await this.renderer.render(
      generalReportDocument(report, owner),
    );

    const id = randomUUID();
    const key = documentKey(userId, 'reports', id);
    const fileName = generalReportFileName(report.period);
    const sections = report.sections.map(section => section.type);

    // The file first: a row without a file would be a broken item in the
    // history, while a file without a row is only unused space.
    await this.storage.putDocument(key, pdf, PDF_CONTENT_TYPE);
    await this.repository.createGenerated({
      id,
      userId,
      kind: GENERAL_REPORT_KIND,
      periodStart: fromIsoDate(report.period.from),
      periodEnd: fromIsoDate(report.period.to),
      filters: { sections },
      fileKey: key,
    });
    const download = await this.storage.createPresignedGet({
      key,
      expiresInMs: DOWNLOAD_TTL_MS,
      fileName,
    });

    return {
      id,
      kind: GENERAL_REPORT_KIND,
      fileName,
      period: report.period,
      sections,
      generatedAt: report.generatedAt,
      downloadUrl: download.url,
      downloadUrlExpiresAt: download.expiresAt,
      professionalIdComplete: owner.crmv !== null,
    };
  }
}
