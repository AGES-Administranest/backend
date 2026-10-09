import { ApiProperty } from '@nestjs/swagger';
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
  @ApiProperty({
    example: 'Fiat',
    maxLength: BRAND_MAX_LENGTH,
    description: 'Trimmed; blank is rejected',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(BRAND_MAX_LENGTH)
  brand!: string;

  @ApiProperty({
    example: 'Strada Freedom 1.3',
    maxLength: MODEL_MAX_LENGTH,
    description: 'Trimmed; blank is rejected',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(MODEL_MAX_LENGTH)
  model!: string;

  @ApiProperty({
    enum: FuelType,
    example: FuelType.FLEX,
    description:
      'The fuel the car accepts (FLEX takes gasoline or ethanol). Not tied to a price: ' +
      'fuelPrice and avgConsumptionKmL are the values of the fuel in use',
  })
  @IsEnum(FuelType)
  fuelType!: FuelType;

  @ApiProperty({
    example: 12.5,
    exclusiveMinimum: true,
    minimum: 0,
    maximum: MAX_AVG_CONSUMPTION_KM_L,
    description: 'Average consumption in km per litre, up to 2 decimal places',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_AVG_CONSUMPTION_KM_L)
  avgConsumptionKmL!: number;

  @ApiProperty({
    example: 5.899,
    exclusiveMinimum: true,
    minimum: 0,
    maximum: MAX_FUEL_PRICE,
    description: 'Fuel price in R$ per litre, up to 3 decimal places',
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(MAX_FUEL_PRICE)
  fuelPrice!: number;
}
