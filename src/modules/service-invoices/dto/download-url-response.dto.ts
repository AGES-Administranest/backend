import { ApiProperty } from '@nestjs/swagger';

export class ServiceInvoiceDownloadDto {
  @ApiProperty({
    description:
      'Short-lived, answers with `Content-Disposition: attachment` and `Content-Type: application/pdf`',
  })
  url!: string;

  @ApiProperty({
    example: 'nota_fiscal.pdf',
    description: 'The name the app saves the file under; safe as a file name',
  })
  filename!: string;

  @ApiProperty({ format: 'date-time', example: '2026-04-22T13:12:11.000Z' })
  expiresAt!: string;
}
