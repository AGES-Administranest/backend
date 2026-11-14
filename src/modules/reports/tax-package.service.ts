import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';

import { nameEntries } from './domain/tax-package-file-names';
import { TaxPackagePeriodDto } from './dto/tax-package-period.dto';
import {
  TaxPackageExportEntity,
  TaxPackageSkippedEntity,
} from './entities/tax-package-export.entity';
import {
  TaxPackageSummaryEntity,
  TaxPackageTypeSummaryEntity,
} from './entities/tax-package-summary.entity';
import { TAX_PACKAGE_LIMITS, TAX_PACKAGE_MIME_TYPE } from './reports.constants';
import { ArchiveEntry, writeZip } from './tax-package-archive';
import { taxPackageEmpty, taxPackageTooLarge } from './tax-package.errors';
import { documentKey, DocumentUploads, exportKey } from '../../infra/storage';
import { periodFromIsoDates } from '../../shared/dates/period';
import {
  TaxPackageCollection,
  TaxPackageTotals,
} from '../../shared/tax-package/tax-package.types';
import { ServiceInvoiceCountService } from '../service-invoices';
import { StockEntryService } from '../stock-entry';

const SKIPPED_TYPE: Record<
  TaxPackageCollection,
  TaxPackageSkippedEntity['type']
> = {
  'service-invoices': 'SERVICE_INVOICE',
  'purchase-invoices': 'PURCHASE_INVOICE',
};

/**
 * The tax package (US32): the confirmed service and purchase invoices of a
 * period that have their file in storage. It owns no table, like the rest of
 * the reports area: each module says what it has, already scoped to the user.
 */
@Injectable()
export class TaxPackageService {
  private readonly logger = new Logger(TaxPackageService.name);

  constructor(
    private readonly serviceInvoices: ServiceInvoiceCountService,
    private readonly purchaseInvoices: StockEntryService,
    private readonly documentUploads: DocumentUploads,
  ) {}

  async getSummary(
    userId: string,
    query: TaxPackagePeriodDto,
  ): Promise<TaxPackageSummaryEntity> {
    const period = periodFromIsoDates(query.from, query.to);
    const [serviceInvoice, purchaseInvoice] = await Promise.all([
      this.serviceInvoices.summarizeTaxPackage(userId, period),
      this.purchaseInvoices.summarizeTaxPackage(userId, period),
    ]);

    return {
      documentsCount: serviceInvoice.count + purchaseInvoice.count,
      totalAmount: addMoney(
        serviceInvoice.totalAmount,
        purchaseInvoice.totalAmount,
      ),
      byType: {
        serviceInvoice: typeSummary(serviceInvoice),
        purchaseInvoice: typeSummary(purchaseInvoice),
      },
      missingFiles: serviceInvoice.missingFiles + purchaseInvoice.missingFiles,
    };
  }

