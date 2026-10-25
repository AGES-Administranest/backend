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
