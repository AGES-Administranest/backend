import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  EntryNature,
  EntryScope,
  EntrySource,
  EntryStatus,
  Prisma,
} from '@prisma/client';

export class FinancialEntryEntity {
  id!: string;

  @ApiProperty({ enum: EntryNature })
  nature!: EntryNature;

  @ApiProperty({ enum: EntryScope })
  scope!: EntryScope;

  categoryId!: string;

  description!: string;

  @ApiProperty({ type: String, example: '250.00' })
  amount!: Prisma.Decimal;

  accrualDate!: Date;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  dueDate!: Date | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  settlementDate!: Date | null;

  @ApiProperty({ enum: EntryStatus })
  status!: EntryStatus;

  @ApiProperty({ enum: EntrySource })
  source!: EntrySource;

  @ApiPropertyOptional({ type: String, nullable: true })
  appointmentId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  serviceInvoiceId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  purchaseInvoiceId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  tripId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  notes!: string | null;

  createdAt!: Date;

  updatedAt!: Date;

  deletedAt!: Date | null;
}

export class FinancialEntryCategoryResponse {
  id!: string;

  name!: string;

  @ApiProperty({
    enum: EntryScope,
    description: 'The category default scope',
  })
  scope!: EntryScope;
}

export class FinancialEntryOriginResponse {
  @ApiProperty({ enum: EntrySource })
  type!: EntrySource;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    description: 'Null when source is MANUAL',
  })
  id!: string | null;
}

export class FinancialEntrySyncResult {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    enum: ['applied', 'ignored', 'conflict'],
    example: 'applied',
  })
  result!: 'applied' | 'ignored' | 'conflict';

  @ApiPropertyOptional({
    example: 'FINANCIAL_ENTRY_CONTROLLED_BY_ORIGIN',
    description:
      'Set on conflict. Origin-controlled amount, date, or delete uses FINANCIAL_ENTRY_CONTROLLED_BY_ORIGIN or FINANCIAL_ENTRY_DELETE_VIA_ORIGIN.',
  })
  code?: string;
}

export class FinancialEntryResponse {
  @ApiProperty({
    format: 'uuid',
    example: '6f1c2a40-9b7e-4d11-8c22-0a1b2c3d4e5f',
  })
  id!: string;

  @ApiProperty({ enum: EntryNature, example: 'INCOME' })
  nature!: EntryNature;

  @ApiProperty({ example: 'Procedure' })
  description!: string;

  @ApiProperty({ type: FinancialEntryCategoryResponse })
  category!: FinancialEntryCategoryResponse;

  @ApiProperty({ enum: EntryScope })
  scope!: EntryScope;

  @ApiProperty({ type: String, example: '250.00' })
  amount!: Prisma.Decimal;

  accrualDate!: Date;

  @ApiProperty({ enum: EntrySource })
  source!: EntrySource;

  @ApiProperty({ type: FinancialEntryOriginResponse })
  origin!: FinancialEntryOriginResponse;
}
