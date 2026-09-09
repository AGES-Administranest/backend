import { ApiProperty } from '@nestjs/swagger';

export class DeleteItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Injectable dipyrone 500mg/mL' })
  name!: string;
}
