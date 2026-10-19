import { ApiPropertyOptional } from '@nestjs/swagger';
import { StockMovementSource, StockMovementType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import { toEnumValue } from './create-stock-adjustment.dto';

const toArray = ({ value }: { value: unknown }): unknown[] | undefined =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

const toEnumValueArray = (params: { value: unknown }): unknown => {
  const values = toArray(params);
  return values?.map(value => toEnumValue({ value }));
};

// No `userId`: the history belongs to the token's owner (ADR-11).
export class QueryStockMovementDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only movements of this item',
  })
  @IsOptional()
  @IsUUID()
  itemId?: string;

  @ApiPropertyOptional({
    description:
      'Partial, case-insensitive match on the item name. Ignored when shorter than 2 characters.',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({
    description:
      'Start of the period, inclusive. A calendar date (YYYY-MM-DD) is read as ' +
      'the start of that day in UTC; pass a full timestamp with an offset to be exact.',
    example: '2026-09-01',
  })
  @IsOptional()
  @IsISO8601()
  periodStart?: string;

  @ApiPropertyOptional({
    description:
      'End of the period, inclusive. A calendar date (YYYY-MM-DD) covers the ' +
      'whole day in UTC.',
    example: '2026-09-30',
  })
  @IsOptional()
  @IsISO8601()
  periodEnd?: string;

  @ApiPropertyOptional({ enum: StockMovementType })
  @IsOptional()
  @Transform(toEnumValue)
  @IsEnum(StockMovementType)
  type?: StockMovementType;

  @ApiPropertyOptional({
    enum: StockMovementSource,
    isArray: true,
    description: 'Accepts multiple values; absent means every origin',
  })
  @IsOptional()
  @Transform(toEnumValueArray)
  @IsEnum(StockMovementSource, { each: true })
  source?: StockMovementSource[];

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    default: 50,
    minimum: 1,
    maximum: 100,
    description:
      'A page shorter than this limit is the last one — there is no total count.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}
