import { Module } from '@nestjs/common';

import { NfseReadingService } from './nfse-reading.service';
import { ServiceInvoiceDraftService } from './service-invoice-draft.service';
import { ServiceInvoiceUploadService } from './service-invoice-upload.service';
import { ServiceInvoicesController } from './service-invoices.controller';
import { ServiceInvoicesRepository } from './service-invoices.repository';
import { ClientModule } from '../client';
import { ExtractionModule } from '../extraction';
import { UsersModule } from '../users';

/**
 * `DocumentStorage` and `DocumentUploads` are not listed here: they come from
 * the global `StorageModule`, registered once in `AppModule`.
 */
@Module({
  imports: [ExtractionModule, ClientModule, UsersModule],
  controllers: [ServiceInvoicesController],
  providers: [
    ServiceInvoiceUploadService,
    ServiceInvoiceDraftService,
    NfseReadingService,
    ServiceInvoicesRepository,
  ],
})
export class ServiceInvoicesModule {}
