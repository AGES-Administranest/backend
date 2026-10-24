import { ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceInvoiceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

import { IsIsoDate } from '../../../shared/dates/iso-date';

export class QueryServiceInvoiceDto {
  @ApiPropertyOptional({
    enum: ServiceInvoiceStatus,
    description: 'Without it, every note but the discarded drafts',
  })
  @IsOptional()
  @IsEnum(ServiceInvoiceStatus)
  status?: ServiceInvoiceStatus;

  @ApiPropertyOptional({
    example: '2026-10-01',
    format: 'date',
    description: 'Issued on or after this date',
  })
  @IsOptional()
  @IsIsoDate()
  from?: string;

  @ApiPropertyOptional({
    example: '2026-10-31',
    format: 'date',
    description: 'Issued on or before this date',
  })
  @IsOptional()
  @IsIsoDate()
  to?: string;

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
