import { ApiProperty } from '@nestjs/swagger';

import { StockMovementEntity } from './stock-movement.entity';

/**
 * What a write to the ledger answers: the movement, plus the two alerts the
 * caller cannot work out on its own.
 *
 * The alerts ride along with the write on purpose. Both are decided inside the
 * row lock, from the balance this very movement produced — asking for them in a
 * second request would be asking a question whose answer has already changed.
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
