import { Module } from '@nestjs/common';

import { ClientController } from './client.controller';
import { ClientRepository } from './client.repository';
import { ClientService } from './client.service';
import { AppointmentsModule } from '../appointments';

@Module({
  imports: [AppointmentsModule],
  controllers: [ClientController],
  providers: [ClientService, ClientRepository],
  exports: [ClientService],
})
export class ClientModule {}
