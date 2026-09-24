import { ApiPropertyOptional } from '@nestjs/swagger';
import { ClientType } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

// No `userId`: the listing is scoped to the token's owner (ADR-11).
export class QueryClientDto {
  @ApiPropertyOptional({
    enum: ClientType,
    description: 'Absent means clinics and individuals alike',
  })
  @IsOptional()
  @IsEnum(ClientType)
  type?: ClientType;
}
