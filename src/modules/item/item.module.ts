import { Module } from '@nestjs/common';

import { ItemLotController } from './item-lot.controller';
import { ItemLotRepository } from './item-lot.repository';
import { ItemLotService } from './item-lot.service';
import { ItemController } from './item.controller';
import { ItemRepository } from './item.repository';
import { ItemService } from './item.service';
import { StockMovementsModule } from '../stock-movements';

@Module({
  // Receiving a lot is a stock movement, and the ledger is the only way to
  // write one (ADR-10).
  imports: [StockMovementsModule],
  controllers: [ItemController, ItemLotController],
  providers: [ItemService, ItemRepository, ItemLotService, ItemLotRepository],
  exports: [ItemService, ItemLotService],
})
export class ItemModule {}
