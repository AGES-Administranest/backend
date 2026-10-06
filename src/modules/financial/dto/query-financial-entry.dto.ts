import { ApiPropertyOptional } from '@nestjs/swagger';
import { EntryNature, EntryScope } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class QueryFinancialEntryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 12 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @ApiPropertyOptional({ minimum: 2000, maximum: 2100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2100)
  year?: number;

  @ApiPropertyOptional({ enum: EntryNature })
  @IsOptional()
  @IsEnum(EntryNature)
  nature?: EntryNature;

  @ApiPropertyOptional({ enum: EntryScope })
  @IsOptional()
  @IsEnum(EntryScope)
  scope?: EntryScope;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

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
