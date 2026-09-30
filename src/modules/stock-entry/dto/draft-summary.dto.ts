import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExtractionFailureReason, ExtractionStatus } from '@prisma/client';

export class DraftSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiPropertyOptional({ example: 'pedido-4521.pdf' })
  fileName?: string;

  @ApiPropertyOptional({ example: 'application/pdf' })
  fileMimeType?: string;

  @ApiPropertyOptional({
    example: 'Vet Distribuidora',
    description:
      "The registered supplier's name, or the one printed on the document",
  })
  supplierName?: string;

  @ApiPropertyOptional({ example: '4521' })
  invoiceNumber?: string;

  @ApiPropertyOptional({ example: '2026-08-12', format: 'date' })
  orderDate?: string;

  @ApiPropertyOptional({ example: 1870.7 })
  totalAmount?: number;

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
  updatedAt!: string;
}