  /**
   * Builds the zip straight into the bucket and hands back a presigned GET.
   * The limits are checked from the database sums before a single file is
   * read, so a period that is too large fails in milliseconds.
   */
  async generate(
    userId: string,
    query: TaxPackagePeriodDto,
  ): Promise<TaxPackageExportEntity> {
    const period = periodFromIsoDates(query.from, query.to);
    const [serviceTotals, purchaseTotals] = await Promise.all([
      this.serviceInvoices.summarizeTaxPackage(userId, period),
      this.purchaseInvoices.summarizeTaxPackage(userId, period),
    ]);

    const documentsCount = serviceTotals.count + purchaseTotals.count;
    const bytesSize = serviceTotals.bytesSize + purchaseTotals.bytesSize;
    const missingFiles =
      serviceTotals.missingFiles + purchaseTotals.missingFiles;
    if (documentsCount === 0) {
      throw taxPackageEmpty(query.from, query.to, missingFiles);
    }
    if (
      documentsCount > TAX_PACKAGE_LIMITS.maxDocuments ||
      bytesSize > TAX_PACKAGE_LIMITS.maxBytesSize
    ) {
      throw taxPackageTooLarge(documentsCount, bytesSize);
    }

    // One more than the limit: enough to notice documents that arrived after
    // the sums above, without ever loading an unbounded list.
    const take = TAX_PACKAGE_LIMITS.maxDocuments + 1;
    const [services, purchases] = await Promise.all([
      this.serviceInvoices.listTaxPackageDocuments(userId, period, take),
      this.purchaseInvoices.listTaxPackageDocuments(userId, period, take),
    ]);
    const documents = [...services, ...purchases].sort(
      (a, b) =>
        a.issueDate.getTime() - b.issueDate.getTime() ||
        a.id.localeCompare(b.id),
    );
    if (documents.length > TAX_PACKAGE_LIMITS.maxDocuments) {
      throw taxPackageTooLarge(documents.length, bytesSize);
    }

    const entries: ArchiveEntry<TaxPackageSkippedEntity>[] = nameEntries(
      documents,
    ).map(({ document, name }) => ({
      name,
      key: documentKey(userId, document.collection, document.id),
      ref: {
        type: SKIPPED_TYPE[document.collection],
        id: document.id,
        reason: 'FILE_NOT_FOUND',
      },
    }));

    const fileName = `notas-fiscais_${query.from}_${query.to}.zip`;
    const key = exportKey(
      userId,
      'tax-package',
      `${query.from}_${query.to}_${randomUUID()}.zip`,
    );
    const { added, skipped } = await this.writeToStorage(key, entries);
    if (added === 0) throw taxPackageEmpty(query.from, query.to, missingFiles);

    const link = await this.documentUploads.createDownloadUrl(key, fileName);
    return {
      url: link.url,
      expiresAt: link.expiresAt,
      fileName,
      documentsCount: added,
      skipped,
    };
  }

  /**
   * The zip is built while it uploads, through a pipe, so it never exists
   * whole in memory. Whatever fails first (a read, the upload, the timeout)
   * aborts the other side, and an aborted upload leaves no object behind.
   */
  private async writeToStorage(
    key: string,
    entries: ArchiveEntry<TaxPackageSkippedEntity>[],
  ): Promise<{ added: number; skipped: TaxPackageSkippedEntity[] }> {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new Error(
            `The tax package took longer than ${TAX_PACKAGE_LIMITS.timeoutMs} ms`,
          ),
        ),
      TAX_PACKAGE_LIMITS.timeoutMs,
    );
    const output = new PassThrough();

    // Kept apart from `await`: a rejection here has to abort the zip being
    // written, not wait for the zip to finish to be noticed.
    let uploadError: unknown;
    const upload = this.documentUploads
      .putDocumentStream({
        key,
        body: output,
        contentType: TAX_PACKAGE_MIME_TYPE,
        signal: controller.signal,
      })
      .catch((error: unknown) => {
        uploadError = error;
        controller.abort(error);
      });

    try {
      const { added, missing } = await writeZip({
        entries,
        readFile: fileKey => this.documentUploads.readDocument(fileKey),
        output,
        signal: controller.signal,
      });
      if (added === 0) {
        // Nothing was written, so the upload is waiting for data that never
        // comes: end it, never leave an empty zip behind.
        controller.abort(new Error('Nothing to package'));
        output.destroy();
        await upload;
        return { added, skipped: missing };
      }

      await upload;
      if (uploadError !== undefined) {
        throw uploadError instanceof Error
          ? uploadError
          : new Error('The tax package upload failed', {
              cause: uploadError,
            });
      }

      if (missing.length > 0) {
        this.logger.warn(
          `Tax package ${key} left out ${missing.length} document(s) whose file is gone: ${missing.map(ref => ref.id).join(', ')}`,
        );
      }
      return { added, skipped: missing };
    } catch (error) {
      controller.abort(error);
      output.destroy();
      await upload;
      throw error;
    } finally {
      clearTimeout(timer);
      if (!output.destroyed) output.destroy();
    }
  }
}

function typeSummary(totals: TaxPackageTotals): TaxPackageTypeSummaryEntity {
  return {
    count: totals.count,
    totalAmount: totals.totalAmount,
    missingFiles: totals.missingFiles,
  };
}

/** Both come from `DECIMAL(14, 2)`: rounding to cents undoes the float noise of the sum. */
function addMoney(a: number, b: number): number {
  return Math.round((a + b) * 100) / 100;
}
