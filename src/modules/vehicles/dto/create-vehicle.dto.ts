import { FuelType } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';

import {
  BRAND_MAX_LENGTH,
  MAX_AVG_CONSUMPTION_KM_L,
  MAX_FUEL_PRICE,
  MODEL_MAX_LENGTH,
} from '../vehicles.constants';

// Trimmed before validation, so "   " fails as empty and the length limit
// counts what is actually stored.
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// No `userId`: the owner comes from the token, never from the request (ADR-11).
export class CreateVehicleDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BRAND_MAX_LENGTH)
  brand!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MODEL_MAX_LENGTH)
  model!: string;

  @IsEnum(FuelType)
  fuelType!: FuelType;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_AVG_CONSUMPTION_KM_L)
  avgConsumptionKmL!: number;

  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(MAX_FUEL_PRICE)
  fuelPrice!: number;
}
