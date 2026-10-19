import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class CheckConflictQueryDto {
  @ApiProperty({ example: '2026-09-25T13:00:00.000Z' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ example: '2026-09-25T14:00:00.000Z' })
  @IsDateString()
  endsAt!: string;

  @ApiPropertyOptional({
    description: 'The appointment being edited, excluded from its own check',
  })
  @IsOptional()
  @IsUUID()
  excludeId?: string;
}
