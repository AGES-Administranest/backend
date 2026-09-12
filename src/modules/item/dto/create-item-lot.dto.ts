import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateItemLotDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  userId!: string;

  @ApiProperty({ example: 10 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;

  @ApiPropertyOptional({
    example: 12.5,
    description: 'Falls back to the item defaultUnitCost when omitted',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({ format: 'date', example: '2026-12-31' })
  @IsOptional()
  @IsDateString()
  expirationDate?: string;

  @ApiPropertyOptional({
    format: 'date',
    example: '2026-09-09',
    description: 'Defaults to today when omitted',
  })
  @IsOptional()
  @IsDateString()
  receivedOn?: string;

  @ApiPropertyOptional({ example: 'L2026-042' })
  @IsOptional()
  @IsString()
  lotNumber?: string;
}
