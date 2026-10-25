import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ServiceInvoiceStatus } from '@prisma/client';

import { NfseReviewDto } from './nfse-review.dto';

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
}
