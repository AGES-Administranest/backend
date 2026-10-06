import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntryNature, EntryScope } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class SyncFinancialEntryDto {
  @ApiProperty({
    format: 'uuid',
    example: '6f1c2a40-9b7e-4d11-8c22-0a1b2c3d4e5f',
  })
  @IsUUID()
  id!: string;

  @ApiProperty({ enum: ['create', 'update', 'delete'], example: 'create' })
  @IsIn(['create', 'update', 'delete'])
  operation!: 'create' | 'update' | 'delete';

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-15T12:00:00.000Z',
    description: 'When the device recorded the operation. Older than the server copy is a conflict.',
  })
  @IsDateString()
  occurredAt!: string;

  @ApiPropertyOptional({ enum: EntryNature })
  @IsOptional()
  @IsEnum(EntryNature)
  nature?: EntryNature;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsDateString()
  accrualDate?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ enum: EntryScope })
  @IsOptional()
  @IsEnum(EntryScope)
  scope?: EntryScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
