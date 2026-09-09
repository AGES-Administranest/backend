import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ItemCategory, MeasurementUnit } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @ApiProperty({ enum: ItemCategory, example: ItemCategory.MEDICATION })
  @IsEnum(ItemCategory)
  category!: ItemCategory;

  @ApiProperty({ enum: MeasurementUnit, example: MeasurementUnit.AMPOULE })
  @IsEnum(MeasurementUnit)
  unit!: MeasurementUnit;

  @ApiProperty({ example: 'Injectable dipyrone 500mg/mL' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ example: 12.5 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  defaultUnitCost?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  minimumStock?: number;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  currentQuantity?: number;
}
