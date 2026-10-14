import { Module } from '@nestjs/common';

import { PricingSettingsController } from './pricing-settings.controller';
import { PricingSettingsRepository } from './pricing-settings.repository';
import { PricingSettingsService } from './pricing-settings.service';

@Module({
  controllers: [PricingSettingsController],
  providers: [PricingSettingsService, PricingSettingsRepository],
  exports: [PricingSettingsService],
})
export class PricingSettingsModule {}
