import { ApiProperty } from '@nestjs/swagger';

export class ReportDownloadUrlEntity {
  @ApiProperty({
    example:
      'http://localhost:4566/administranest-local/users/8f1c.../reports/2b7e.../original?X-Amz-Signature=...',
  })
  url!: string;

  @ApiProperty({ example: 1794430000000 })
  expiresAt!: number;
}
