import { Injectable } from '@nestjs/common';
import { Equipment, Prisma } from '@prisma/client';

import {
  calculateDepreciation,
  DEFAULT_USEFUL_LIFE_MONTHS,
} from './domain/depreciation';
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { QueryEquipmentDto } from './dto/query-equipment.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { EquipmentSummaryEntity } from './entities/equipment-summary.entity';
import { EquipmentEntity } from './entities/equipment.entity';
import { EquipmentRepository } from './equipment.repository';
import { InvalidReferenceError } from '../../infra/prisma/prisma-errors';
import { DomainError } from '../../shared/errors/domain-error';

const CENTS_PER_UNIT = 100;

@Injectable()
export class EquipmentService {
  constructor(private readonly equipmentRepository: EquipmentRepository) {}

  async findAll(
    userId: string,
    query: QueryEquipmentDto,
  ): Promise<EquipmentEntity[]> {
    const equipment = await this.equipmentRepository.findMany({
      userId,
      active: query.active ?? true,
    });
    const asOf = new Date();
    return equipment.map(item => this.sanitize(item, asOf));
  }

  /**
   * The month's depreciation: as of now for the current UTC month, as of the
   * month's last day for any other. Shared by the fixed-costs summary and the
   * balance so the two cannot disagree.
   */
  async monthlyDepreciation(
    userId: string,
    year: number,
    month: number,
    now = new Date(),
  ): Promise<number> {
    const isCurrentMonth =
      year === now.getUTCFullYear() && month === now.getUTCMonth() + 1;
    // day 0 of the next month = last day of the requested month
    const asOf = isCurrentMonth
      ? now
      : new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
    return (await this.summary(userId, asOf)).monthlyTotal;
  }

  async summary(
    userId: string,
    asOf = new Date(),
  ): Promise<EquipmentSummaryEntity> {
    const equipment = (
      await this.equipmentRepository.findMany({ userId, active: true })
    ).filter(item => item.acquisitionDate <= asOf);
    const monthlyTotal = equipment.reduce((total, item) => {
      const depreciation = calculateDepreciation({
        purchaseValue: item.purchaseValue.toNumber(),
        salvageValue: item.salvageValue.toNumber(),
        acquisitionDate: item.acquisitionDate,
        usefulLifeMonths: item.usefulLifeMonths,
        asOf,
      });
      return total + depreciation.monthlyDepreciation;
    }, 0);
    const roundedMonthlyTotal =
      Math.round(monthlyTotal * CENTS_PER_UNIT) / CENTS_PER_UNIT;

    return {
      monthlyTotal: roundedMonthlyTotal,
      yearlyTotal:
        Math.round(roundedMonthlyTotal * 12 * CENTS_PER_UNIT) / CENTS_PER_UNIT,
      count: equipment.length,
    };
  }

  async findOne(id: string, userId: string): Promise<EquipmentEntity> {
    const equipment = await this.equipmentRepository.findById(id, userId);
    if (!equipment) throw this.notFound(id);
    return this.sanitize(equipment);
  }

  async create(
    userId: string,
    dto: CreateEquipmentDto,
  ): Promise<EquipmentEntity> {
    const usefulLifeMonths = dto.usefulLifeMonths ?? DEFAULT_USEFUL_LIFE_MONTHS;
    this.validateValues(
      dto.purchaseValue,
      dto.salvageValue ?? 0,
      usefulLifeMonths,
    );
    this.validateAcquisitionDate(dto.acquisitionDate);
    await this.ensureSupplierIsOwned(userId, dto.supplierId);

    try {
      const equipment = await this.equipmentRepository.create({
        userId,
        name: dto.name,
        purchaseValue: dto.purchaseValue,
        salvageValue: dto.salvageValue ?? 0,
        acquisitionDate: new Date(dto.acquisitionDate),
        usefulLifeMonths,
        ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      });
      return this.sanitize(equipment);
    } catch (error) {
      if (error instanceof InvalidReferenceError)
        throw this.invalidSupplierReference();
      throw error;
    }
  }

  async update(
    id: string,
    userId: string,
    dto: UpdateEquipmentDto,
  ): Promise<EquipmentEntity> {
    const current = await this.equipmentRepository.findById(id, userId);
    if (!current) throw this.notFound(id);

    const purchaseValue = dto.purchaseValue ?? current.purchaseValue.toNumber();
    const salvageValue = dto.salvageValue ?? current.salvageValue.toNumber();
    const usefulLifeMonths =
      dto.usefulLifeMonths ??
      current.usefulLifeMonths ??
      DEFAULT_USEFUL_LIFE_MONTHS;
    this.validateValues(purchaseValue, salvageValue, usefulLifeMonths);
    if (dto.acquisitionDate !== undefined)
      this.validateAcquisitionDate(dto.acquisitionDate);
    await this.ensureSupplierIsOwned(userId, dto.supplierId);

    const data: Prisma.EquipmentUncheckedUpdateInput = {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.purchaseValue !== undefined
        ? { purchaseValue: dto.purchaseValue }
        : {}),
      ...(dto.salvageValue !== undefined
        ? { salvageValue: dto.salvageValue }
        : {}),
      ...(dto.acquisitionDate !== undefined
        ? { acquisitionDate: new Date(dto.acquisitionDate) }
        : {}),
      ...(dto.usefulLifeMonths !== undefined
        ? { usefulLifeMonths: dto.usefulLifeMonths }
        : {}),
      ...(dto.supplierId !== undefined ? { supplierId: dto.supplierId } : {}),
      ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
    };

