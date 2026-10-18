import { TripMode } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
} from 'class-validator';

import { IsIsoDate } from '../../../shared/validation/iso-date';
import {
  MAX_DISTANCE_KM,
  MAX_RIDE_COST,
  PLACE_MAX_LENGTH,
} from '../trips.constants';

// Trimmed before validation, so "   " fails as empty and the length limit
// counts what is actually stored.
const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/**
 * No `userId`: the owner comes from the token (ADR-11). Which of vehicleId,
 * distanceKm and cost a mode needs is checked by the service against the whole
 * trip, so PATCH applies the same rule to the merged result.
 */
export class CreateTripDto {
  /** Generated on the device (ADR-09): resending the same trip is idempotent. */
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsEnum(TripMode)
  mode!: TripMode;

  @IsOptional()
  @IsUUID()
  vehicleId?: string | null;

  @IsOptional()
  @IsUUID()
  appointmentId?: string | null;

  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @IsIsoDate()
  occurredOn!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PLACE_MAX_LENGTH)
  origin!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PLACE_MAX_LENGTH)
  destination!: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_DISTANCE_KM)
  distanceKm?: number | null;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_RIDE_COST)
  cost?: number | null;
}
