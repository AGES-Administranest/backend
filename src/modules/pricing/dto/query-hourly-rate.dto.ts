import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Same month filter as the statement and the fixed-costs summary. */
export class QueryHourlyRateDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 12,
    example: 10,
    description: 'Defaults to the current UTC month',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({
    minimum: 2000,
    maximum: 2100,
    example: 2026,
    description: 'Defaults to the current UTC year',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;
}
