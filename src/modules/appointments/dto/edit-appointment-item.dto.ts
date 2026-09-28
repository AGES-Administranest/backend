import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, IsUUID } from 'class-validator';

// No `userId`: the owner comes from the token, never from the request (ADR-11).
export class EditAppointmentItemDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Idempotency key for the movement that replaces the edited one (ADR-09). Resending the edit with the same key returns that movement instead of correcting the stock again.',
  })
  @IsOptional()
  @IsUUID()
  clientGeneratedId?: string;

  @ApiProperty({
    example: 2,
    description: 'New quantity used, in the item unit',
  })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  quantity!: number;
}
