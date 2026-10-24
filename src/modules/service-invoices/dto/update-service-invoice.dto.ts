import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
} from 'class-validator';

import { IsIsoDate } from '../../../shared/dates/iso-date';
import { MAX_SERVICE_INVOICE_AMOUNT } from '../service-invoices.constants';

/** An absent field is left as it is; `null` clears it. */
export class UpdateServiceInvoiceDto {
  @ApiPropertyOptional({
    example: '2026-10-13',
    format: 'date',
    nullable: true,
  })
  @IsOptional()
  @IsIsoDate()
  issueDate?: string | null;

  @ApiPropertyOptional({ example: 1500, nullable: true })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(MAX_SERVICE_INVOICE_AMOUNT)
  amount?: number | null;

  @ApiPropertyOptional({ example: '1287', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  number?: string | null;

  @ApiPropertyOptional({
    format: 'uuid',
    nullable: true,
    description: "One of the user's clients, as the taker of the note",
  })
  @IsOptional()
  @IsUUID()
  clientId?: string | null;
}
