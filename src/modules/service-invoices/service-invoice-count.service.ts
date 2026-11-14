import { Injectable } from '@nestjs/common';

import { ServiceInvoicesRepository } from './service-invoices.repository';
import { Period } from '../../shared/dates/period';
import {
  TaxPackageDocument,
  TaxPackageTotals,
} from '../../shared/tax-package/tax-package.types';

/**
 * The part of the module other modules may ask for: how many confirmed notes a
 * user has in a period. The repository itself stays private to the module.
 */
@Injectable()
export class ServiceInvoiceCountService {
  constructor(private readonly repository: ServiceInvoicesRepository) {}

  countConfirmedInPeriod(userId: string, period: Period): Promise<number> {
    return this.repository.countConfirmedInPeriod(userId, period);
  }

  /** Confirmed notes of the period that have their file, and those that do not. */
  summarizeTaxPackage(
    userId: string,
    period: Period,
  ): Promise<TaxPackageTotals> {
    return this.repository.summarizeTaxPackage(userId, period);
  }

  async listTaxPackageDocuments(
    userId: string,
    period: Period,
    take: number,
  ): Promise<TaxPackageDocument[]> {
    const notes = await this.repository.findTaxPackageNotes(
      userId,
      period,
      take,
    );

    // The query already requires the date; this narrows the type.
    return notes.flatMap(note =>
      note.issueDate
        ? [
            {
              collection: 'service-invoices' as const,
              id: note.id,
              issueDate: note.issueDate,
              counterpartName: note.client?.name ?? null,
              amount: note.amount?.toNumber() ?? null,
              fileName: note.fileName,
              mimeType: note.fileMimeType,
            },
          ]
        : [],
    );
  }
}
