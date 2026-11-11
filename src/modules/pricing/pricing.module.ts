import { Module } from '@nestjs/common';

import { HourlyRateHistoryService } from './hourly-rate-history.service';
import { HourlyRateSnapshotRepository } from './hourly-rate-snapshot.repository';
import { HourlyRateService } from './hourly-rate.service';
import { PricingController } from './pricing.controller';
import { ProcedureEstimateController } from './procedure-estimate.controller';
import { ProcedureEstimateService } from './procedure-estimate.service';
import { ClientModule } from '../client';
import { FixedCostsModule } from '../fixed-costs';
import { ItemModule } from '../item';
import { PricingSettingsModule } from '../pricing-settings';
import { TripsModule } from '../trips';

@Module({
  imports: [
    PricingSettingsModule,
    FixedCostsModule,
    TripsModule,
    ClientModule,
    ItemModule,
  ],
  controllers: [PricingController, ProcedureEstimateController],
  providers: [
    HourlyRateService,
    HourlyRateHistoryService,
    HourlyRateSnapshotRepository,
    ProcedureEstimateService,
  ],
  exports: [HourlyRateService],
})
export class PricingModule {}
