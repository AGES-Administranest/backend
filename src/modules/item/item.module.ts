import { Module } from '@nestjs/common';

import { ItemLotController } from './item-lot.controller';
import { ItemLotRepository } from './item-lot.repository';
import { ItemLotService } from './item-lot.service';
import { ItemController } from './item.controller';
import { ItemRepository } from './item.repository';
import { ItemService } from './item.service';

@Module({
  controllers: [ItemController, ItemLotController],
  providers: [ItemService, ItemRepository, ItemLotService, ItemLotRepository],
  exports: [ItemService, ItemLotService],
})
export class ItemModule {}
