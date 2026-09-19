import { Module } from '@nestjs/common';

import { AppointmentController } from './appointment.controller';
import { AppointmentRepository } from './appointment.repository';
import { AppointmentService } from './appointment.service';

@Module({
  controllers: [AppointmentController],
  providers: [AppointmentRepository, AppointmentService],
  exports: [AppointmentService],
})
export class AppointmentModule {}