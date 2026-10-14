import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateEquipmentDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  supplierId?: string | null;

  @ApiPropertyOptional({ example: 'Ultrasound machine' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ example: 25000 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  purchaseValue?: number;

  @ApiPropertyOptional({
    example: 1000,
    description: 'Must be lower than purchaseValue',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salvageValue?: number;

  @ApiPropertyOptional({ format: 'date', example: '2025-04-15' })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsDateString()
  acquisitionDate?: string;

  @ApiPropertyOptional({ example: 120, minimum: 1 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  usefulLifeMonths?: number;

  @ApiPropertyOptional({ example: 'Calibration due next year', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string | null;
}
