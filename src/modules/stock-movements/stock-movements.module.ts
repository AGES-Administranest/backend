import { Module } from '@nestjs/common';

import { StockMovementsController } from './stock-movements.controller';
import { StockMovementsRepository } from './stock-movements.repository';
import { StockMovementsService } from './stock-movements.service';

@Module({
  controllers: [StockMovementsController],
  // The repository is a provider but never exported: outside this module the
  // only door to stock data is StockMovementsService.
  providers: [StockMovementsService, StockMovementsRepository],
  exports: [StockMovementsService],
})
export class StockMovementsModule {}
