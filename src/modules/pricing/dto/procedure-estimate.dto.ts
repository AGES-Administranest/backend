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
  @ApiProperty({
    format: 'uuid',
    description:
      "One of the user's items, not deleted. Its defaultUnitCost prices the line",
  })
  @IsUUID()
  itemId!: string;

  @ApiProperty({
    example: 2,
    exclusiveMinimum: true,
    minimum: 0,
    maximum: MAX_SUPPLY_QUANTITY,
    description:
      "In the item's own unit, up to 3 decimal places. An item on several " +
      'lines adds up',
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(MAX_SUPPLY_QUANTITY)
  quantity!: number;
}

// No `userId`: the estimate uses the token owner's costs and records (ADR-11).
export class ProcedureEstimateDto {
  @ApiProperty({
    example: 90,
    minimum: 1,
    maximum: MAX_PROCEDURE_MINUTES,
    description: 'Estimated duration of the procedure, in whole minutes',
  })
  @IsInt()
  @Min(1)
  @Max(MAX_PROCEDURE_MINUTES)
  durationMinutes!: number;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description:
      "One of the user's clients, not deleted. Adds what a day there has cost " +
      'in trips; without it, or without trips to it, the trip adds nothing',
  })
  @IsOptional()
  @IsUUID()
  clientId?: string | null;

  @ApiPropertyOptional({
    type: ProcedureSupplyDto,
    isArray: true,
    maxItems: MAX_ESTIMATED_SUPPLIES,
    description: 'The supplies the procedure is expected to use',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ESTIMATED_SUPPLIES)
  @ValidateNested({ each: true })
  @Type(() => ProcedureSupplyDto)
  supplies?: ProcedureSupplyDto[];
}
