import { Module } from '@nestjs/common';

import { TripsController } from './trips.controller';
import { TripsRepository } from './trips.repository';
import { TripsService } from './trips.service';

@Module({
  controllers: [TripsController],
  providers: [TripsService, TripsRepository],
  exports: [TripsService],
})
export class TripsModule {}
