import { Injectable } from '@nestjs/common';
import {
  Appointment,
  AppointmentStatus,
  FinancialEntry,
  Prisma,
} from '@prisma/client';

import { AppointmentsRepository } from './appointments.repository';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { CompleteAppointmentDto } from './dto/complete-appointment.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { QueryAppointmentDto } from './dto/query-appointment.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import {
  AppointmentEntity,
  CheckConflictResultEntity,
  CompletedAppointmentEntity,
  ConflictingAppointmentEntity,
} from './entities/appointment.entity';
import {
  InvalidReferenceError,
  RecordNotFoundError,
} from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';
import { FinancialEntryEntity } from '../financial';

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
    const status = dto.status ?? AppointmentStatus.SCHEDULED;
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : undefined;

    // A retried request (same `clientGeneratedId`) must answer with the record
    // it already created — before the conflict check, which would otherwise
    // collide with that very record.
    if (dto.clientGeneratedId) {
      const existing =
        await this.appointmentsRepository.findByClientGeneratedId(
          dto.clientGeneratedId,
          userId,
        );
      if (existing) {
        return { appointment: this.sanitize(existing), created: false };
      }
    }

    this.assertValidInterval(startsAt, endsAt);
    this.validateAmount(status, dto.amount ?? null);
    if (status === AppointmentStatus.SCHEDULED && endsAt) {
      await this.assertNoConflict(userId, startsAt, endsAt);
    }

    try {
      const result = await this.appointmentsRepository.create(
        {
          userId,
          status,
          clientGeneratedId: dto.clientGeneratedId,
          clientId: dto.clientId,
          procedureName: dto.procedureName,
          startsAt,
          endsAt,
          location: dto.location,
          amount: dto.amount,
          patientName: dto.patientName,
          ownerName: dto.ownerName,
          species: dto.species,
          patientAgeYears: dto.patientAgeYears,
          weightKg: dto.weightKg,
          notes: dto.notes,
          asa: dto.asa,
        },
        userId,
      );
      return {
        appointment: this.sanitize(result.appointment),
        created: result.created,
      };
    } catch (error) {
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
        const existing =
          await this.appointmentsRepository.findByClientGeneratedId(
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
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : existing.startsAt;
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : existing.endsAt;
    this.assertValidInterval(startsAt, endsAt);
    this.validateAmount(status, dto.amount ?? existing.amount);

    const intervalChanged =
      dto.startsAt !== undefined || dto.endsAt !== undefined;
    if (intervalChanged && status === AppointmentStatus.SCHEDULED && endsAt) {
      await this.assertNoConflict(userId, startsAt, endsAt, id);
    }

    try {
      const appointment = await this.appointmentsRepository.update(id, userId, {
        status: dto.status,
        clientId: dto.clientId,
        procedureName: dto.procedureName,
        startsAt: dto.startsAt ? startsAt : undefined,
        endsAt: dto.endsAt ? endsAt : undefined,
        location: dto.location,
        amount: dto.amount,
        patientName: dto.patientName,
        ownerName: dto.ownerName,
        species: dto.species,
        patientAgeYears: dto.patientAgeYears,
        weightKg: dto.weightKg,
        notes: dto.notes,
        asa: dto.asa,
      });
      if (!appointment) throw this.notFound(id);
      return this.sanitize(appointment);
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.notFound(id);
      if (error instanceof InvalidReferenceError)
        throw this.invalidReference(error.field);
      throw error;
    }
  }

  /**
   * Turns a SCHEDULED appointment into a performed procedure and posts its
   * revenue. `amount` may be left out when the appointment already has one.
   */
  async complete(
    id: string,
    userId: string,
    dto: CompleteAppointmentDto,
  ): Promise<CompletedAppointmentEntity> {
    const existing = await this.appointmentsRepository.findById(id, userId);
    if (!existing) throw this.notFound(id);
    if (existing.status !== AppointmentStatus.SCHEDULED)
      throw this.notScheduled(existing.status);

    const amount = dto.amount ?? existing.amount;
    this.validateAmount(AppointmentStatus.COMPLETED, amount);

    const result = await this.appointmentsRepository.complete(
      id,
      userId,
      // validateAmount has just rejected a missing amount.
      amount!,
      {
        procedureName: dto.procedureName,
        patientName: dto.patientName,
        ownerName: dto.ownerName,
        species: dto.species,
        patientAgeYears: dto.patientAgeYears,
        weightKg: dto.weightKg,
        notes: dto.notes,
        asa: dto.asa,
      },
    );

    if (!result) {
      // Another /complete or /cancel got there between the read and the write.
      const current = await this.appointmentsRepository.findById(id, userId);
      if (!current) throw this.notFound(id);
      throw this.notScheduled(current.status);
    }

    return {
      ...this.sanitize(result.appointment),
      financialEntry: this.sanitizeFinancialEntry(result.financialEntry),
    };
  }

  async cancel(
    id: string,
    userId: string,
    dto: CancelAppointmentDto,
  ): Promise<AppointmentEntity> {
    const existing = await this.appointmentsRepository.findById(id, userId);
    if (!existing) throw this.notFound(id);
    if (existing.status !== AppointmentStatus.SCHEDULED)
      throw this.notScheduled(existing.status);

    const appointment = await this.appointmentsRepository.cancel(
      id,
      userId,
      dto.reason,
    );

    if (!appointment) {
      const current = await this.appointmentsRepository.findById(id, userId);
      if (!current) throw this.notFound(id);
      throw this.notScheduled(current.status);
    }

    return this.sanitize(appointment);
  }

  async remove(id: string, userId: string): Promise<AppointmentEntity> {
    const appointment = await this.appointmentsRepository.delete(id, userId);
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

  private assertValidInterval(startsAt: Date, endsAt?: Date | null): void {
    if (endsAt && endsAt <= startsAt) {
      throw new DomainError(
        'INVALID_INPUT',
        'APPOINTMENT_INVALID_INTERVAL',
        'endsAt must be after startsAt',
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
    const { userId, ...result } = appointment;
    void userId;
    return result;
  }

  private sanitizeFinancialEntry(entry: FinancialEntry): FinancialEntryEntity {
    const { userId, ...result } = entry;
    void userId;
    return result;
  }

  private notScheduled(status: AppointmentStatus): DomainError {
    return new DomainError(
      'CONFLICT',
      'APPOINTMENT_NOT_SCHEDULED',
      'Only a scheduled appointment can be completed',
      { status },
    );
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
