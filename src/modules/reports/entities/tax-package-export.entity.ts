import { ApiProperty } from '@nestjs/swagger';

export class TaxPackageSkippedEntity {
  @ApiProperty({ enum: ['SERVICE_INVOICE', 'PURCHASE_INVOICE'] })
  type!: 'SERVICE_INVOICE' | 'PURCHASE_INVOICE';

  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: ['FILE_NOT_FOUND'],
    description: 'The row says there is a file but the bucket has none',
  })
  reason!: 'FILE_NOT_FOUND';
}

export class TaxPackageExportEntity {
  @ApiProperty({
    description: 'A GET on this URL downloads the zip',
    example:
      'http://localhost:4566/administranest-local/users/8f1c.../exports/...',
  })
  url!: string;

  @ApiProperty({
    example: 1792875720000,
    description:
      'When the URL expires, in ms since the epoch (5 min). Comparable with Date.now() on the client',
  })
  expiresAt!: number;

  @ApiProperty({ example: 'notas-fiscais_2026-03-01_2026-03-31.zip' })
  fileName!: string;

  @ApiProperty({ description: 'Documents inside the zip' })
  documentsCount!: number;

  @ApiProperty({
    type: [TaxPackageSkippedEntity],
    description:
      'Documents left out because their file vanished from storage meanwhile',
  })
  skipped!: TaxPackageSkippedEntity[];
}
