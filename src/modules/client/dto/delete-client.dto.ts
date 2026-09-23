import { ApiProperty } from '@nestjs/swagger';

export class DeleteClientDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Hospital Veterinário Centro' })
  name!: string;
}
