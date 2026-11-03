import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  MAX_ESTIMATED_SUPPLIES,
  MAX_PROCEDURE_MINUTES,
  MAX_SUPPLY_QUANTITY,
} from '../procedure-estimate.constants';

export class ProcedureSupplyDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;

  @ApiProperty({
    example: 2,
    exclusiveMinimum: true,
    minimum: 0,
    maximum: MAX_SUPPLY_QUANTITY,
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(MAX_SUPPLY_QUANTITY)
  quantity!: number;
}

// No `userId`: the estimate uses the token owner's costs and records (ADR-11).
export class ProcedureEstimateDto {
  @ApiProperty({ example: 90, minimum: 1, maximum: MAX_PROCEDURE_MINUTES })
  @IsInt()
  @Min(1)
  @Max(MAX_PROCEDURE_MINUTES)
  durationMinutes!: number;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @ApiPropertyOptional({
    type: ProcedureSupplyDto,
    isArray: true,
    maxItems: MAX_ESTIMATED_SUPPLIES,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ESTIMATED_SUPPLIES)
  @ValidateNested({ each: true })
  @Type(() => ProcedureSupplyDto)
  supplies?: ProcedureSupplyDto[];
}
