import { Injectable } from '@nestjs/common';
import { Client } from '@prisma/client';

import { ClientEntity } from './client.entity';
import { ClientRepository } from './client.repository';
import { rankByName } from './domain/name-match';
import { CreateClientDto } from './dto/create-client.dto';
import { DeleteClientDto } from './dto/delete-client.dto';
import { QueryClientAppointmentsDto } from './dto/query-client-appointments.dto';
import { QueryClientPeriodDto } from './dto/query-client-period.dto';
import { QueryClientDto } from './dto/query-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import {
  ClientAppointmentEntity,
  ClientAppointmentListEntity,
} from './entities/client-appointment.entity';
import { ClientSummaryEntity } from './entities/client-summary.entity';
import { RecordNotFoundError } from '../../infra/prisma/prisma-errors';
import {
  startOfBusinessDay,
  startOfNextBusinessDay,
} from '../../shared/dates/business-day';
import { fromIsoDate } from '../../shared/dates/iso-date';
import { DomainError } from '../../shared/errors/domain-error';
import {
  AppointmentPeriod,
  AppointmentsService,
  ClientAppointment,
} from '../appointments';
import { TripPeriod, TripsService } from '../trips';

@Injectable()
export class ClientService {
  constructor(
    private readonly clientRepository: ClientRepository,
    private readonly appointmentsService: AppointmentsService,
    private readonly tripsService: TripsService,
  ) {}

  async findAll(
    userId: string,
    query: QueryClientDto,
  ): Promise<ClientEntity[]> {
    const clients = await this.clientRepository.findMany({
      userId,
      ...(query.type ? { type: query.type } : {}),
    });
    return clients.map(client => this.sanitize(client));
  }

  /** Id to name, deleted clients included (US29). */
  async findNames(
    userId: string,
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.clientRepository.findNames(userId, ids);
    return new Map(rows.map(row => [row.id, row.name]));
  }

  async findOne(id: string, userId: string): Promise<ClientEntity> {
    const client = await this.clientRepository.findById(id, userId);
    if (!client) throw this.clientNotFound(id);
    return this.sanitize(client);
  }

  async findAppointments(
    id: string,
    userId: string,
    { from, to, page, limit }: QueryClientAppointmentsDto,
  ): Promise<ClientAppointmentListEntity> {
    this.ensurePeriodIsOrdered(from, to);
    await this.findOne(id, userId);

    const { appointments, total } =
      await this.appointmentsService.findCompletedByClient(
        userId,
        id,
        this.toAppointmentPeriod(from, to),
        (page - 1) * limit,
        limit,
      );

    return {
      items: appointments.map(appointment => this.toHistoryItem(appointment)),
      total,
      page,
      limit,
    };
  }

  async summarize(
    id: string,
    userId: string,
    { from, to }: QueryClientPeriodDto,
  ): Promise<ClientSummaryEntity> {
    this.ensurePeriodIsOrdered(from, to);
    await this.findOne(id, userId);

    const [appointments, trips] = await Promise.all([
      this.appointmentsService.sumCompletedByClient(
        userId,
        id,
        this.toAppointmentPeriod(from, to),
      ),
      this.tripsService.totalsByClient(userId, id, this.toTripPeriod(from, to)),
    ]);

    return {
      appointmentsCount: appointments.count,
      billedTotal: appointments.amount.toFixed(2),
      tripCost: trips.cost.toFixed(2),
      tripCount: trips.count,
    };
  }

  /** An inactive client still holds its tax id; a deleted one does not. */
  async findByTaxId(
    userId: string,
    taxId: string,
  ): Promise<ClientEntity | null> {
    const client = await this.clientRepository.findByTaxId(userId, taxId);
    return client && this.sanitize(client);
  }

  /** The active clients whose name looks like `name`, the closest first. */
  async suggestByName(userId: string, name: string): Promise<ClientEntity[]> {
    const clients = await this.clientRepository.findMany({
      userId,
      active: true,
    });
    return rankByName(name, clients).map(client => this.sanitize(client));
  }

