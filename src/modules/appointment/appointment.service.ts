import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { AppointmentRepository } from './appointment.repository';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentEntity } from './entities/appointment.entity';
import {
  InvalidReferenceError,
  RecordNotFoundError,
} from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

@Injectable()
export class AppointmentService {
  constructor(private readonly appointmentRepository: AppointmentRepository) {}

  async findAll(
    userId: string,
    page = 1,
    limit = 20,
  ): Promise<AppointmentEntity[]> {
    const appointments = await this.appointmentRepository.findMany(
      { userId, deletedAt: null },
      (page - 1) * limit,
      limit,
    );
    return appointments.map(appointment => this.sanitize(appointment));
  }

  async findOne(id: string, userId: string): Promise<AppointmentEntity> {
    const appointment = await this.appointmentRepository.findById(id, userId);
    if (!appointment) throw this.notFound(id);
    return this.sanitize(appointment);
  }

  async create(
    userId: string,
    dto: CreateAppointmentDto,
  ): Promise<AppointmentEntity> {
    try {
      const appointment = await this.appointmentRepository.create({
        ...dto,
        userId,
        updatedAt: new Date(),
      });
      return this.sanitize(appointment);
    } catch (error) {
      if (error instanceof InvalidReferenceError)
        throw this.invalidReference(error.field);
      throw error;
    }
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateAppointmentDto,
  ): Promise<AppointmentEntity> {
    try {
      const appointment = await this.appointmentRepository.update(
        id,
        userId,
        dto,
      );
      if (!appointment) throw this.notFound(id);
      return this.sanitize(appointment);
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.notFound(id);
      if (error instanceof InvalidReferenceError)
        throw this.invalidReference(error.field);
      throw error;
    }
  }

  async remove(id: string, userId: string): Promise<void> {
    const appointment = await this.appointmentRepository.delete(id, userId);
    if (!appointment) throw this.notFound(id);
  }

  private sanitize(appointment: Prisma.AppointmentGetPayload<object>): AppointmentEntity {
    const { userId, ...result } = appointment;
    void userId;
    return result;
  }

  private notFound(id: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'APPOINTMENT_NOT_FOUND',
      `Appointment ${id} not found`,
      { id },
    );
  }

  private invalidReference(field?: string): DomainError {
    return new DomainError(
      'INVALID_REFERENCE',
      'INVALID_REFERENCE',
      'The provided reference does not exist or is invalid',
      { field },
    );
  }
}