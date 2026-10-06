import { Module } from '@nestjs/common';

import { ExtractionService } from './extraction.service';
import { StockEntryDraftService } from './stock-entry-draft.service';
import { StockEntryController } from './stock-entry.controller';
import { StockEntryRepository } from './stock-entry.repository';
import { StockEntryService } from './stock-entry.service';
import { ExtractionModule } from '../extraction';
import { FinancialModule } from '../financial';
import { ItemModule } from '../item';
import { ItemMatchModule } from '../item-match';
import { SupplierModule } from '../supplier';

/**
 * `DocumentStorage` is not listed here: it comes from the global
 * `StorageModule`, registered once in `AppModule`.
 */
@Module({
  imports: [
    ExtractionModule,
    ItemModule,
    ItemMatchModule,
    SupplierModule,
    FinancialModule,
  ],
  controllers: [StockEntryController],
  // The repository stays internal: outside this module the only way in is the
  // service, same rule as `users`.
  providers: [
    StockEntryService,
    StockEntryDraftService,
    ExtractionService,
    StockEntryRepository,
  ],
  exports: [StockEntryService],
})
export class StockEntryModule {}
