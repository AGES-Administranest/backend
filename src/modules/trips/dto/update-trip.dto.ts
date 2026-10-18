import { OmitType, PartialType } from '@nestjs/swagger';

import { CreateTripDto } from './create-trip.dto';

/**
 * An absent field keeps its value; `null` clears an optional one. The id is
 * fixed once the trip exists.
 *
 * `skipNullProperties: false`: by default PartialType skips validation for
 * null as well as for a missing field, and `{ "origin": null }` would reach the
 * NOT NULL column and come back as a 500 instead of a 400.
 */
export class UpdateTripDto extends PartialType(
  OmitType(CreateTripDto, ['id'] as const),
  { skipNullProperties: false },
) {}
