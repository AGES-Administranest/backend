import { Module } from '@nestjs/common';

import { HourlyRateService } from './hourly-rate.service';
import { PricingController } from './pricing.controller';
import { ProcedureEstimateController } from './procedure-estimate.controller';
import { ProcedureEstimateRepository } from './procedure-estimate.repository';
import { ProcedureEstimateService } from './procedure-estimate.service';
import { FixedCostsModule } from '../fixed-costs';
import { PricingSettingsModule } from '../pricing-settings';
import { TripsModule } from '../trips';

@Module({
  imports: [PricingSettingsModule, FixedCostsModule, TripsModule],
  controllers: [PricingController, ProcedureEstimateController],
  providers: [
    HourlyRateService,
    ProcedureEstimateService,
    ProcedureEstimateRepository,
  ],
  exports: [HourlyRateService],
})
export class PricingModule {}
