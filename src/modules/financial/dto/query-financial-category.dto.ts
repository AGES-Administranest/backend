import { ApiPropertyOptional } from '@nestjs/swagger';
import { EntryNature } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class QueryFinancialCategoryDto {
  @ApiPropertyOptional({ enum: EntryNature, example: 'EXPENSE' })
  @IsOptional()
  @IsEnum(EntryNature)
  nature?: EntryNature;
}
