import { Module } from '@nestjs/common';

import { TripsController } from './trips.controller';
import { TripsRepository } from './trips.repository';
import { TripsService } from './trips.service';
import { FinancialModule } from '../financial';

@Module({
  imports: [FinancialModule],
  controllers: [TripsController],
  providers: [TripsService, TripsRepository],
  exports: [TripsService],
})
export class TripsModule {}
