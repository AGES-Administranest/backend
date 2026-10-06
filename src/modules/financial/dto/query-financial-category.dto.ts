import { ApiPropertyOptional } from '@nestjs/swagger';
import { EntryNature } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class QueryFinancialCategoryDto {
  @ApiPropertyOptional({ enum: EntryNature })
  @IsOptional()
  @IsEnum(EntryNature)
  nature?: EntryNature;
}
