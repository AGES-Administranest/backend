import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CancelAppointmentDto {
  @ApiProperty({ example: 'Patient did not attend' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  reason!: string;
}
