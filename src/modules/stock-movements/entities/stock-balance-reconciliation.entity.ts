import { ApiProperty } from '@nestjs/swagger';

/**
 * Result of recomputing an item's balance from its movement history.
 *
 * `wasDivergent` is the answer support is actually after: false means the
 * cached balance and the sum of the ledger agreed and nothing was written.
 */
export class StockBalanceReconciliationEntity {
  @ApiProperty({
    type: String,
    example: '12.5',
    description: 'The cached balance as it was before the check',
  })
  previousBalance!: string;

  @ApiProperty({
    type: String,
    example: '10',
    description: 'The balance summed from the ledger — the authoritative one',
  })
  reconciledBalance!: string;

  @ApiProperty({
    description:
      'The two disagreed and the cache was rewritten. Always investigate a ' +
      'true here: every write goes through the ledger, so nothing should be ' +
      'able to make them drift.',
  })
  wasDivergent!: boolean;
}
