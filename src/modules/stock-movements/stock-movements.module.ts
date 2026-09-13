import { Module } from '@nestjs/common';

import { StockHistoryController } from './stock-history.controller';
import { StockHistoryRepository } from './stock-history.repository';
import { StockHistoryService } from './stock-history.service';

@Module({
  controllers: [StockHistoryController],
  // The repository is a provider but never exported: outside this module the
  // only door to stock data is a service.
  providers: [StockHistoryService, StockHistoryRepository],
  exports: [StockHistoryService],
})
export class StockMovementsModule {}
