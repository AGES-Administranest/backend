import { ApiProperty } from '@nestjs/swagger';

export class ServiceInvoiceReportItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '2026-10-13', format: 'date' })
  issueDate!: string;

  @ApiProperty({
    example: 'Clínica Veterinária Exemplo',
    description: "The name of the client confirmed as the note's taker",
  })
  takerName!: string;

  @ApiProperty({
    description:
      'Whether the original PDF is available (GET /service-invoices/:id/file)',
  })
  hasFile!: boolean;
}
