import { ApiProperty } from '@nestjs/swagger';

export class TaxPackageTypeSummaryEntity {
  @ApiProperty({ description: 'Documents with their file in storage' })
  count!: number;

  @ApiProperty({
    example: 3200,
    description: 'Sum of the amounts of those documents, in BRL',
  })
  totalAmount!: number;

  @ApiProperty({
    description: 'Confirmed documents in the period with no file in storage',
  })
  missingFiles!: number;
}

export class TaxPackageByTypeEntity {
  @ApiProperty({ type: TaxPackageTypeSummaryEntity })
  serviceInvoice!: TaxPackageTypeSummaryEntity;

  @ApiProperty({ type: TaxPackageTypeSummaryEntity })
  purchaseInvoice!: TaxPackageTypeSummaryEntity;
}

export class TaxPackageSummaryEntity {
  @ApiProperty({
    description: 'Documents the package would hold: confirmed, with a file',
  })
  documentsCount!: number;

  @ApiProperty({ example: 4350, description: 'Sum of their amounts, in BRL' })
  totalAmount!: number;

  @ApiProperty({ type: TaxPackageByTypeEntity })
  byType!: TaxPackageByTypeEntity;

  @ApiProperty({
    description:
      'Confirmed documents in the period left out for having no file. Not in `documentsCount` or `totalAmount`',
  })
  missingFiles!: number;
}
