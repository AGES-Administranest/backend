import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AppointmentStatus, Prisma, Species } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsDate,
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
} from 'class-validator';

export class CreateAppointmentDto {
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

  @ApiProperty({ type: String, format: 'date-time' })
  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  endsAt?: Date;

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

  @ApiPropertyOptional({ enum: AppointmentStatus, default: AppointmentStatus.SCHEDULED })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiPropertyOptional({ example: 'Patient fasted for 8 hours.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export type AppointmentDecimalInput = Prisma.Decimal | number;