import { Injectable } from '@nestjs/common';
import { Prisma, Trip, TripMode } from '@prisma/client';

import { snapshotCostPerKm, tripCost } from './domain/trip-cost';
import { isSameTrip, modeViolations, TripDraft } from './domain/trip-rules';
import { CreateTripDto } from './dto/create-trip.dto';
import { QueryTripDto } from './dto/query-trip.dto';
import { UpdateTripDto } from './dto/update-trip.dto';
import { TripEntity, TripListEntity } from './entities/trip.entity';
import { TripsRepository } from './trips.repository';
import { UniqueConstraintError } from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';
import { fromIsoDate, toIsoDate } from '../../shared/validation/iso-date';
import { FinancialEntryService } from '../financial';

type Tx = Prisma.TransactionClient;

/** The columns a trip is saved with, once its references and cost are resolved. */
type TripData = Pick<
  Trip,
  | 'mode'
  | 'vehicleId'
  | 'appointmentId'
  | 'clientId'
  | 'occurredOn'
  | 'origin'
  | 'destination'
  | 'distanceKm'
  | 'costPerKm'
  | 'cost'
>;

const toDecimal = (value: number | null | undefined): Prisma.Decimal | null =>
  value === null || value === undefined ? null : new Prisma.Decimal(value);

const money = (value: Prisma.Decimal): string =>
  value.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);

@Injectable()
export class TripsService {
  constructor(
    private readonly tripsRepository: TripsRepository,
    private readonly financialEntries: FinancialEntryService,
  ) {}

  async findAll(userId: string, query: QueryTripDto): Promise<TripListEntity> {
    const from = query.from ? fromIsoDate(query.from) : undefined;
    const to = query.to ? fromIsoDate(query.to) : undefined;
    if (from && to && from > to) {
      throw new DomainError(
        'INVALID_INPUT',
        'INVALID_REQUEST',
        'from must not be after to',
        { from: query.from, to: query.to },
      );
    }

    const page = await this.tripsRepository.findPage(
      userId,
      { from, to },
      (query.page - 1) * query.pageSize,
      query.pageSize,
    );

    return {
      items: page.trips.map(trip => this.toEntity(trip)),
      total: page.total,
      page: query.page,
      pageSize: query.pageSize,
      totalKm: money(page.totalKm),
      totalCost: money(page.totalCost),
    };
  }

  async findOne(id: string, userId: string): Promise<TripEntity> {
    const trip = await this.tripsRepository.findById(id, userId);
    if (!trip) throw this.notFound(id);
    return this.toEntity(trip);
  }

  /**
   * `created: false` when the device id was already used for this same trip:
   * a resend after a dropped connection answers 200 with what was saved.
   */
  async createWithResult(
    userId: string,
    dto: CreateTripDto,
  ): Promise<{ trip: TripEntity; created: boolean }> {
    const draft: TripDraft = {
      mode: dto.mode,
      vehicleId: dto.vehicleId ?? null,
      appointmentId: dto.appointmentId ?? null,
      clientId: dto.clientId,
      occurredOn: fromIsoDate(dto.occurredOn),
      origin: dto.origin,
      destination: dto.destination,
      distanceKm: toDecimal(dto.distanceKm),
      cost: toDecimal(dto.cost),
    };
    this.assertModeFields(draft);

    try {
      return await this.tripsRepository.transaction(async tx => {
        if (dto.id) {
          const stored = await this.tripsRepository.findAnyById(dto.id, tx);
          if (stored) {
            return {
              trip: this.replayOf(stored, userId, draft),
              created: false,
            };
          }
        }

        const data = await this.resolve(userId, draft, null, tx);
        const trip = await this.tripsRepository.create(
          { ...data, id: dto.id, userId },
          tx,
        );
        await this.postExpense(trip, tx);
        return { trip: this.toEntity(trip), created: true };
      });
    } catch (error) {
      // Two requests with the same id raced past the lookup above.
      if (error instanceof UniqueConstraintError && dto.id) {
        const stored = await this.tripsRepository.findAnyById(dto.id);
        if (stored) {
          return { trip: this.replayOf(stored, userId, draft), created: false };
        }
      }
      throw error;
    }
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateTripDto,
  ): Promise<TripEntity> {
    return this.tripsRepository.transaction(async tx => {
      const stored = await this.tripsRepository.findById(id, userId, tx);
      // Someone else's trip is reported exactly as a missing one.
      if (!stored) throw this.notFound(id);

      const draft = this.merge(stored, dto);
      this.assertModeFields(draft);

      const data = await this.resolve(userId, draft, stored, tx);
      const trip = await this.tripsRepository.update(id, data, tx);
      await this.postExpense(trip, tx);
      return this.toEntity(trip);
    });
  }

