import { ApiProperty } from '@nestjs/swagger';

export class ReportDownloadUrlEntity {
  @ApiProperty({
    example:
      'http://localhost:4566/administranest-local/users/8f1c.../reports/2b7e.../original?X-Amz-Signature=...',
    description:
      'A GET on this URL downloads the file under its fileName. No token: the signature is the permission',
  })
  url!: string;

  @ApiProperty({
    example: 1794430000000,
    description:
      'When the URL expires, in ms since the epoch (5 min). Comparable with Date.now() on the client',
  })
  expiresAt!: number;
}
