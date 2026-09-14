import { ApiProperty } from '@nestjs/swagger';

import { StockMovementEntity } from './stock-movement.entity';

/** An item's balance as the server holds it now, for the device to reconcile against. */
export class SyncedItemBalanceEntity {
  @ApiProperty({ format: 'uuid' })
  itemId!: string;

  @ApiProperty()
  itemName!: string;

  @ApiProperty({ type: String, example: '12.5' })
  currentQuantity!: string;

  @ApiProperty({
    description: 'US10: the item is waiting for a physical count',
  })
  needsAdjustment!: boolean;
}

/**
 * Result of pushing a batch of movements recorded offline.
 *
 * `duplicated` is the whole point of the operation: the network drops halfway
 * through a sync more often than anyone plans for, and the device re-sends.
 * Reporting the ids that were already here — instead of applying them again —
 * is what keeps a retry from taking the same stock out twice.
 */
export class StockSyncPushEntity {
  @ApiProperty({ type: StockMovementEntity, isArray: true })
  applied!: StockMovementEntity[];

  @ApiProperty({
    type: String,
    isArray: true,
    description: 'Ids the ledger already held — a retry, not a new fact',
  })
  duplicated!: string[];

  @ApiProperty({
    type: SyncedItemBalanceEntity,
    isArray: true,
    description: 'Balance of every item the batch touched, after applying it',
  })
  balances!: SyncedItemBalanceEntity[];

  @ApiProperty({
    type: String,
    isArray: true,
    description:
      'Items left with a negative balance because another device had already ' +
      'taken the stock out. The movement is kept — the consumption did happen — ' +
      'and the item is flagged for a count.',
  })
  needsAdjustment!: string[];
}

/** Result of pulling everything written since the device's last cursor. */
export class StockSyncPullEntity {
  @ApiProperty({ type: StockMovementEntity, isArray: true })
  movements!: StockMovementEntity[];

  @ApiProperty({
    type: SyncedItemBalanceEntity,
    isArray: true,
    description:
      'Current balance of every item in this delta, so the device does not ' +
      'have to replay its whole local history to find out where it stands',
  })
  balances!: SyncedItemBalanceEntity[];

  @ApiProperty({
    type: String,
    format: 'date-time',
    description:
      'Cursor for the next pull. Already stepped back by a safety window, so a ' +
      'row committed out of order is re-sent rather than skipped (ADR-08) — ' +
      'which is safe precisely because applying a movement twice is a no-op.',
  })
  cursor!: Date;
}
