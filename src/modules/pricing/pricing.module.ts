import { Module } from '@nestjs/common';

import { HourlyRateHistoryService } from './hourly-rate-history.service';
import { HourlyRateSnapshotRepository } from './hourly-rate-snapshot.repository';
import { HourlyRateService } from './hourly-rate.service';
import { PricingController } from './pricing.controller';
import { FixedCostsModule } from '../fixed-costs';
import { PricingSettingsModule } from '../pricing-settings';

@Module({
  imports: [PricingSettingsModule, FixedCostsModule],
  controllers: [PricingController],
  providers: [
    HourlyRateService,
    HourlyRateHistoryService,
    HourlyRateSnapshotRepository,
  ],
  exports: [HourlyRateService],
})
export class PricingModule {}
