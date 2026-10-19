import { Injectable } from '@nestjs/common';
import { Vehicle } from '@prisma/client';

import { costPerKm, formatCostPerKm } from './domain/vehicle-cost';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { QueryVehicleDto } from './dto/query-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { VehicleEntity } from './entities/vehicle.entity';
import { VehiclesRepository } from './vehicles.repository';
import { RecordNotFoundError } from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

@Injectable()
export class VehiclesService {
  constructor(private readonly vehiclesRepository: VehiclesRepository) {}

  async findAll(
    userId: string,
    query: QueryVehicleDto,
  ): Promise<VehicleEntity[]> {
    const vehicles = await this.vehiclesRepository.findMany(
      userId,
      query.active,
    );
    return vehicles.map(vehicle => this.toEntity(vehicle));
  }

  async findOne(id: string, userId: string): Promise<VehicleEntity> {
    const vehicle = await this.vehiclesRepository.findById(id, userId);
    if (!vehicle) throw this.notFound(id);
    return this.toEntity(vehicle);
  }

  async create(userId: string, dto: CreateVehicleDto): Promise<VehicleEntity> {
    const vehicle = await this.vehiclesRepository.create({ ...dto, userId });
    return this.toEntity(vehicle);
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateVehicleDto,
  ): Promise<VehicleEntity> {
    try {
      const vehicle = await this.vehiclesRepository.update(id, userId, dto);
      // Someone else's vehicle is reported exactly as a missing one.
      if (!vehicle) throw this.notFound(id);
      return this.toEntity(vehicle);
    } catch (error) {
      if (error instanceof RecordNotFoundError) throw this.notFound(id);
      throw error;
    }
  }

  /** Inactivates without deleting: the vehicle stays readable for its trips. */
  async remove(id: string, userId: string): Promise<VehicleEntity> {
    const vehicle = await this.vehiclesRepository.deactivate(id, userId);
    if (!vehicle) throw this.notFound(id);
    return this.toEntity(vehicle);
  }

  private toEntity(vehicle: Vehicle): VehicleEntity {
    return {
      id: vehicle.id,
      brand: vehicle.brand,
      model: vehicle.model,
      fuelType: vehicle.fuelType,
      avgConsumptionKmL: vehicle.avgConsumptionKmL,
      fuelPrice: vehicle.fuelPrice,
      costPerKm: formatCostPerKm(
        costPerKm(vehicle.fuelPrice, vehicle.avgConsumptionKmL),
      ),
      active: vehicle.active,
      createdAt: vehicle.createdAt,
      updatedAt: vehicle.updatedAt,
    };
  }

  private notFound(id: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'VEHICLE_NOT_FOUND',
      `Vehicle ${id} not found`,
      { id },
    );
  }
}