  /**
   * Soft delete, with its expense. A second DELETE answers 404, as for
   * appointments.
   */
  async remove(id: string, userId: string): Promise<TripEntity> {
    const trip = await this.tripsRepository.transaction(async tx => {
      const deleted = await this.tripsRepository.softDelete(id, userId, tx);
      if (deleted) {
        await this.financialEntries.removeTripEntry(userId, id, tx);
      }
      return deleted;
    });
    if (!trip) throw this.notFound(id);
    return this.toEntity(trip);
  }

  /**
   * The stored trip with the PATCH applied. Switching to RIDE drops the
   * vehicle; switching to OWN_VEHICLE needs one sent. In OWN_VEHICLE, `cost`
   * is what the request sent, so that it can be refused.
   */
  private merge(stored: Trip, dto: UpdateTripDto): TripDraft {
    const mode = dto.mode ?? stored.mode;
    const keepsMode = mode === stored.mode;

    const vehicleId =
      dto.vehicleId !== undefined
        ? dto.vehicleId
        : keepsMode && mode === TripMode.OWN_VEHICLE
          ? stored.vehicleId
          : null;

    const cost =
      mode === TripMode.OWN_VEHICLE
        ? toDecimal(dto.cost)
        : dto.cost !== undefined
          ? toDecimal(dto.cost)
          : keepsMode
            ? stored.cost
            : null;

    return {
      mode,
      vehicleId,
      appointmentId:
        dto.appointmentId !== undefined
          ? dto.appointmentId
          : stored.appointmentId,
      clientId: dto.clientId,
      occurredOn:
        dto.occurredOn !== undefined
          ? fromIsoDate(dto.occurredOn)
          : stored.occurredOn,
      origin: dto.origin ?? stored.origin,
      destination: dto.destination ?? stored.destination,
      distanceKm:
        dto.distanceKm !== undefined
          ? toDecimal(dto.distanceKm)
          : stored.distanceKm,
      cost,
    };
  }

  /**
   * Checks the references the draft brings and prices it. `previous` is the
   * stored trip on PATCH, so only what changed is checked again: an old trip
   * keeps its cost per km, and its vehicle may have been inactivated since.
   */
  private async resolve(
    userId: string,
    draft: TripDraft,
    previous: Trip | null,
    tx: Tx,
  ): Promise<TripData> {
    const clientId = await this.resolveClient(userId, draft, previous, tx);

    if (draft.mode === TripMode.RIDE) {
      return {
        ...this.columns(draft, clientId),
        vehicleId: null,
        costPerKm: null,
        cost: draft.cost!,
      };
    }

    const vehicleId = draft.vehicleId!;
    const keepsVehicle =
      previous?.mode === TripMode.OWN_VEHICLE &&
      previous.vehicleId === vehicleId;
    const perKm = keepsVehicle
      ? previous.costPerKm!
      : await this.currentCostPerKm(vehicleId, userId, tx);

    return {
      ...this.columns(draft, clientId),
      vehicleId,
      costPerKm: perKm,
      cost: tripCost(draft.distanceKm!, perKm),
    };
  }

  /**
   * A clientId not sent comes from a newly linked appointment, or else stays
   * as it was. One sent alongside an appointment must be that appointment's
   * client, when it has one.
   */
  private async resolveClient(
    userId: string,
    draft: TripDraft,
    previous: Trip | null,
    tx: Tx,
  ): Promise<string | null> {
    const appointmentChanged =
      draft.appointmentId !== (previous?.appointmentId ?? null);

    let appointmentClientId: string | null = null;
    if (
      draft.appointmentId !== null &&
      (appointmentChanged || draft.clientId !== undefined)
    ) {
      const appointment = await this.tripsRepository.findAppointment(
        draft.appointmentId,
        userId,
        tx,
      );
      if (!appointment) {
        throw this.invalidReference('APPOINTMENT_NOT_FOUND', {
          appointmentId: draft.appointmentId,
        });
      }
      appointmentClientId = appointment.clientId;
    }

    if (draft.clientId === undefined) {
      return appointmentChanged && draft.appointmentId !== null
        ? appointmentClientId
        : (previous?.clientId ?? null);
    }

    if (draft.clientId !== null) {
      if (
        appointmentClientId !== null &&
        appointmentClientId !== draft.clientId
      ) {
        throw this.invalidReference('TRIP_CLIENT_MISMATCH', {
          clientId: draft.clientId,
          appointmentClientId,
        });
      }
      if (
        draft.clientId !== previous?.clientId &&
        !(await this.tripsRepository.clientExists(draft.clientId, userId, tx))
      ) {
        throw this.invalidReference('CLIENT_NOT_FOUND', {
          clientId: draft.clientId,
        });
      }
    }
    return draft.clientId;
  }

