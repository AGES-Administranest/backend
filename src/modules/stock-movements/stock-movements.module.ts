import { Module } from '@nestjs/common';

import { StockHistoryController } from './stock-history.controller';
import { StockHistoryRepository } from './stock-history.repository';
import { StockHistoryService } from './stock-history.service';
import { UsersModule } from '../users';

@Module({
  // UsersModule resolves the authenticated Cognito `sub` to the local user id
  // that every stock query is scoped by (ADR-11).
  imports: [UsersModule],
  controllers: [StockHistoryController],
  // The repository is a provider but never exported: outside this module the
  // only door to stock data is a service.
  providers: [StockHistoryService, StockHistoryRepository],
  exports: [StockHistoryService],
})
export class StockMovementsModule {}
