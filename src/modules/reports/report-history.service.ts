import { Injectable, Logger } from '@nestjs/common';
import { Report } from '@prisma/client';

import { QueryReportHistoryDto } from './dto/query-report-history.dto';
import { ReportDownloadUrlEntity } from './entities/report-download-url.entity';
import { ReportHistoryItemEntity } from './entities/report-history-item.entity';
import { reportNotFound } from './report-history.errors';
import { ReportHistoryRepository } from './report-history.repository';
import { DocumentStorage, DOWNLOAD_TTL_MS } from '../../infra/storage';
import { toIsoDate } from '../../shared/dates/iso-date';

/**
 * The history of generated reports (US32): list, download again, delete.
 * Only stored reports (`DONE`) that were not deleted exist here; anything
 * else answers `REPORT_NOT_FOUND`, the same as another user's (ADR-11).
 *
 * The file is found by the key in `file_url`, the one it was stored under:
 * the key is built once, by `ReportArchiveService.store`.
 */
@Injectable()
export class ReportHistoryService {
  private readonly logger = new Logger(ReportHistoryService.name);

  constructor(
    private readonly repository: ReportHistoryRepository,
    private readonly storage: DocumentStorage,
  ) {}

  async list(
    userId: string,
    query: QueryReportHistoryDto,
  ): Promise<ReportHistoryItemEntity[]> {
    const reports = await this.repository.findPage(userId, query);
    return reports.map(toItem);
  }

  /** @throws DomainError `REPORT_NOT_FOUND` */
  async downloadUrl(
    userId: string,
    id: string,
  ): Promise<ReportDownloadUrlEntity> {
    const report = await this.repository.findListed(id, userId);
    if (!report) throw reportNotFound(id);

    return this.storage.createPresignedGet({
      key: stored(report.fileUrl, 'file_url', report.id),
      expiresInMs: DOWNLOAD_TTL_MS,
      fileName: stored(report.fileName, 'file_name', report.id),
    });
  }

  /**
   * The row leaves the history first, then the file leaves the bucket. A
   * bucket cannot join the transaction, and the other order would list a
   * report whose file is gone if the update failed. A file that survives a
   * failed delete is only logged: no route reaches it anymore.
   *
   * @throws DomainError `REPORT_NOT_FOUND`, also on a second delete.
   */
  async remove(userId: string, id: string): Promise<void> {
    const removed = await this.repository.softDelete(id, userId);
    if (!removed) throw reportNotFound(id);

    try {
      await this.storage.deleteDocument(
        stored(removed.fileUrl, 'file_url', removed.id),
      );
    } catch (error) {
      this.logger.error(
        `Report ${id} was deleted but its file was not`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

/**
 * A column the `report_done_has_file` CHECK requires on a `DONE` row, and the
 * history reads `DONE` rows only. Null here means the database lost the CHECK.
 */
function stored<T>(value: T | null, column: string, id: string): T {
  if (value === null) {
    throw new Error(`Report ${id} is DONE without ${column}`);
  }
  return value;
}

function toItem(report: Report): ReportHistoryItemEntity {
  return {
    id: report.id,
    kind: report.kind,
    fileName: stored(report.fileName, 'file_name', report.id),
    fileBytesSize: stored(report.fileBytesSize, 'file_bytes_size', report.id),
    period:
      report.periodStart && report.periodEnd
        ? {
            from: toIsoDate(report.periodStart),
            to: toIsoDate(report.periodEnd),
          }
        : null,
    generatedAt: report.createdAt,
  };
}
