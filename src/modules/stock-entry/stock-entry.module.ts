import { Module } from '@nestjs/common';

import { StockEntryController } from './stock-entry.controller';
import { StockEntryRepository } from './stock-entry.repository';
import { StockEntryService } from './stock-entry.service';

/**
 * `DocumentStorage` is not listed here: it comes from the global
 * `StorageModule`, registered once in `AppModule`.
 */
@Module({
  controllers: [StockEntryController],
  // The repository stays internal: outside this module the only way in is the
  // service, same rule as `users`.
  providers: [StockEntryService, StockEntryRepository],
  exports: [StockEntryService],
})
export class StockEntryModule {}
