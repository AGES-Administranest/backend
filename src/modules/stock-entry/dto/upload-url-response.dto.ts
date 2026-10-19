import { ApiProperty } from '@nestjs/swagger';

export class UploadUrlResponseDto {
  @ApiProperty({
    example: 'http://localhost:4566/administranest-local',
    description: 'Where the client sends the multipart/form-data POST',
  })
  url!: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: {
      key: 'users/8f1c.../purchase-invoices/2b7e.../original',
      'Content-Type': 'application/pdf',
      policy: 'eyJleHBpcmF0aW9uIjoi...',
      'x-amz-algorithm': 'AWS4-HMAC-SHA256',
      'x-amz-credential': 'test/20260908/us-east-1/s3/aws4_request',
      'x-amz-date': '20260908T210700Z',
      'x-amz-signature': '3a7f...',
    },
    description:
      'Form fields, sent in the order received and before the file. Pass them through unchanged',
  })
  fields!: Record<string, string>;

  @ApiProperty({
    example: 1757366220000,
    description:
      'When the signature expires, in ms since the epoch (10 min). Comparable with Date.now() on the client',
  })
  expiresAt!: number;
}
