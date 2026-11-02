import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';

/**
 * The `:year/:month` of a history month. Same ranges as the month filter of
 * GET /pricing/hourly-rate, both required here.
 */
export class HourlyRateMonthParamsDto {
  @ApiProperty({ minimum: 2000, maximum: 2100, example: 2026 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiProperty({ minimum: 1, maximum: 12, example: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}
