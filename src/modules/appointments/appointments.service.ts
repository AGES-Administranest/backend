import { Injectable } from '@nestjs/common';
import { Appointment } from '@prisma/client';

import { AppointmentsRepository } from './appointments.repository';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import {
  AppointmentEntity,
  CheckConflictResultEntity,
  ConflictingAppointmentEntity,
} from './entities/appointment.entity';
import { DomainError } from '../../shared/errors/domain-error';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async create(
    userId: string,
    dto: CreateAppointmentDto,
  ): Promise<AppointmentEntity> {
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    this.assertValidInterval(startsAt, endsAt);
    await this.assertNoConflict(userId, startsAt, endsAt);

    const appointment = await this.appointmentsRepository.create({
      userId,
      clientId: dto.clientId,
      procedureName: dto.procedureName,
      startsAt,
      endsAt,
      notes: dto.notes,
    });
    return this.sanitize(appointment);
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateAppointmentDto,
  ): Promise<AppointmentEntity> {
    const existing = await this.appointmentsRepository.findById(id, userId);
    if (!existing) throw this.notFound(id);

    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;

    const intervalChanged =
      dto.startsAt !== undefined || dto.endsAt !== undefined;
    if (intervalChanged && endsAt) {
      this.assertValidInterval(startsAt, endsAt);
      await this.assertNoConflict(userId, startsAt, endsAt, id);
    }

    const appointment = await this.appointmentsRepository.update(id, userId, {
      clientId: dto.clientId,
      procedureName: dto.procedureName,
      startsAt: dto.startsAt ? startsAt : undefined,
      endsAt: dto.endsAt ? endsAt : undefined,
      notes: dto.notes,
    });
    if (!appointment) throw this.notFound(id);
    return this.sanitize(appointment);
  }

  /**
   * Whether `[startsAt, endsAt)` overlaps a `SCHEDULED` appointment of this
   * user. Used both by `create`/`update` (to reject the write) and by
   * `GET /appointments/check-conflict` (to let the caller ask up front).
   */
  async checkConflict(
    userId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
  ): Promise<CheckConflictResultEntity> {
    const conflicting = await this.appointmentsRepository.findConflicting(
      userId,
      startsAt,
      endsAt,
      excludeId,
    );

    if (!conflicting) return { conflict: false };
    return {
      conflict: true,
      conflictingAppointment: this.toSummary(conflicting),
    };
  }

  private async assertNoConflict(
    userId: string,
    startsAt: Date,
    endsAt: Date,
    excludeId?: string,
  ): Promise<void> {
    const result = await this.checkConflict(
      userId,
      startsAt,
      endsAt,
      excludeId,
    );
    if (result.conflict)
      throw this.timeConflict(result.conflictingAppointment!);
  }

  private assertValidInterval(startsAt: Date, endsAt: Date): void {
    if (endsAt <= startsAt) {
      throw new DomainError(
        'INVALID_INPUT',
        'APPOINTMENT_INVALID_INTERVAL',
        'endsAt must be after startsAt',
      );
    }
  }

  private toSummary(appointment: Appointment): ConflictingAppointmentEntity {
    return {
      id: appointment.id,
      startsAt: appointment.startsAt,
      // Narrowed by the `findConflicting` query itself: only rows with a
      // non-null `endsAt` can satisfy `endsAt > startsAt`.
      endsAt: appointment.endsAt as Date,
      procedureName: appointment.procedureName,
    };
  }

  private sanitize(appointment: Appointment): AppointmentEntity {
    return {
      id: appointment.id,
      clientId: appointment.clientId,
      procedureName: appointment.procedureName,
      startsAt: appointment.startsAt,
      endsAt: appointment.endsAt,
      notes: appointment.notes,
      status: appointment.status,
      createdAt: appointment.createdAt,
      updatedAt: appointment.updatedAt,
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

  private timeConflict(
    conflictingAppointment: ConflictingAppointmentEntity,
  ): DomainError {
    return new DomainError(
      'CONFLICT',
      'APPOINTMENT_TIME_CONFLICT',
      'This time slot conflicts with another scheduled appointment',
      { conflict: true, conflictingAppointment },
    );
  }
}
