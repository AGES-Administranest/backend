import { ApiProperty } from '@nestjs/swagger';

export class DeleteItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Dipirona injetável 500mg/mL' })
  name!: string;
}