  /** What the vehicle costs per km now, for a trip that is choosing it. */
  private async currentCostPerKm(
    vehicleId: string,
    userId: string,
    tx: Tx,
  ): Promise<Prisma.Decimal> {
    const vehicle = await this.tripsRepository.findVehicle(
      vehicleId,
      userId,
      tx,
    );
    if (!vehicle) {
      throw this.invalidReference('VEHICLE_NOT_FOUND', { vehicleId });
    }
    if (!vehicle.active) {
      throw this.invalidReference('TRIP_VEHICLE_INACTIVE', { vehicleId });
    }
    return snapshotCostPerKm(vehicle.fuelPrice, vehicle.avgConsumptionKmL);
  }

  private columns(draft: TripDraft, clientId: string | null) {
    return {
      mode: draft.mode,
      appointmentId: draft.appointmentId,
      clientId,
      occurredOn: draft.occurredOn,
      origin: draft.origin,
      destination: draft.destination,
      distanceKm: draft.distanceKm,
    };
  }

  /**
   * The trip's expense follows it in the same transaction, so a trip is never
   * saved without it, nor the other way round.
   */
  private postExpense(trip: Trip, tx: Tx): Promise<void> {
    return this.financialEntries.recordTrip(
      {
        userId: trip.userId,
        tripId: trip.id,
        amount: trip.cost,
        occurredOn: trip.occurredOn,
        description: `${trip.origin} → ${trip.destination}`,
      },
      tx,
    );
  }

  /** The stored trip, when the resent one is the same and is this user's. */
  private replayOf(stored: Trip, userId: string, draft: TripDraft): TripEntity {
    if (
      stored.userId !== userId ||
      stored.deletedAt !== null ||
      !isSameTrip(stored, draft)
    ) {
      throw new DomainError(
        'CONFLICT',
        'TRIP_ID_CONFLICT',
        `The id ${stored.id} is already used by another trip`,
        { id: stored.id },
      );
    }
    return this.toEntity(stored);
  }

  private assertModeFields(draft: TripDraft): void {
    const { missing, notAllowed } = modeViolations(draft);
    if (missing.length === 0 && notAllowed.length === 0) return;

    throw new DomainError(
      'INVALID_INPUT',
      'TRIP_MODE_FIELDS_INVALID',
      `The fields do not match the ${draft.mode} mode`,
      { mode: draft.mode, missing, notAllowed },
    );
  }

  private toEntity(trip: Trip): TripEntity {
    return {
      id: trip.id,
      mode: trip.mode,
      vehicleId: trip.vehicleId,
      appointmentId: trip.appointmentId,
      clientId: trip.clientId,
      occurredOn: toIsoDate(trip.occurredOn),
      origin: trip.origin,
      destination: trip.destination,
      distanceKm: trip.distanceKm,
      costPerKm: trip.costPerKm,
      cost: trip.cost,
      createdAt: trip.createdAt,
      updatedAt: trip.updatedAt,
    };
  }

  private invalidReference(
    code:
      | 'VEHICLE_NOT_FOUND'
      | 'APPOINTMENT_NOT_FOUND'
      | 'CLIENT_NOT_FOUND'
      | 'TRIP_VEHICLE_INACTIVE'
      | 'TRIP_CLIENT_MISMATCH',
    details: Record<string, unknown>,
  ): DomainError {
    return new DomainError(
      'INVALID_REFERENCE',
      code,
      'The trip references something it cannot use',
      details,
    );
  }

  private notFound(id: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'TRIP_NOT_FOUND',
      `Trip ${id} not found`,
      {
        id,
      },
    );
  }
}
