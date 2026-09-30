import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { IsIsoDate } from '../iso-date';
import { MAX_DRAFT_AMOUNT } from '../stock-entry.constants';

/** An absent field is left as it is; `null` clears it. */
export class UpdateDraftHeaderDto {
  @ApiPropertyOptional({ example: '4521', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  invoiceNumber?: string | null;

  @ApiPropertyOptional({
    example: '2026-08-12',
    format: 'date',
    nullable: true,
  })
  @IsOptional()
  @IsIsoDate()
  orderDate?: string | null;

  @ApiPropertyOptional({ example: 1870.7, nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(MAX_DRAFT_AMOUNT)
  totalAmount?: number | null;
}
