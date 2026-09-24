import { Injectable } from '@nestjs/common';
import { Appointment, AppointmentStatus, Prisma } from '@prisma/client';

import { AppointmentsRepository } from './appointments.repository';
import { AppointmentTimeConflictError } from './appointment-time-conflict.error';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { QueryAppointmentDto } from './dto/query-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import { AppointmentEntity } from './entities/appointment.entity';
import {
  InvalidReferenceError,
  RecordNotFoundError,
} from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly appointmentsRepository: AppointmentsRepository,
  ) {}

  async findAll(
    userId: string,
    query: QueryAppointmentDto,
  ): Promise<AppointmentEntity[]> {
    const where: Prisma.AppointmentWhereInput = {
      userId,
      status: query.status,
      deletedAt: null,
      ...(query.from || query.to
        ? {
            startsAt: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    };
    const appointments = await this.appointmentsRepository.findMany(
      where,
      (query.page - 1) * query.pageSize,
      query.pageSize,
    );
    return appointments.map(appointment => this.sanitize(appointment));
  }

  async findOne(id: string, userId: string): Promise<AppointmentEntity> {
    const appointment = await this.appointmentsRepository.findById(id, userId);
    if (!appointment) throw this.notFound(id);
    return this.sanitize(appointment);
  }

  async create(
    userId: string,
    dto: CreateAppointmentDto,
  ): Promise<AppointmentEntity> {
    const result = await this.createWithResult(userId, dto);
    return result.appointment;
  }

  async createWithResult(
    userId: string,
    dto: CreateAppointmentDto,
  ): Promise<{ appointment: AppointmentEntity; created: boolean }> {
    this.validateDates(dto.startsAt, dto.endsAt);
    this.validateAmount(
      dto.status ?? AppointmentStatus.SCHEDULED,
      dto.amount ?? null,
    );
    try {
      const result = await this.appointmentsRepository.create(
        { ...dto, userId, status: dto.status ?? AppointmentStatus.SCHEDULED },
        userId,
      );
      return { appointment: this.sanitize(result.appointment), created: result.created };
    } catch (error) {
      if (error instanceof AppointmentTimeConflictError)
        throw this.timeConflict();
      if (error instanceof InvalidReferenceError)
        throw this.invalidReference(error.field);
      throw error;
    }
  }

  async sync(
    userId: string,
    appointments: CreateAppointmentDto[],
  ): Promise<AppointmentEntity[]> {
    const results: AppointmentEntity[] = [];

    for (const dto of appointments) {
      if (dto.clientGeneratedId) {
        const existing = await this.appointmentsRepository.findByClientGeneratedId(
          dto.clientGeneratedId,
          userId,
        );
        if (existing) {
          results.push(await this.update(existing.id, userId, dto));
          continue;
        }
      }

      results.push((await this.createWithResult(userId, dto)).appointment);
    }

    return results;
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateAppointmentDto,
  ): Promise<AppointmentEntity> {
    const existing = await this.appointmentsRepository.findById(id, userId);
    if (!existing) throw this.notFound(id);
    const status = dto.status ?? existing.status;
    this.validateDates(
      dto.startsAt ?? existing.startsAt,
      dto.endsAt ?? existing.endsAt ?? undefined,
    );
    this.validateAmount(status, dto.amount ?? existing.amount);

    try {
      const appointment = await this.appointmentsRepository.update(
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

  async remove(id: string, userId: string): Promise<AppointmentEntity> {
    const appointment = await this.appointmentsRepository.delete(id, userId);
    if (!appointment) throw this.notFound(id);
    return this.sanitize(appointment);
  }

  private validateDates(startsAt: Date, endsAt?: Date): void {
    if (endsAt && startsAt >= endsAt) {
      throw new DomainError(
        'INVALID_INPUT',
        'INVALID_REQUEST',
        'startsAt must be before endsAt',
        { startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() },
      );
    }
  }

  private validateAmount(
    status: AppointmentStatus,
    amount: number | Prisma.Decimal | null,
  ): void {
    if (status === AppointmentStatus.COMPLETED && amount === null) {
      throw new DomainError(
        'INVALID_INPUT',
        'INVALID_REQUEST',
        'amount is required for completed appointments',
      );
    }
  }

  private sanitize(appointment: Appointment): AppointmentEntity {
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

  private timeConflict(): DomainError {
    return new DomainError(
      'CONFLICT',
      'APPOINTMENT_TIME_CONFLICT',
      'The appointment time conflicts with an existing appointment',
    );
  }
}
