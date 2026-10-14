import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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

export class CreateEquipmentDto {
  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  supplierId?: string | null;

  @ApiProperty({ example: 'Ultrasound machine' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 25000 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  purchaseValue!: number;

  @ApiPropertyOptional({
    example: 1000,
    default: 0,
    description: 'Must be lower than purchaseValue',
  })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  salvageValue?: number;

  @ApiProperty({ format: 'date', example: '2025-04-15' })
  @IsDateString()
  acquisitionDate!: string;

  @ApiPropertyOptional({ example: 120, default: 120, minimum: 1 })
  @ValidateIf((_object, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  usefulLifeMonths?: number;

  @ApiPropertyOptional({ example: 'Calibration due next year' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
