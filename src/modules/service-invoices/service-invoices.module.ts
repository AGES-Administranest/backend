import { Module } from '@nestjs/common';

import { NfseReadingService } from './nfse-reading.service';
import { ServiceInvoiceConfirmationService } from './service-invoice-confirmation.service';
import { ServiceInvoiceDraftService } from './service-invoice-draft.service';
import { ServiceInvoiceReviewService } from './service-invoice-review.service';
import { ServiceInvoiceUploadService } from './service-invoice-upload.service';
import { ServiceInvoicesController } from './service-invoices.controller';
import { ServiceInvoicesRepository } from './service-invoices.repository';
import { ClientModule } from '../client';
import { ExtractionModule } from '../extraction';
import { FinancialModule } from '../financial';
import { UsersModule } from '../users';

/**
 * `DocumentStorage` and `DocumentUploads` are not listed here: they come from
 * the global `StorageModule`, registered once in `AppModule`.
 */
@Module({
  imports: [ExtractionModule, ClientModule, UsersModule, FinancialModule],
  controllers: [ServiceInvoicesController],
  providers: [
    ServiceInvoiceUploadService,
    ServiceInvoiceDraftService,
    ServiceInvoiceReviewService,
    ServiceInvoiceConfirmationService,
    NfseReadingService,
    ServiceInvoicesRepository,
  ],
})
export class ServiceInvoicesModule {}
