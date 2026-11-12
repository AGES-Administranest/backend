import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ReportKind } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { ReportHistoryRepository } from './report-history.repository';
import { documentKey, DocumentStorage } from '../../infra/storage';
import { fromIsoDate } from '../../shared/dates/iso-date';

/** A file the API generated for the user, ready to be kept. */
export interface GeneratedFile {
  kind: ReportKind;
  /** The period the file covers, both days included, as `YYYY-MM-DD`. */
  period: { from: string; to: string };
  /** What the file was generated from (see docs/data-dictionary.md). */
  filters: Prisma.InputJsonValue;
  /** The name it is downloaded under, with its extension. */
  fileName: string;
  contentType: string;
  body: Uint8Array;
}

/**
 * Keeps a generated file for the history (US32): the general report PDF
 * (US28) or the package for the accountant (US30).
 */
@Injectable()
export class ReportArchiveService {
  private readonly logger = new Logger(ReportArchiveService.name);

  constructor(
    private readonly storage: DocumentStorage,
    private readonly repository: ReportHistoryRepository,
  ) {}

  /**
   * The row is born `PENDING` with the key, the name and the size; the file
   * goes to the bucket; the row turns `DONE`. When the upload fails the row
   * turns `FAILED` and the error goes up, so the generation fails with it.
   *
   * The history lists `DONE` only, so a row that stopped half-way is never
   * shown. Since the row comes first, every object in the bucket has a row.
   *
   * @returns The id of the report, which is also part of its key.
   */
  async store(userId: string, file: GeneratedFile): Promise<string> {
    const id = randomUUID();
    const key = documentKey(userId, 'reports', id);

    await this.repository.createPending({
      id,
      userId,
      kind: file.kind,
      periodStart: fromIsoDate(file.period.from),
      periodEnd: fromIsoDate(file.period.to),
      filters: file.filters,
      fileKey: key,
      fileName: file.fileName,
      fileBytesSize: file.body.byteLength,
    });

    try {
      await this.storage.putDocument(key, file.body, file.contentType);
    } catch (error) {
      await this.markFailed(id, userId);
      throw error;
    }

    if (!(await this.repository.markDone(id, userId))) {
      throw new Error(`Report ${id} was stored but is no longer pending`);
    }
    return id;
  }

  /**
   * The upload error is the one the caller needs, so a failure to record
   * `FAILED` is only logged; the row then stays `PENDING`, still unlisted.
   */
  private async markFailed(id: string, userId: string): Promise<void> {
    try {
      await this.repository.markFailed(id, userId);
    } catch (error) {
      this.logger.error(
        `Report ${id} failed to upload and could not be marked FAILED`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
