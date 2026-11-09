import { ApiProperty } from '@nestjs/swagger';

export class ServiceInvoiceDownloadUrlDto {
  @ApiProperty({
    example:
      'http://localhost:4566/administranest-local/users/8f1c.../service-invoices/2b7e.../original?X-Amz-Signature=...',
    description: 'A GET on this URL downloads the PDF under its original name',
  })
  url!: string;

  @ApiProperty({
    example: 1792875720000,
    description:
      'When the URL expires, in ms since the epoch (5 min). Comparable with Date.now() on the client',
  })
  expiresAt!: number;
}

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
