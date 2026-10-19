import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ItemAliasLookup, NoItemAliases } from './item-alias-lookup';
import { MatchItemService } from './match-item.service';
import { MatchSettings } from './match-settings';
import { ItemModule } from '../item';

@Module({
  imports: [ItemModule],
  providers: [
    MatchItemService,
    { provide: ItemAliasLookup, useClass: NoItemAliases },
    {
      provide: MatchSettings,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => MatchSettings.fromConfig(config),
    },
  ],
  exports: [MatchItemService],
})
export class ItemMatchModule {}
