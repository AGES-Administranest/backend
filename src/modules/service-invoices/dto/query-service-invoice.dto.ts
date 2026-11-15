import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceInvoiceStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const SERVICE_INVOICE_SORT = 'issueDate:desc';

/** With the largest page size this is ten million rows deep. */
const MAX_PAGE = 100_000;

export class QueryServiceInvoiceDto {
  @ApiProperty({
    enum: [ServiceInvoiceStatus.CONFIRMED],
    description: 'Only confirmed notes are listed: a draft is not a note yet',
  })
  @IsIn([ServiceInvoiceStatus.CONFIRMED])
  status!: typeof ServiceInvoiceStatus.CONFIRMED;

  @ApiProperty({
    enum: [SERVICE_INVOICE_SORT],
    description: 'Ties are broken by id, so a page boundary never moves',
  })
  @IsIn([SERVICE_INVOICE_SORT])
  sort!: typeof SERVICE_INVOICE_SORT;

  @ApiProperty({
    minimum: 1,
    maximum: MAX_PAGE,
    description: 'A page past the cap would overflow the OFFSET of the query',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page!: number;

  @ApiProperty({ minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize!: number;

  @ApiPropertyOptional({
    example: '22/04',
    description:
      'Without accents or case: part of the taker name or of the number, or ' +
      'of the issue date as DD/MM/YYYY (digits only, at least two: 22/04, 2204)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}
