import {
  AdjustmentReason,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import {
  adjustmentsByReason,
  consumptionByProcedure,
  directionTotals,
  itemPeriodBalance,
  procedureKey,
  type SummarisableMovement,
} from '../../../../src/modules/stock-movements/domain/stock-summary.rules';

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);

const movement = (
  over: Partial<SummarisableMovement> = {},
): SummarisableMovement => ({
  type: StockMovementType.OUTBOUND,
  source: StockMovementSource.APPOINTMENT,
  quantity: decimal(1),
  unitCost: decimal(10),
  adjustmentReason: null,
  appointment: { procedureName: 'Castração' },
  ...over,
});

describe('procedureKey', () => {
  it('treats spellings that differ only by case, accents or spacing as one', () => {
    const keys = [
      'Castração',
      'castracao',
      'CASTRAÇÃO',
      '  Castração  ',
      'Castração',
    ].map(procedureKey);

    expect(new Set(keys).size).toBe(1);
  });

  it('collapses repeated spaces inside the name', () => {
    expect(procedureKey('Orquiectomia   eletiva')).toBe(
      procedureKey('Orquiectomia eletiva'),
    );
  });

  it('keeps genuinely different procedures apart', () => {
    expect(procedureKey('Castração')).not.toBe(procedureKey('Orquiectomia'));
  });
});

describe('directionTotals', () => {
  it('sums quantity and value on each side', () => {
    const { inbound, outbound } = directionTotals([
      movement({
        type: StockMovementType.INBOUND,
        quantity: decimal(3),
        unitCost: decimal(5),
      }),
      movement({
        type: StockMovementType.OUTBOUND,
        quantity: decimal(2),
        unitCost: decimal(10),
      }),
      movement({
        type: StockMovementType.OUTBOUND,
        quantity: decimal(1),
        unitCost: decimal(10),
      }),
    ]);

    expect(inbound).toEqual({ count: 1, quantity: '3', value: '15' });
    expect(outbound).toEqual({ count: 2, quantity: '3', value: '30' });
  });

  it('adds money exactly, without floating point drift', () => {
    // 3 x 19.90 is 59.70, not 59.699999999999996.
    const { outbound } = directionTotals([
      movement({ quantity: decimal(1), unitCost: decimal('19.90') }),
      movement({ quantity: decimal(1), unitCost: decimal('19.90') }),
      movement({ quantity: decimal(1), unitCost: decimal('19.90') }),
    ]);

    expect(outbound.value).toBe('59.7');
  });

  it('reports zeros for an empty period instead of blowing up', () => {
    const { inbound, outbound } = directionTotals([]);
    expect(inbound).toEqual({ count: 0, quantity: '0', value: '0' });
    expect(outbound).toEqual({ count: 0, quantity: '0', value: '0' });
  });
});

describe('consumptionByProcedure', () => {
  it('groups the variants together and labels them with the common spelling', () => {
    const groups = consumptionByProcedure([
      movement({ appointment: { procedureName: 'Castração' } }),
      movement({ appointment: { procedureName: 'castracao' } }),
      movement({ appointment: { procedureName: 'Castração' } }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ label: 'Castração', count: 3 });
  });

  it('ignores movements that did not come from an appointment', () => {
    const groups = consumptionByProcedure([
      movement(),
      movement({
        source: StockMovementSource.MANUAL_ADJUSTMENT,
        appointment: null,
      }),
      movement({
        source: StockMovementSource.MANUAL_PURCHASE,
        appointment: null,
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(1);
  });

  it('breaks a tie with the spelling written first, not the alphabet', () => {
    // Alphabetically "castracao" wins, which would label the row with the typo.
    const groups = consumptionByProcedure([
      movement({ appointment: { procedureName: 'Castração' } }),
      movement({ appointment: { procedureName: 'castracao' } }),
    ]);

    expect(groups[0].label).toBe('Castração');
  });

  it('puts the heaviest consumer first', () => {
    const groups = consumptionByProcedure([
      movement({
        appointment: { procedureName: 'Barato' },
        unitCost: decimal(1),
      }),
      movement({
        appointment: { procedureName: 'Caro' },
        unitCost: decimal(100),
      }),
    ]);

    expect(groups.map(g => g.label)).toEqual(['Caro', 'Barato']);
  });

  it('labels an appointment with no procedure instead of showing a blank row', () => {
    const groups = consumptionByProcedure([
      movement({ appointment: { procedureName: null } }),
    ]);

    expect(groups[0].label).toBe('Sem procedimento');
  });
});

describe('adjustmentsByReason', () => {
  const adjustment = (reason: AdjustmentReason, unitCost: number) =>
    movement({
      source: StockMovementSource.MANUAL_ADJUSTMENT,
      adjustmentReason: reason,
      appointment: null,
      unitCost: decimal(unitCost),
    });

  it('groups by reason, most expensive first', () => {
    const groups = adjustmentsByReason([
      adjustment(AdjustmentReason.BREAKAGE, 5),
      adjustment(AdjustmentReason.EXPIRATION, 50),
      adjustment(AdjustmentReason.EXPIRATION, 30),
    ]);

    expect(groups[0]).toMatchObject({
      reason: AdjustmentReason.EXPIRATION,
      count: 2,
      value: '80',
    });
    expect(groups[1].reason).toBe(AdjustmentReason.BREAKAGE);
  });

  it('ignores everything that is not a manual adjustment', () => {
    expect(adjustmentsByReason([movement()])).toEqual([]);
  });
});

describe('itemPeriodBalance', () => {
  it('closes at opening + inbound - outbound', () => {
    const result = itemPeriodBalance(decimal(8), [
      movement({ type: StockMovementType.INBOUND, quantity: decimal(10) }),
      movement({ type: StockMovementType.OUTBOUND, quantity: decimal(4) }),
    ]);

    expect(result.openingBalance).toBe('8');
    expect(result.closingBalance).toBe('14');
  });

  it('carries a negative opening balance through instead of clamping it', () => {
    // An item in the red at the start of the period is a real state (US10).
    const result = itemPeriodBalance(decimal(-3), [
      movement({ type: StockMovementType.INBOUND, quantity: decimal(1) }),
    ]);

    expect(result.closingBalance).toBe('-2');
  });

  it('closes where it opened when nothing moved', () => {
    const result = itemPeriodBalance(decimal(5), []);
    expect(result.closingBalance).toBe('5');
  });
});
