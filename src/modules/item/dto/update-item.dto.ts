import { OmitType, PartialType } from '@nestjs/swagger';

import { CreateItemDto } from './create-item.dto';

/**
 * No `currentQuantity`: the balance is the sum of the item's movements
 * (ADR-10), and writing the column directly would be undone by the next one.
 * A shelf that disagrees is fixed with `POST /stock-movement/count`.
 */
export class UpdateItemDto extends PartialType(
  OmitType(CreateItemDto, ['currentQuantity'] as const),
) {}
