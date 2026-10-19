import { Injectable } from '@nestjs/common';
import { Client } from '@prisma/client';

import { ClientEntity } from './client.entity';
import { ClientRepository } from './client.repository';
import { CreateClientDto } from './dto/create-client.dto';
import { DeleteClientDto } from './dto/delete-client.dto';
import { QueryClientDto } from './dto/query-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { RecordNotFoundError } from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

@Injectable()
export class ClientService {
  constructor(private readonly clientRepository: ClientRepository) {}

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

  async findOne(id: string, userId: string): Promise<ClientEntity> {
    const client = await this.clientRepository.findById(id, userId);
    if (!client) throw this.clientNotFound(id);
    return this.sanitize(client);
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
