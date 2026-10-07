import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

// No `userId`: the listing is scoped to the token's owner (ADR-11).
export class QueryVehicleDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'false' ? false : value === 'true' ? true : value,
  )
  @IsBoolean()
  active: boolean = true;
}
