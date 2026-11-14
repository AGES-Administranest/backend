import { Injectable } from '@nestjs/common';
import { ReportKind } from '@prisma/client';

import { GenerateReportDto } from './dto/generate-report.dto';
import { GeneratedReportEntity } from './entities/generated-report.entity';
import { GeneralReportService } from './general-report.service';
import {
  generalReportDocument,
  generalReportFileName,
} from './pdf/general-report-document';
import { PdfRenderer } from './pdf/pdf-renderer';
import { ReportArchiveService } from './report-archive.service';
import {
  documentKey,
  DocumentStorage,
  DOWNLOAD_TTL_MS,
} from '../../infra/storage';
import { UsersService } from '../users';

const PDF_CONTENT_TYPE = 'application/pdf';

/**
 * Generates the PDF of the general report and keeps it (US28, ADR-04).
 *
 * The data comes from `GeneralReportService`, the same that answers
 * `GET /reports/general`, so the document cannot disagree with it. The file
 * is kept by `ReportArchiveService`, which records it in `report` for the
 * history (US32).
 */
@Injectable()
export class ReportExportService {
  constructor(
    private readonly generalReport: GeneralReportService,
    private readonly users: UsersService,
    private readonly renderer: PdfRenderer,
    private readonly storage: DocumentStorage,
    private readonly archive: ReportArchiveService,
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

    const fileName = generalReportFileName(report.period);
    const sections = report.sections.map(section => section.type);

    // PENDING, then the file, then DONE. A failed upload leaves a FAILED row,
    // which the history never lists, and the error fails this request.
    const id = await this.archive.store(userId, {
      kind: ReportKind.GENERAL_REPORT,
      period: report.period,
      filters: { sections },
      fileName,
      contentType: PDF_CONTENT_TYPE,
      body: pdf,
    });
    const download = await this.storage.createPresignedGet({
      key: documentKey(userId, 'reports', id),
      expiresInMs: DOWNLOAD_TTL_MS,
      fileName,
    });

    return {
      id,
      kind: ReportKind.GENERAL_REPORT,
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
