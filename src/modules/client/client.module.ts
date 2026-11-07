import { Module } from '@nestjs/common';

import { ClientController } from './client.controller';
import { ClientRepository } from './client.repository';
import { ClientService } from './client.service';
import { AppointmentsModule } from '../appointments';
import { TripsModule } from '../trips';

@Module({
  imports: [AppointmentsModule, TripsModule],
  controllers: [ClientController],
  providers: [ClientService, ClientRepository],
  exports: [ClientService],
})
export class ClientModule {}
