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

  @ApiProperty({ enum: EntryScope })
  defaultScope!: EntryScope;
}

export class FinancialEntryOriginResponse {
  @ApiProperty({ enum: EntrySource })
  type!: EntrySource;

  @ApiProperty({ type: String, nullable: true })
  id!: string | null;
}

export class FinancialEntryResponse {
  id!: string;

  @ApiProperty({ enum: EntryNature })
  nature!: EntryNature;

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
