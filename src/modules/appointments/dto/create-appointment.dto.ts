import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

// No `userId`: the owner comes from the token, never from the request (ADR-11).
export class CreateAppointmentDto {
  @ApiPropertyOptional({ example: '3f7b1c4a-8e2d-4f1a-9c3b-2d4e5f6a7b8c' })
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @ApiPropertyOptional({ example: 'Consulta de rotina' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  procedureName?: string;

  @ApiProperty({ example: '2026-09-25T13:00:00.000Z' })
  @IsDateString()
  startsAt!: string;

  // Required here even though the schema allows null: conflict detection
  // needs a closed interval to compare against.
  @ApiProperty({ example: '2026-09-25T14:00:00.000Z' })
  @IsDateString()
  endsAt!: string;

  @ApiPropertyOptional({ example: 'Trazer exames anteriores' })
  @IsOptional()
  @IsString()
  notes?: string;
}
