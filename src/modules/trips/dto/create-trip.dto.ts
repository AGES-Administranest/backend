import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

import { IsIsoDate } from '../../../shared/dates/iso-date';
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
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Generated on the device (ADR-09). Resending the same trip with it ' +
      'answers 200 with the stored one; different content answers 409',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({
    enum: TripMode,
    example: TripMode.OWN_VEHICLE,
    description:
      'OWN_VEHICLE: vehicleId and distanceKm required, cost refused (the ' +
      'server calculates it). RIDE (app or taxi): cost required, vehicleId ' +
      'refused, distanceKm optional',
  })
  @IsEnum(TripMode)
  mode!: TripMode;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: "Required for OWN_VEHICLE: an active vehicle of the user's",
  })
  @IsOptional()
  @IsUUID()
  vehicleId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      "Optional link to one of the user's appointments, in any status. " +
      "Without clientId, the trip takes the appointment's client",
  })
  @IsOptional()
  @IsUUID()
  appointmentId?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      "Optional link to one of the user's clients. Sent with an appointment " +
      'that has a client, it must be that client',
  })
  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @ApiProperty({
    format: 'date',
    example: '2026-10-18',
    description: 'Day of the trip, YYYY-MM-DD. Several trips may share it',
  })
  @IsIsoDate()
  occurredOn!: string;

  @ApiProperty({
    example: 'Casa',
    maxLength: PLACE_MAX_LENGTH,
    description: 'Trimmed; blank is rejected',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PLACE_MAX_LENGTH)
  origin!: string;

  @ApiProperty({
    example: 'Clínica Veterinária São Francisco',
    maxLength: PLACE_MAX_LENGTH,
    description: 'Trimmed; blank is rejected',
  })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(PLACE_MAX_LENGTH)
  destination!: string;

  @ApiPropertyOptional({
    example: 30,
    nullable: true,
    exclusiveMinimum: true,
    minimum: 0,
    maximum: MAX_DISTANCE_KM,
    description:
      'Kilometres, up to 2 decimal places. Required for OWN_VEHICLE, ' +
      'optional for RIDE',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_DISTANCE_KM)
  distanceKm?: number | null;

  @ApiPropertyOptional({
    example: 32.9,
    nullable: true,
    exclusiveMinimum: true,
    minimum: 0,
    maximum: MAX_RIDE_COST,
    description:
      'The fare paid in R$, up to 2 decimal places. Required for RIDE; ' +
      'refused for OWN_VEHICLE, whose cost the server calculates',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_RIDE_COST)
  cost?: number | null;
}
