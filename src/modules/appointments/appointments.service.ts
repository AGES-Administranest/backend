import { Injectable } from '@nestjs/common';
import {
  Appointment,
  AppointmentStatus,
  FinancialEntry,
  Prisma,
  StockMovement,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import {
  AppointmentsRepository,
  ItemUsage,
  ItemWithLots,
  RecordedItemUsage,
} from './appointments.repository';
import {
  assertValidMovement,
  balanceRequiresAdjustment,
} from '../stock-movements';
import { currentLot } from './domain/current-lot';
import { CompleteAppointmentDto } from './dto/complete-appointment.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { QueryAppointmentDto } from './dto/query-appointment.dto';
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
  CompletedAppointmentEntity,
  ConflictingAppointmentEntity,
} from './entities/appointment.entity';
import {
  InvalidReferenceError,
  RecordNotFoundError,
  UniqueConstraintError,
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

  /**
   * US06: records the supplies used in an appointment as stock consumption.
   * Each line becomes an OUTBOUND movement with source APPOINTMENT, dated at
   * the appointment's `startsAt`, costed at the item's current lot.
   *
   * Insufficient stock does not block the registration — the movement is
   * recorded anyway and the item goes negative, to be reconciled later by a
   * manual adjustment (US12). The caller is told through `warnings`.
   *
   * A canceled appointment takes no supplies (409 APPOINTMENT_CANCELED); a
   * scheduled or completed one does.
   *
   * Idempotent per line (ADR-08/09): a line whose `clientGeneratedId` was
   * already recorded answers with that movement and deducts nothing again, so
   * the app can resend a request whose response it never received.
   */
  registerItems(
    appointmentId: string,
    userId: string,
    dto: RegisterAppointmentItemsDto,
  ): Promise<RegisterAppointmentItemsResultEntity> {
    return this.registerItemsOnce(appointmentId, userId, dto).catch(
      (error: unknown) => {
        // Two copies of the same retry raced past the replay lookup: the
        // loser's transaction rolled back on the (user, clientGeneratedId)
        // key, and running it again now finds the winner's movements.
        if (error instanceof UniqueConstraintError) {
          return this.registerItemsOnce(appointmentId, userId, dto);
        }
        throw error;
      },
    );
  }

  private async registerItemsOnce(
    appointmentId: string,
    userId: string,
    dto: RegisterAppointmentItemsDto,
  ): Promise<RegisterAppointmentItemsResultEntity> {
    const appointment = await this.appointmentsRepository.findById(
      appointmentId,
      userId,
    );
    if (!appointment) throw this.notFound(appointmentId);

    const replayed = await this.findReplayedLines(
      appointment.id,
      userId,
      dto.items,
    );
    const pending = dto.items.filter(
      line => !replayed.has(line.clientGeneratedId ?? ''),
    );

    const itemIds = [...new Set(dto.items.map(line => line.itemId))];
    const items = await this.appointmentsRepository.findItemsWithLots(
      itemIds,
      userId,
    );
    const itemsById = new Map(items.map(item => [item.id, item]));

    const usages = pending.map(line =>
      this.toUsage(line, itemsById.get(line.itemId)),
    );

    // Checked only when there is something new to record: a pure replay still
    // answers with what was recorded before the appointment was canceled.
    let recorded: RecordedItemUsage[] = [];
    if (usages.length > 0) {
      if (appointment.status === AppointmentStatus.CANCELED) {
        throw this.appointmentCanceled(appointment.id);
      }
      const result = await this.appointmentsRepository.recordItemUsage(
        userId,
        appointment.id,
        appointment.startsAt,
        usages,
      );
      // Canceled or deleted between the read above and the transaction.
      if (!result) {
        const current = await this.appointmentsRepository.findById(
          appointment.id,
          userId,
        );
        if (!current) throw this.notFound(appointment.id);
        throw this.appointmentCanceled(appointment.id);
      }
      recorded = result;
    }

    // The last balance seen for each item: after this request's movements
    // when it recorded any, otherwise the current cache (a pure replay).
    const balances = new Map(
      items.map(item => [item.id, item.currentQuantity]),
    );
    for (const { movement, itemBalance } of recorded) {
      balances.set(movement.itemId, itemBalance);
    }
    const warnings: InsufficientStockWarningEntity[] = itemIds
      .filter(itemId => {
        const balance = balances.get(itemId);
        return balance !== undefined && balanceRequiresAdjustment(balance);
      })
      .map(itemId => ({ warning: 'insufficient_stock', itemId }));

    // `recorded` follows `pending`, which is `dto.items` minus the replays.
    const fresh = recorded.map(({ movement }) => movement).values();
    const movements = dto.items.map(
      line =>
        replayed.get(line.clientGeneratedId ?? '') ??
        (fresh.next().value as StockMovement),
    );

    return {
      appointmentId: appointment.id,
      movements: movements.map(movement => this.toMovement(movement)),
      warnings,
    };
  }

  /**
   * The lines of this request already recorded by an earlier one, keyed by
   * `clientGeneratedId`. A key reused for anything but the very same line —
   * another appointment, item or quantity, or twice in this request — is a
   * client bug, and answering with the old movement would hide it.
   */
  private async findReplayedLines(
    appointmentId: string,
    userId: string,
    lines: readonly AppointmentItemUsageDto[],
  ): Promise<Map<string, StockMovement>> {
    const keys = lines.flatMap(line =>
      line.clientGeneratedId ? [line.clientGeneratedId] : [],
    );
    const duplicated = keys.find((key, index) => keys.indexOf(key) !== index);
    if (duplicated) throw this.clientIdConflict(duplicated);
    if (keys.length === 0) return new Map();

    const earlier =
      await this.appointmentsRepository.findMovementsByClientGeneratedIds(
        keys,
        userId,
      );
    const replayed = new Map<string, StockMovement>();
    for (const movement of earlier) {
      const key = movement.clientGeneratedId!;
      const line = lines.find(l => l.clientGeneratedId === key)!;
      const sameLine =
        movement.source === StockMovementSource.APPOINTMENT &&
        movement.appointmentId === appointmentId &&
        movement.itemId === line.itemId &&
        movement.quantity.equals(line.quantity);
      if (!sameLine) throw this.clientIdConflict(key);
      replayed.set(key, movement);
    }
    return replayed;
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
      clientGeneratedId: line.clientGeneratedId ?? null,
      itemId: item.id,
      lotId: lot?.id ?? null,
      quantity: new Prisma.Decimal(line.quantity),
      unitCost,
    };
  }

  private toMovement(movement: StockMovement): AppointmentItemMovementEntity {
    return {
      id: movement.id,
      clientGeneratedId: movement.clientGeneratedId,
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

  private itemNotFound(id: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'ITEM_NOT_FOUND',
      `Item ${id} not found`,
      { id },
    );
  }

  private appointmentCanceled(id: string): DomainError {
    return new DomainError(
      'CONFLICT',
      'APPOINTMENT_CANCELED',
      'Supplies cannot be registered on a canceled appointment',
      { id },
    );
  }

  private clientIdConflict(clientGeneratedId: string): DomainError {
    return new DomainError(
      'CONFLICT',
      'STOCK_MOVEMENT_CLIENT_ID_CONFLICT',
      'This clientGeneratedId was already used for a different line',
      { clientGeneratedId },
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
