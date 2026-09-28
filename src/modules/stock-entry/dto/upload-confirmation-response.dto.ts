import { ApiProperty } from '@nestjs/swagger';

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
}
