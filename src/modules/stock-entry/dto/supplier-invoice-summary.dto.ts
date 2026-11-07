import { ApiProperty } from '@nestjs/swagger';

export class SupplierInvoiceSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  issueDate!: string | null;

  @ApiProperty({ type: String, nullable: true })
  number!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  totalAmount!: number | null;
}
