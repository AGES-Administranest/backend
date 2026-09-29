import { ApiProperty } from '@nestjs/swagger';

import { ExtractionResponseDto } from './extraction-response.dto';

export class UploadConfirmationResponseDto {
  @ApiProperty({
    example: 2483911,
    description: 'Size the bucket actually holds, read with HeadObject',
  })
  contentLength!: number;

  @ApiProperty({
    example: 'application/pdf',
    description: 'Content type the bucket actually holds',
  })
  contentType!: string;

  @ApiProperty({
    type: ExtractionResponseDto,
    description:
      'What was read from the PDF and matched against the catalog. A photo ' +
      'is not read: it comes back MANUAL, with no items',
  })
  extraction!: ExtractionResponseDto;
}
