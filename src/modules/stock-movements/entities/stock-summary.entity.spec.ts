import {
  AdjustmentReason,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { StockSummaryEntity } from './stock-summary.entity';
import {
  type SummarizableMovement,
  periodBalance,
  summarizePeriod,
} from '../domain/stock-summary.rules';

const { INBOUND, OUTBOUND } = StockMovementType;
const { MANUAL_PURCHASE, APPOINTMENT, MANUAL_ADJUSTMENT } = StockMovementSource;

/** Same worked example as the domain spec: +10, −3, −2, −1 expired; opening 4. */
const september: SummarizableMovement[] = [
  { type: INBOUND, source: MANUAL_PURCHASE, quantity: 10, unitCost: 5 },
  {
    type: OUTBOUND,
    source: APPOINTMENT,
    quantity: 3,
    unitCost: 5,
    procedureName: 'Castration',
  },
  {
    type: OUTBOUND,
    source: APPOINTMENT,
    quantity: 2,
    unitCost: 5,
    procedureName: 'Castration',
  },
  {
    type: OUTBOUND,
    source: MANUAL_ADJUSTMENT,
    adjustmentReason: AdjustmentReason.EXPIRATION,
    quantity: 1,
    unitCost: 5,
  },
];

describe('StockSummaryEntity.from', () => {
  it('serializes every block as strings, money with two decimals', () => {
    const entity = StockSummaryEntity.from(
      summarizePeriod(september),
      periodBalance(4, september),
    );

    expect(entity).toEqual({
      inbound: { quantity: '10', value: '50.00' },
      outbound: { quantity: '6', value: '30.00' },
      consumptionByProcedure: [
        { procedureName: 'Castration', quantity: '5', value: '25.00' },
      ],
      adjustmentsByReason: [
        {
          reason: AdjustmentReason.EXPIRATION,
          type: OUTBOUND,
          quantity: '1',
          value: '5.00',
        },
      ],
      item: {
        openingBalance: '4',
        inbound: '10',
        outbound: '6',
        closingBalance: '8',
      },
    });
  });

  it('leaves item null when no item was asked for', () => {
    const entity = StockSummaryEntity.from(summarizePeriod([]), null);

    expect(entity.item).toBeNull();
    expect(entity.inbound).toEqual({ quantity: '0', value: '0.00' });
  });
});
