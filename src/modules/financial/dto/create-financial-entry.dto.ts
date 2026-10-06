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
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  id!: string;

  @ApiProperty({ enum: EntryNature })
  @IsEnum(EntryNature)
  nature!: EntryNature;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  description!: string;

  @ApiProperty({ example: 250, description: 'Positive number' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount!: number;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  accrualDate!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId!: string;

  @ApiPropertyOptional({ enum: EntryScope })
  @IsOptional()
  @IsEnum(EntryScope)
  scope?: EntryScope;
}
