import { Injectable } from '@nestjs/common';
import {
  Appointment,
  Prisma,
  StockMovement,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import {
  AppointmentsRepository,
  ItemUsage,
  ItemWithLots,
} from './appointments.repository';
import {
  assertValidMovement,
  balanceRequiresAdjustment,
} from '../stock-movements';
import { currentLot } from './domain/current-lot';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import {
  AppointmentItemUsageDto,
  RegisterAppointmentItemsDto,
} from './dto/register-appointment-items.dto';
import { UpdateAppointmentDto } from './dto/update-appointment.dto';
import {
  AppointmentItemMovementEntity,
  InsufficientStockWarningEntity,
  RegisterAppointmentItemsResultEntity,
} from './entities/appointment-items.entity';
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

  /**
   * US06: records the supplies used in an appointment as stock consumption.
   * Each line becomes an OUTBOUND movement with source APPOINTMENT, dated at
   * the appointment's `startsAt`, costed at the item's current lot.
   *
   * Insufficient stock does not block the registration — the movement is
   * recorded anyway and the item goes negative, to be reconciled later by a
   * manual adjustment (US12). The caller is told through `warnings`.
   */
  async registerItems(
    appointmentId: string,
    userId: string,
    dto: RegisterAppointmentItemsDto,
  ): Promise<RegisterAppointmentItemsResultEntity> {
    const appointment = await this.appointmentsRepository.findById(
      appointmentId,
      userId,
    );
    if (!appointment) throw this.notFound(appointmentId);

    const itemIds = [...new Set(dto.items.map(line => line.itemId))];
    const items = await this.appointmentsRepository.findItemsWithLots(
      itemIds,
      userId,
    );
    const itemsById = new Map(items.map(item => [item.id, item]));

    const usages = dto.items.map(line =>
      this.toUsage(line, itemsById.get(line.itemId)),
    );

    const recorded = await this.appointmentsRepository.recordItemUsage(
      userId,
      appointment.id,
      appointment.startsAt,
      usages,
    );

    const warnings: InsufficientStockWarningEntity[] = [];
    for (const { movement, itemBalance } of recorded) {
      const alreadyWarned = warnings.some(w => w.itemId === movement.itemId);
      if (balanceRequiresAdjustment(itemBalance) && !alreadyWarned) {
        warnings.push({
          warning: 'insufficient_stock',
          itemId: movement.itemId,
        });
      }
    }

    return {
      appointmentId: appointment.id,
      movements: recorded.map(({ movement }) => this.toMovement(movement)),
      warnings,
    };
  }

  private toUsage(
    line: AppointmentItemUsageDto,
    item: ItemWithLots | undefined,
  ): ItemUsage {
    // An item of another account is indistinguishable from a missing one
    // (ADR-11): answering anything but 404 would confirm the id exists.
    if (!item) throw this.itemNotFound(line.itemId);

    assertValidMovement({
      type: StockMovementType.OUTBOUND,
      source: StockMovementSource.APPOINTMENT,
      quantity: line.quantity,
    });

    const lot = currentLot(item.lots);
    const unitCost = lot?.unitCost ?? item.defaultUnitCost;
    if (!unitCost) throw this.unitCostUnknown(item.id);

    return {
      itemId: item.id,
      lotId: lot?.id ?? null,
      quantity: new Prisma.Decimal(line.quantity),
      unitCost,
    };
  }

  private toMovement(movement: StockMovement): AppointmentItemMovementEntity {
    return {
      id: movement.id,
      itemId: movement.itemId,
      lotId: movement.lotId,
      type: movement.type,
      source: movement.source,
      quantity: movement.quantity,
      unitCost: movement.unitCost,
      occurredAt: movement.occurredAt,
      createdAt: movement.createdAt,
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

  private itemNotFound(id: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'ITEM_NOT_FOUND',
      `Item ${id} not found`,
      { id },
    );
  }

  private unitCostUnknown(itemId: string): DomainError {
    return new DomainError(
      'INVALID_INPUT',
      'ITEM_LOT_UNIT_COST_REQUIRED',
      'The item has no lot and no defaultUnitCost to cost this consumption',
      { itemId },
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
