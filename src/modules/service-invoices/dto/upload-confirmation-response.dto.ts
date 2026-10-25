import { ApiProperty } from '@nestjs/swagger';

import { NfseReviewDto } from './nfse-review.dto';

export class ServiceInvoiceUploadConfirmationDto {
  @ApiProperty({
    example: 184320,
    description: 'Size the bucket actually holds, read with HeadObject',
  })
  contentLength!: number;

  @ApiProperty({
    example: 'application/pdf',
    description: 'Content type the bucket actually holds',
  })
  contentType!: string;

  @ApiProperty({
    type: NfseReviewDto,
    description: 'What was read from the PDF',
  })
  review!: NfseReviewDto;
}
