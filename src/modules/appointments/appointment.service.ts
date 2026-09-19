import { Injectable } from '@nestjs/common';
import { Appointment, AppointmentStatus } from '@prisma/client';

import { AppointmentRepository } from './appointment.repository';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { AppointmentEntity } from './entities/appointment.entity';
import { DomainError } from '../../shared/errors/domain-error';

@Injectable()
export class AppointmentService {
  constructor(private readonly appointmentRepository: AppointmentRepository) {}

  async cancel(
    id: string,
    userId: string,
    dto: CancelAppointmentDto,
  ): Promise<AppointmentEntity> {
    const canceled = await this.appointmentRepository.cancelIfScheduled(
      id,
      userId,
      dto.reason,
    );
    if (canceled) return this.sanitize(canceled);

    const existing = await this.appointmentRepository.findById(id, userId);
    if (!existing) throw this.notFound(id);
    throw this.notScheduled(existing.status);
  }

  private sanitize(appointment: Appointment): AppointmentEntity {
    return {
      id: appointment.id,
      clientId: appointment.clientId,
      procedureName: appointment.procedureName,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      location: appointment.location,
      amount: appointment.amount,
      patientName: appointment.patientName,
      ownerName: appointment.ownerName,
      species: appointment.species,
      patientAgeYears: appointment.patientAgeYears,
      weightKg: appointment.weightKg,
      notes: appointment.notes,
      status: appointment.status,
      createdAt: appointment.createdAt,
      updatedAt: appointment.updatedAt,
      deletedAt: appointment.deletedAt,
    };
  }

  private notFound(id: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'APPOINTMENT_NOT_FOUND',
      `Appointment ${id} not found`,
      { id },
    );
  }

  private notScheduled(status: AppointmentStatus): DomainError {
    return new DomainError(
      'CONFLICT',
      'APPOINTMENT_NOT_SCHEDULED',
      'Only a scheduled appointment can be canceled',
      { status },
    );
  }
}
