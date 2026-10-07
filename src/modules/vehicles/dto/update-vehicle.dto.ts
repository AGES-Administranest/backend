import { PartialType } from '@nestjs/swagger';
import { IsBoolean, ValidateIf } from 'class-validator';

import { CreateVehicleDto } from './create-vehicle.dto';

/**
 * `skipNullProperties: false`: by default PartialType skips validation for
 * null as well as for a missing field, and `{ "brand": null }` would reach the
 * NOT NULL column and come back as a 500 instead of a 400.
 */
export class UpdateVehicleDto extends PartialType(CreateVehicleDto, {
  skipNullProperties: false,
}) {
  /** `true` reactivates an inactivated vehicle; `false` is the same as DELETE. */
  @ValidateIf((_dto, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}
