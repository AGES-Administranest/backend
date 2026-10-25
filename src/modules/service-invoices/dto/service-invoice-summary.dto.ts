import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ExtractionFailureReason,
  ExtractionStatus,
  ServiceInvoiceStatus,
} from '@prisma/client';

export class ServiceInvoiceSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ServiceInvoiceStatus })
  status!: ServiceInvoiceStatus;

  @ApiPropertyOptional({ example: 'nfse-1287.pdf' })
  fileName?: string;

  @ApiPropertyOptional({ example: '1287' })
  number?: string;

  @ApiPropertyOptional({ example: '2026-10-13', format: 'date' })
  issueDate?: string;

  @ApiPropertyOptional({ example: 1500 })
  amount?: number;

  @ApiPropertyOptional({
    example: 'CLINICA VETERINARIA EXEMPLO LTDA',
    description: 'The taker as printed on the note',
  })
  takerName?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  clientId?: string;

  @ApiProperty({ enum: ExtractionStatus })
  extractionStatus!: ExtractionStatus;

  @ApiPropertyOptional({ enum: ExtractionFailureReason })
  failureReason?: ExtractionFailureReason;

  @ApiPropertyOptional({
    format: 'date-time',
    description: 'Absent while the upload never arrived',
  })
  uploadedAt?: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;
}
