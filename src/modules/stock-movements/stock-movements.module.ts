import { Module } from '@nestjs/common';

import { StockMovementsController } from './stock-movements.controller';
import { StockMovementsRepository } from './stock-movements.repository';
import { StockMovementsService } from './stock-movements.service';
import { UsersModule } from '../users';

@Module({
  // UsersModule resolves the authenticated Cognito `sub` to the local user id
  // that every stock query is scoped by (ADR-11).
  imports: [UsersModule],
  controllers: [StockMovementsController],
  // The repository is a provider but never exported: outside this module the
  // only door to stock data is StockMovementsService.
  providers: [StockMovementsService, StockMovementsRepository],
  exports: [StockMovementsService],
})
export class StockMovementsModule {}