    try {
      const equipment = await this.equipmentRepository.update(id, userId, data);
      if (!equipment) throw this.notFound(id);
      return this.sanitize(equipment);
    } catch (error) {
      if (error instanceof InvalidReferenceError)
        throw this.invalidSupplierReference();
      throw error;
    }
  }

  async remove(id: string, userId: string): Promise<EquipmentEntity> {
    const equipment = await this.equipmentRepository.deactivate(id, userId);
    if (!equipment) throw this.notFound(id);
    return this.sanitize(equipment);
  }

  private sanitize(equipment: Equipment, asOf = new Date()): EquipmentEntity {
    const purchaseCents = toCents(equipment.purchaseValue);
    const salvageCents = toCents(equipment.salvageValue);
    const usefulLifeMonths =
      equipment.usefulLifeMonths ?? DEFAULT_USEFUL_LIFE_MONTHS;
    const depreciation = calculateDepreciation({
      purchaseValue: purchaseCents / CENTS_PER_UNIT,
      salvageValue: salvageCents / CENTS_PER_UNIT,
      acquisitionDate: equipment.acquisitionDate,
      usefulLifeMonths,
      asOf,
    });

    return {
      id: equipment.id,
      supplierId: equipment.supplierId,
      name: equipment.name,
      purchaseValue: purchaseCents / CENTS_PER_UNIT,
      salvageValue: salvageCents / CENTS_PER_UNIT,
      acquisitionDate: equipment.acquisitionDate,
      usefulLifeMonths,
      notes: equipment.notes,
      active: equipment.active,
      createdAt: equipment.createdAt,
      updatedAt: equipment.updatedAt,
      monthlyDepreciation: depreciation.monthlyDepreciation,
      accumulatedDepreciation: depreciation.accumulatedDepreciation,
      currentBookValue: depreciation.currentValue,
      currentValue: depreciation.currentValue,
      usefulLifeUsedPct: depreciation.usefulLifeUsedPct,
      endOfLife: depreciation.endOfLife,
    };
  }

  private validateValues(
    purchaseValue: number,
    salvageValue: number,
    usefulLifeMonths: number,
  ): void {
    if (!Number.isFinite(purchaseValue) || purchaseValue <= 0) {
      throw new DomainError(
        'INVALID_INPUT',
        'EQUIPMENT_PURCHASE_VALUE_INVALID',
        'Purchase value must be greater than zero',
      );
    }
    if (
      !Number.isFinite(salvageValue) ||
      salvageValue < 0 ||
      salvageValue >= purchaseValue
    ) {
      throw new DomainError(
        'INVALID_INPUT',
        'EQUIPMENT_SALVAGE_VALUE_INVALID',
        'Salvage value must be non-negative and less than purchase value',
      );
    }
    if (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths <= 0) {
      throw new DomainError(
        'INVALID_INPUT',
        'EQUIPMENT_USEFUL_LIFE_INVALID',
        'Useful life must be a positive number of months',
      );
    }
  }

  private validateAcquisitionDate(value: string): void {
    const date = new Date(value);
    const today = new Date();
    const dateDay = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
    );
    const todayDay = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
    );
    if (dateDay > todayDay) {
      throw new DomainError(
        'INVALID_INPUT',
        'EQUIPMENT_ACQUISITION_DATE_IN_FUTURE',
        'Acquisition date cannot be in the future',
      );
    }
  }

  private async ensureSupplierIsOwned(
    userId: string,
    supplierId?: string | null,
  ): Promise<void> {
    if (!supplierId) return;
    const supplier = await this.equipmentRepository.findActiveSupplier(
      userId,
      supplierId,
    );
    if (!supplier) throw this.invalidSupplierReference();
  }

  private notFound(id: string): DomainError {
    return new DomainError(
      'NOT_FOUND',
      'EQUIPMENT_NOT_FOUND',
      `Equipment ${id} not found`,
      { id },
    );
  }

  private invalidSupplierReference(): DomainError {
    return new DomainError(
      'INVALID_REFERENCE',
      'INVALID_REFERENCE',
      'The provided supplier does not exist or is invalid',
      { field: 'supplierId' },
    );
  }
}

function toCents(value: Prisma.Decimal): number {
  return Math.round(value.toNumber() * CENTS_PER_UNIT);
}
