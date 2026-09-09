import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AcceptTermsDto {
  @ApiProperty({ example: '2026-09-01' })
  @IsString()
  @IsNotEmpty()
  termsVersion!: string;
}
