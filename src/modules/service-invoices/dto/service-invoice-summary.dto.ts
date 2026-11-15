import { ApiProperty } from '@nestjs/swagger';

export class ServiceInvoiceClientRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'HospVet Sul' })
  name!: string;
}

export class ServiceInvoiceSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true, example: '000458' })
  number!: string | null;

  @ApiProperty({ example: '2026-04-22', format: 'date' })
  issueDate!: string;

  @ApiProperty({ example: 1284.5 })
  amount!: number;

  @ApiProperty({ type: ServiceInvoiceClientRefDto })
  client!: ServiceInvoiceClientRefDto;

  @ApiProperty({ type: String, nullable: true, example: 'São Paulo, SP' })
  location!: string | null;

  @ApiProperty({ description: 'The original PDF was uploaded and is kept' })
  hasFile!: boolean;
}

export class ServiceInvoicePageDto {
  @ApiProperty({ type: [ServiceInvoiceSummaryDto] })
  items!: ServiceInvoiceSummaryDto[];

  @ApiProperty({
    example: 37,
    description: 'Every note that matches the filters, not just this page',
  })
  total!: number;
}
