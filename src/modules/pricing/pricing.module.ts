import { Module } from '@nestjs/common';

import { HourlyRateService } from './hourly-rate.service';
import { PricingController } from './pricing.controller';
import { FixedCostsModule } from '../fixed-costs';
import { PricingSettingsModule } from '../pricing-settings';

@Module({
  imports: [PricingSettingsModule, FixedCostsModule],
  controllers: [PricingController],
  providers: [HourlyRateService],
  exports: [HourlyRateService],
})
export class PricingModule {}
