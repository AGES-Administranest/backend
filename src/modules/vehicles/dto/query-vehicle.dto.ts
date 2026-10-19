import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

// No `userId`: the listing is scoped to the token's owner (ADR-11).
export class QueryVehicleDto {
  @ApiPropertyOptional({
    default: true,
    description:
      'Active vehicles by default; false lists only the inactive ones. Deleted vehicles are never listed',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'false' ? false : value === 'true' ? true : value,
  )
  @IsBoolean()
  active: boolean = true;
}
