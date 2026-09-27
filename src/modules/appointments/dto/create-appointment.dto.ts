import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus, Prisma, Species } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

// No `userId`: the owner comes from the token, never from the request (ADR-11).
export class CreateAppointmentDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clientGeneratedId?: string;

  @ApiPropertyOptional({
    enum: AppointmentStatus,
    default: AppointmentStatus.SCHEDULED,
  })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ example: 'Dental cleaning' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  procedureName?: string;

  @ApiProperty({ example: '2026-09-25T13:00:00.000Z' })
  @IsDateString()
  startsAt!: string;

  // Required for SCHEDULED appointments: conflict detection needs a closed
  // interval to compare against. Optional for COMPLETED ones (a procedure
  // already done has no slot to protect).
  @ApiPropertyOptional({ example: '2026-09-25T14:00:00.000Z' })
  @ValidateIf(
    (dto: CreateAppointmentDto) =>
      dto.status !== AppointmentStatus.COMPLETED || dto.endsAt !== undefined,
  )
  @IsDateString()
  endsAt?: string;

  @ApiPropertyOptional({ example: 'Room 2' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  location?: string;

  @ApiPropertyOptional({ example: 250 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ example: 'Maya' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  patientName?: string;

  @ApiPropertyOptional({ example: 'Alex Smith' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  ownerName?: string;

  @ApiPropertyOptional({ enum: Species })
  @IsOptional()
  @IsEnum(Species)
  species?: Species;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  patientAgeYears?: number;

  @ApiPropertyOptional({ example: 12.5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  weightKg?: number;

  @ApiPropertyOptional({ example: 'Patient fasted for 8 hours.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ example: 'ASA II' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  asa?: string;
}

export type AppointmentDecimalInput = Prisma.Decimal | number;
