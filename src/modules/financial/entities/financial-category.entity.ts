import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EntryNature, EntryScope } from '@prisma/client';

export class FinancialCategoryEntity {
  id!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  userId!: string | null;

  name!: string;

  @ApiProperty({ enum: EntryNature })
  nature!: EntryNature;

  @ApiProperty({ enum: EntryScope })
  defaultScope!: EntryScope;

  active!: boolean;

  createdAt!: Date;

  updatedAt!: Date;
}

export class FinancialCategoryResponse {
  @ApiProperty({
    format: 'uuid',
    example: '7c2e1a90-4b3d-4f6a-8c15-0d9e2f4a6b81',
  })
  id!: string;

  @ApiProperty({ example: 'Supplies' })
  name!: string;

  @ApiProperty({ enum: EntryNature, example: 'EXPENSE' })
  nature!: EntryNature;

  @ApiProperty({ enum: EntryScope, example: 'PROFESSIONAL' })
  defaultScope!: EntryScope;
}
