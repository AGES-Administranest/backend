import {
  AdjustmentReason,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import {
  type Decimal,
  type DecimalInput,
  stockBalance,
} from './stock-movement.rules';
import {
  type SummarizableMovement,
  balanceFromSums,
  movementValue,
  periodBalance,
  summarizePeriod,
} from './stock-summary.rules';
import { DomainError } from '../../../shared/errors/domain-error';

const { INBOUND, OUTBOUND } = StockMovementType;
const {
  MANUAL_PURCHASE,
  ORDER_IMPORT,
  APPOINTMENT,
  MANUAL_ADJUSTMENT,
  CORRECTION_REVERSAL,
} = StockMovementSource;
const { LOSS, EXPIRATION, OTHER } = AdjustmentReason;

/** An outbound consumed in an appointment, unless overridden. */
function movement(
  overrides: Partial<SummarizableMovement> = {},
): SummarizableMovement {
  return {
    type: OUTBOUND,
    source: APPOINTMENT,
    quantity: 1,
    unitCost: 5,
    ...overrides,
  };
}

/** Compares by numeric value; the message shows both numbers when it fails. */
function expectDecimal(actual: Decimal, expected: DecimalInput): void {
  expect(actual.toFixed()).toBe(new Prisma.Decimal(expected).toFixed());
}

/**
 * The worked example from the design discussion: 10 bought, 5 used in two
 * castrations, 1 expired. Opening balance 4 → closing 8.
 */
const september: SummarizableMovement[] = [
  movement({ type: INBOUND, source: MANUAL_PURCHASE, quantity: 10 }),
  movement({ quantity: 3, procedureName: 'Castration' }),
  movement({ quantity: 2, procedureName: 'Castration' }),
  movement({
    source: MANUAL_ADJUSTMENT,
    adjustmentReason: EXPIRATION,
    quantity: 1,
  }),
];

describe('movementValue', () => {
  it('multiplies quantity by unit cost exactly', () => {
    expectDecimal(movementValue({ quantity: 3, unitCost: '5.5' }), '16.5');
  });

  it('has no float residue (0.1 × 3 is 0.3, not 0.30000000000000004)', () => {
    expectDecimal(movementValue({ quantity: '0.1', unitCost: 3 }), '0.3');
  });

  it('rejects a non-positive quantity', () => {
    expect(() => movementValue({ quantity: 0, unitCost: 5 })).toThrow(
      DomainError,
    );
  });
});

describe('balanceFromSums', () => {
  it.each<[DecimalInput | null, DecimalInput | null, DecimalInput]>([
    [10, 4, 6],
    [null, null, 0],
    [null, 3, -3],
    ['2.5', null, '2.5'],
  ])('inbound %p minus outbound %p is %p', (inbound, outbound, expected) => {
    expectDecimal(balanceFromSums(inbound, outbound), expected);
  });
});

describe('summarizePeriod', () => {
  it('totals the September example: inbound, outbound, by procedure and by reason', () => {
    const summary = summarizePeriod(september);

    expectDecimal(summary.inbound.quantity, 10);
    expectDecimal(summary.inbound.value, 50);
    expectDecimal(summary.outbound.quantity, 6);
    expectDecimal(summary.outbound.value, 30);

    expect(summary.consumptionByProcedure).toHaveLength(1);
    expect(summary.consumptionByProcedure[0].procedureName).toBe('Castration');
    expectDecimal(summary.consumptionByProcedure[0].quantity, 5);
    expectDecimal(summary.consumptionByProcedure[0].value, 25);

    expect(summary.adjustmentsByReason).toHaveLength(1);
    expect(summary.adjustmentsByReason[0]).toMatchObject({
      reason: EXPIRATION,
      type: OUTBOUND,
    });
    expectDecimal(summary.adjustmentsByReason[0].quantity, 1);
    expectDecimal(summary.adjustmentsByReason[0].value, 5);
  });

  it('is all zeros for an empty period', () => {
    const summary = summarizePeriod([]);

    expectDecimal(summary.inbound.quantity, 0);
    expectDecimal(summary.inbound.value, 0);
    expectDecimal(summary.outbound.quantity, 0);
    expectDecimal(summary.outbound.value, 0);
    expect(summary.consumptionByProcedure).toEqual([]);
    expect(summary.adjustmentsByReason).toEqual([]);
  });

  it('ignores soft-deleted movements', () => {
    const deleted = movement({
      type: INBOUND,
      source: MANUAL_PURCHASE,
      quantity: 999,
      deletedAt: new Date(),
    });

    const summary = summarizePeriod([...september, deleted]);

    expectDecimal(summary.inbound.quantity, 10);
  });

  it('counts inbound of every source: purchases, imports, reversals and inbound adjustments', () => {
    const summary = summarizePeriod([
      movement({ type: INBOUND, source: MANUAL_PURCHASE, quantity: 10 }),
      movement({ type: INBOUND, source: ORDER_IMPORT, quantity: 5 }),
      movement({ type: INBOUND, source: CORRECTION_REVERSAL, quantity: 2 }),
      movement({
        type: INBOUND,
        source: MANUAL_ADJUSTMENT,
        adjustmentReason: OTHER,
        quantity: 1,
      }),
    ]);

    expectDecimal(summary.inbound.quantity, 18);
    expectDecimal(summary.outbound.quantity, 0);
  });

  it('groups consumption by procedure, largest value first, then by name', () => {
    const summary = summarizePeriod([
      movement({ quantity: 1, unitCost: 10, procedureName: 'Anesthesia' }),
      movement({ quantity: 3, unitCost: 5, procedureName: 'Castration' }),
      movement({ quantity: 2, unitCost: 5, procedureName: 'Dental' }),
    ]);

    expect(
      summary.consumptionByProcedure.map(entry => entry.procedureName),
    ).toEqual(['Castration', 'Anesthesia', 'Dental']);
  });

  it('puts appointments without a procedure name (or a blank one) in one null bucket', () => {
    const summary = summarizePeriod([
      movement({ procedureName: null }),
      movement({ procedureName: undefined }),
      movement({ procedureName: '   ' }),
    ]);

    expect(summary.consumptionByProcedure).toHaveLength(1);
    expect(summary.consumptionByProcedure[0].procedureName).toBeNull();
    expectDecimal(summary.consumptionByProcedure[0].quantity, 3);
  });

  it('leaves non-appointment outbounds out of the procedure block but inside the outbound total', () => {
    const summary = summarizePeriod([
      movement({
        source: MANUAL_ADJUSTMENT,
        adjustmentReason: LOSS,
        quantity: 2,
      }),
      movement({ quantity: 1, procedureName: 'Castration' }),
    ]);

    expectDecimal(summary.outbound.quantity, 3);
    expectDecimal(summary.consumptionByProcedure[0].quantity, 1);
  });

  it('keeps an inbound adjustment apart from an outbound one with the same reason', () => {
    const summary = summarizePeriod([
      movement({
        source: MANUAL_ADJUSTMENT,
        adjustmentReason: OTHER,
        quantity: 2,
      }),
      movement({
        type: INBOUND,
        source: MANUAL_ADJUSTMENT,
        adjustmentReason: OTHER,
        quantity: 5,
      }),
    ]);

    expect(summary.adjustmentsByReason).toHaveLength(2);
    // Largest value first: 5 × 5 = 25 (inbound) before 2 × 5 = 10 (outbound).
    expect(summary.adjustmentsByReason[0]).toMatchObject({
      reason: OTHER,
      type: INBOUND,
    });
    expect(summary.adjustmentsByReason[1]).toMatchObject({
      reason: OTHER,
      type: OUTBOUND,
    });
  });

  it('falls back to OTHER when a manual adjustment carries no reason', () => {
    const summary = summarizePeriod([
      movement({ source: MANUAL_ADJUSTMENT, adjustmentReason: null }),
    ]);

    expect(summary.adjustmentsByReason[0].reason).toBe(OTHER);
  });

  it('rounds money once per block, not per movement', () => {
    // 0.004 + 0.004 = 0.008 → R$ 0.01. Rounding each movement first would
    // give 0.00 + 0.00 = 0.00 and silently lose the cent.
    const summary = summarizePeriod([
      movement({ quantity: 1, unitCost: '0.004' }),
      movement({ quantity: 1, unitCost: '0.004' }),
    ]);

    expectDecimal(summary.outbound.value, '0.01');
  });

  it('rounds to cents with unit costs of 4 decimal places', () => {
    const summary = summarizePeriod([
      movement({ quantity: 3, unitCost: '1.2345' }),
    ]);

    // exact 3.7035 → 3.70
    expectDecimal(summary.outbound.value, '3.7');
  });
});

describe('periodBalance', () => {
  it('opening + inbound − outbound = closing (September: 4 + 10 − 6 = 8)', () => {
    const balance = periodBalance(4, september);

    expectDecimal(balance.openingBalance, 4);
    expectDecimal(balance.inbound, 10);
    expectDecimal(balance.outbound, 6);
    expectDecimal(balance.closingBalance, 8);
  });

  it('closes at the opening balance when the period has no movements', () => {
    const balance = periodBalance('12.5', []);

    expectDecimal(balance.closingBalance, '12.5');
    expectDecimal(balance.inbound, 0);
    expectDecimal(balance.outbound, 0);
  });

  it('may close negative (ADR-10: a negative balance means a wrong inventory, not an error)', () => {
    const balance = periodBalance(2, [movement({ quantity: 5 })]);

    expectDecimal(balance.closingBalance, -3);
  });

  it('ignores soft-deleted movements', () => {
    const balance = periodBalance(0, [
      movement({ quantity: 5, deletedAt: new Date() }),
      movement({ type: INBOUND, source: MANUAL_PURCHASE, quantity: 1 }),
    ]);

    expectDecimal(balance.closingBalance, 1);
  });

  it('agrees with stockBalance: closing = opening + net of the period', () => {
    const balance = periodBalance(4, september);

    expectDecimal(
      balance.closingBalance,
      new Prisma.Decimal(4).plus(stockBalance(september)),
    );
  });

  it('rejects a non-positive quantity', () => {
    expect(() => periodBalance(0, [movement({ quantity: -1 })])).toThrow(
      DomainError,
    );
  });
});
