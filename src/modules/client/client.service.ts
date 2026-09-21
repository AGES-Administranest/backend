import { Injectable } from '@nestjs/common';
import { Client } from '@prisma/client';

import { ClientEntity } from './client.entity';
import { ClientRepository } from './client.repository';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { DomainError } from '../../shared/errors/domain-error';

@Injectable()
export class ClientService {
  constructor(private readonly clientRepository: ClientRepository) {}

  async create(userId: string, dto: CreateClientDto): Promise<ClientEntity> {
    const existing = await this.clientRepository.findByName(userId, dto.name);
    if (existing) throw this.duplicatedName();

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

    const client = await this.clientRepository.update(id, userId, dto);
    if (!client) throw this.clientNotFound(id);
    return this.sanitize(client);
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
}
