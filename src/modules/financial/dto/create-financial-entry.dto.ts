import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntryNature, EntryScope } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateFinancialEntryDto {
  @ApiProperty({
    format: 'uuid',
    example: '6f1c2a40-9b7e-4d11-8c22-0a1b2c3d4e5f',
  })
  @IsUUID()
  id!: string;

  @ApiProperty({ enum: EntryNature, example: 'INCOME' })
  @IsEnum(EntryNature)
  nature!: EntryNature;

  @ApiProperty({ minLength: 1, maxLength: 500, example: 'Procedure' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @ApiProperty({
    example: 250,
    description: 'Positive number with up to 2 decimals',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({
    format: 'date-time',
    example: '2026-03-15T12:00:00.000Z',
  })
  @IsDateString()
  accrualDate!: string;

  @ApiProperty({
    format: 'uuid',
    example: 'f2c9e0a1-6b74-4f52-9d8a-1c3e7b5a9026',
  })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({
    enum: EntryScope,
    example: 'PROFESSIONAL',
    description: 'Omitted: the category defaultScope is used',
  })
  @IsOptional()
  @IsEnum(EntryScope)
  scope?: EntryScope;
}
