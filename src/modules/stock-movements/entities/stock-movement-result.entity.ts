import { ApiProperty } from '@nestjs/swagger';

import { StockMovementEntity } from './stock-movement.entity';

/**
 * The movement, plus the two alerts decided inside the row lock from the
 * balance it produced — asking for them later would be asking a stale question.
 */
export class StockMovementResultEntity {
  @ApiProperty({ type: StockMovementEntity })
  movement!: StockMovementEntity;

  @ApiProperty({
    type: String,
    example: '6.000',
    description: "The item's balance after this movement",
  })
  balance!: string;

  @ApiProperty({
    description:
      'US11: the balance is at or under the item minimumStock. Always false ' +
      'when the item has no minimum set.',
  })
  belowMinimum!: boolean;

  @ApiProperty({
    description:
      'US10: the item is flagged as needing a physical count. Turned on when a ' +
      'movement leaves the balance negative; only POST /stock-movement/count ' +
      'turns it off.',
  })
  needsAdjustment!: boolean;
}
