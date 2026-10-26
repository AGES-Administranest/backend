import { ApiProperty } from '@nestjs/swagger';

export class ServiceInvoiceConfirmationDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The income entry the note recorded in the statement',
  })
  financialEntryId!: string;
}
