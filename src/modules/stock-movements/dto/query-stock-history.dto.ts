import { ApiPropertyOptional } from '@nestjs/swagger';
import { StockMovementSource, StockMovementType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { StockPeriodFilterDto } from './stock-period-filter.dto';

export const STOCK_HISTORY_DEFAULT_LIMIT = 20;
export const STOCK_HISTORY_MAX_LIMIT = 100;

/**
 * Query string of `GET /stock-movements`: the period filter plus direction,
 * origin and pagination. Query values arrive as strings, so the numeric
 * fields are converted with `@Type` before the validators run.
 */
export class QueryStockHistoryDto extends StockPeriodFilterDto {
  @ApiPropertyOptional({ enum: StockMovementType })
  @IsOptional()
  @IsEnum(StockMovementType)
  type?: StockMovementType;

  @ApiPropertyOptional({ enum: StockMovementSource })
  @IsOptional()
  @IsEnum(StockMovementSource)
  source?: StockMovementSource;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({
    default: STOCK_HISTORY_DEFAULT_LIMIT,
    minimum: 1,
    maximum: STOCK_HISTORY_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(STOCK_HISTORY_MAX_LIMIT)
  limit: number = STOCK_HISTORY_DEFAULT_LIMIT;
}
