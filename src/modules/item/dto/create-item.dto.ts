import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import { MeasurementUnit } from '@prisma/client';

export class CreateItemDto {
  @IsUUID()
  userId!: string;

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsEnum(MeasurementUnit)
  unit!: MeasurementUnit;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  defaultUnitCost?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  minimumStock?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  currentQuantity?: number;
}