  async create(userId: string, dto: CreateClientDto): Promise<ClientEntity> {
    const existing = await this.clientRepository.findByName(userId, dto.name);
    if (existing) throw this.duplicatedName();
    if (dto.taxId) await this.ensureTaxIdIsFree(userId, dto.taxId);

    const client = await this.clientRepository.create({ ...dto, userId });
    return this.sanitize(client);
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateClientDto,
  ): Promise<ClientEntity> {
    if (dto.name !== undefined) {
      const existing = await this.clientRepository.findByName(
        userId,
        dto.name,
        id,
      );
      if (existing) throw this.duplicatedName();
    }
    if (dto.taxId) await this.ensureTaxIdIsFree(userId, dto.taxId, id);

    try {
      const client = await this.clientRepository.update(id, userId, dto);
      if (!client) throw this.clientNotFound(id);
      return this.sanitize(client);
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.clientNotFound(id);
      throw error;
    }
  }

  async remove(id: string, userId: string): Promise<DeleteClientDto> {
    try {
      const client = await this.clientRepository.delete(id, userId);
      // Someone else's client is reported exactly as a missing one.
      if (!client) throw this.clientNotFound(id);
      return { id: client.id, name: client.name };
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.clientNotFound(id);
      throw error;
    }
  }

  private sanitize(client: Client): ClientEntity {
    return {
      id: client.id,
      type: client.type,
      name: client.name,
      taxId: client.taxId,
      taxIdType: client.taxIdType,
      contactName: client.contactName,
      email: client.email,
      phone: client.phone,
      addressLine: client.addressLine,
      city: client.city,
      state: client.state,
      serviceDays: client.serviceDays,
      paymentTermsDays: client.paymentTermsDays,
      preferredPaymentMethod: client.preferredPaymentMethod,
      active: client.active,
      createdAt: client.createdAt,
      updatedAt: client.updatedAt,
    };
  }

  private ensurePeriodIsOrdered(from?: string, to?: string): void {
    // `YYYY-MM-DD` strings sort as the dates they spell.
    if (from && to && from > to) {
      throw new DomainError(
        'INVALID_INPUT',
        'INVALID_REQUEST',
        'from must not be after to',
        { from, to },
      );
    }
  }

  private toAppointmentPeriod(from?: string, to?: string): AppointmentPeriod {
    return {
      from: from ? startOfBusinessDay(from) : undefined,
      before: to ? startOfNextBusinessDay(to) : undefined,
    };
  }

  /** A trip day is a calendar date, so it needs no timezone. */
  private toTripPeriod(from?: string, to?: string): TripPeriod {
    return {
      from: from ? fromIsoDate(from) : undefined,
      to: to ? fromIsoDate(to) : undefined,
    };
  }

  private toHistoryItem(
    appointment: ClientAppointment,
  ): ClientAppointmentEntity {
    return {
      ...appointment,
      amount: appointment.amount?.toFixed(2) ?? null,
    };
  }

  private clientNotFound(id: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'CLIENT_NOT_FOUND',
      `Client ${id} not found`,
      { id },
    );
  }

  private duplicatedName(): DomainError {
    return new DomainError(
      'CONFLICT',
      'DUPLICATED_CLIENT_NAME',
      'A client with this name already exists',
    );
  }

  /** Per owner (ADR-11): another professional may register the same clinic. */
  private async ensureTaxIdIsFree(
    userId: string,
    taxId: string,
    excludeId?: string,
  ): Promise<void> {
    const holder = await this.clientRepository.findByTaxId(
      userId,
      taxId,
      excludeId,
    );
    if (holder) throw this.duplicatedTaxId();
  }

  private duplicatedTaxId(): DomainError {
    return new DomainError(
      'CONFLICT',
      'DUPLICATED_CLIENT_TAX_ID',
      'A client with this tax id already exists',
    );
  }
}
