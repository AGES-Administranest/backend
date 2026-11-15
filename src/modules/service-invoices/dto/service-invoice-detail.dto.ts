import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceInvoiceStatus } from '@prisma/client';

import { NfseReviewDto } from './nfse-review.dto';
import { ServiceInvoiceClientRefDto } from './service-invoice-summary.dto';

export class ServiceInvoiceClientDto extends ServiceInvoiceClientRefDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '12345678000190',
    description: 'Null when the client has no document',
  })
  taxId!: string | null;
}

export class ServiceInvoiceFileDto {
  @ApiProperty({ example: 'nota_fiscal.pdf' })
  name!: string;

  @ApiProperty({ example: 253952 })
  bytesSize!: number;
}

export class ServiceInvoiceDataDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: '000458' })
  number!: string | null;

  @ApiProperty({ example: '2026-04-22', format: 'date' })
  issueDate!: string;

  @ApiProperty({ example: 1284.5 })
  amount!: number;

  @ApiProperty({ type: ServiceInvoiceClientDto })
  client!: ServiceInvoiceClientDto;

  @ApiProperty({ type: String, nullable: true, example: 'São Paulo, SP' })
  location!: string | null;

  @ApiProperty()
  hasFile!: boolean;

  @ApiProperty({ type: ServiceInvoiceFileDto, nullable: true })
  file!: ServiceInvoiceFileDto | null;
}

export class ServiceInvoiceDetailDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ServiceInvoiceStatus })
  status!: ServiceInvoiceStatus;

  @ApiPropertyOptional({ example: 'nfse-1287.pdf' })
  fileName?: string;

  @ApiProperty({ type: NfseReviewDto })
  review!: NfseReviewDto;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Absent while the upload never arrived',
  })
  uploadedAt?: string;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Last time the user saved the review',
  })
  reviewedAt?: string;

  @ApiPropertyOptional({
    type: ServiceInvoiceDataDto,
    description: 'Only on a confirmed note, with the values as they stand',
  })
  invoice?: ServiceInvoiceDataDto;
}
