import {
  AdjustmentReason,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import {
  assertPositiveQuantity,
  assertSufficientBalance,
  assertValidMovement,
  balanceRequiresAdjustment,
  Decimal,
  DecimalInput,
  movementForDelta,
  MovementLike,
  reversalType,
  signedQuantity,
  stockBalance,
} from './stock-movement.rules';
import { DomainError } from '../../../shared/errors/domain-error';

const { INBOUND, OUTBOUND } = StockMovementType;

/** Captura o DomainError lançado por `fn` — falha o teste se nada for lançado. */
function catchDomainError(fn: () => unknown): DomainError {
  try {
    fn();
  } catch (error) {
    if (error instanceof DomainError) return error;
    throw error;
  }
  throw new Error('esperava um DomainError, nada foi lançado');
}

/** Compara um `Decimal` pelo valor numérico exato. */
function expectDecimal(actual: Decimal, expected: DecimalInput): void {
  expect(actual.equals(new Prisma.Decimal(expected))).toBe(true);
}

describe('stock-movement rules', () => {
  describe('signedQuantity', () => {
    it('mantém positivo para INBOUND', () => {
      expectDecimal(signedQuantity({ type: INBOUND, quantity: 5 }), 5);
    });

    it('inverte o sinal para OUTBOUND', () => {
      expectDecimal(signedQuantity({ type: OUTBOUND, quantity: 5 }), -5);
    });

    it.each(['0', '-1', 'NaN', 'Infinity'])(
      'rejeita quantity não-positiva (%p)',
      quantity => {
        expect(() =>
          signedQuantity({ type: INBOUND, quantity: Number(quantity) }),
        ).toThrow(DomainError);
      },
    );
  });

  describe('stockBalance', () => {
    it('soma entradas e saídas pelo type', () => {
      const balance = stockBalance([
        { type: INBOUND, quantity: 10 },
        { type: OUTBOUND, quantity: 3 },
        { type: INBOUND, quantity: 2 },
      ]);
      expectDecimal(balance, 9);
    });

    it('não acumula resíduo de float em quantidades NUMERIC(14,3)', () => {
      const balance = stockBalance([
        { type: INBOUND, quantity: '0.300' },
        { type: OUTBOUND, quantity: '0.100' },
        { type: OUTBOUND, quantity: '0.200' },
      ]);
      expectDecimal(balance, 0);
      expect(balanceRequiresAdjustment(balance)).toBe(false);
    });

    it('ignora movimentações com soft delete', () => {
      const balance = stockBalance([
        { type: INBOUND, quantity: 10 },
        { type: OUTBOUND, quantity: 4, deletedAt: new Date() },
      ]);
      expectDecimal(balance, 10);
    });

    it('lista vazia é saldo 0', () => {
      expectDecimal(stockBalance([]), 0);
    });

    it('pode ficar negativo (estorno maior que o saldo)', () => {
      const balance = stockBalance([
        { type: INBOUND, quantity: 2 },
        { type: OUTBOUND, quantity: 5 },
      ]);
      expectDecimal(balance, -3);
    });
  });

  describe('reversalType', () => {
    it('estorno de entrada é saída e vice-versa', () => {
      expect(reversalType(INBOUND)).toBe(OUTBOUND);
      expect(reversalType(OUTBOUND)).toBe(INBOUND);
    });

    it('estorno anula o efeito no saldo', () => {
      const original = { type: INBOUND, quantity: 7 };
      const reversal = { type: reversalType(original.type), quantity: 7 };
      expectDecimal(stockBalance([original, reversal]), 0);
    });
  });

  describe('movementForDelta', () => {
    it('delta positivo vira INBOUND com quantity positiva', () => {
      const m = movementForDelta(4)!;
      expect(m.type).toBe(INBOUND);
      expectDecimal(m.quantity, 4);
    });

    it('delta negativo vira OUTBOUND com quantity positiva', () => {
      const m = movementForDelta(-4)!;
      expect(m.type).toBe(OUTBOUND);
      expectDecimal(m.quantity, 4);
    });

    it('delta zero não gera movimentação', () => {
      expect(movementForDelta(0)).toBeNull();
      expect(movementForDelta('0.000')).toBeNull();
    });

    it('resíduo de float que deveria ser zero: com Decimal é zero de verdade', () => {
      const delta = new Prisma.Decimal('0.1').plus('0.2').minus('0.3');
      expect(movementForDelta(delta)).toBeNull();
    });

    it('round-trip: aplicar o movimento produz o delta', () => {
      for (const delta of [3, -3, 1, -10]) {
        const m = movementForDelta(delta)!;
        expectDecimal(signedQuantity(m), delta);
      }
    });
  });

  describe('balanceRequiresAdjustment (US10)', () => {
    it.each<[DecimalInput, boolean]>([
      [-1, true],
      ['-0.001', true],
      [0, false],
      [5, false],
    ])('saldo %p → %p', (balance, expected) => {
      expect(balanceRequiresAdjustment(balance)).toBe(expected);
    });
  });

  describe('assertValidMovement', () => {
    const base = { type: OUTBOUND, quantity: 1 };

    it('aceita MANUAL_ADJUSTMENT com motivo', () => {
      expect(() =>
        assertValidMovement({
          ...base,
          source: StockMovementSource.MANUAL_ADJUSTMENT,
          adjustmentReason: AdjustmentReason.LOSS,
        }),
      ).not.toThrow();
    });

    it('rejeita MANUAL_ADJUSTMENT sem motivo', () => {
      const error = catchDomainError(() =>
        assertValidMovement({
          ...base,
          source: StockMovementSource.MANUAL_ADJUSTMENT,
          adjustmentReason: null,
        }),
      );
      expect(error.code).toBe('STOCK_REASON_ADJUSTMENT_INVALID');
      expect(error.kind).toBe('INVALID_INPUT');
    });

    it('rejeita motivo em origem que não é ajuste', () => {
      const error = catchDomainError(() =>
        assertValidMovement({
          ...base,
          source: StockMovementSource.APPOINTMENT,
          adjustmentReason: AdjustmentReason.LOSS,
        }),
      );
      expect(error.code).toBe('STOCK_REASON_ADJUSTMENT_INVALID');
    });

    it.each([
      { source: StockMovementSource.MANUAL_PURCHASE },
      { source: StockMovementSource.ORDER_IMPORT, purchaseOrderId: 'po-1' },
      { source: StockMovementSource.APPOINTMENT, appointmentId: 'appt-1' },
      { source: StockMovementSource.CORRECTION_REVERSAL },
    ])('aceita %s sem motivo', ({ source, ...extra }) => {
      expect(() =>
        assertValidMovement({ ...base, source, adjustmentReason: null, ...extra }),
      ).not.toThrow();
    });

    it('rejeita APPOINTMENT sem appointmentId', () => {
      const error = catchDomainError(() =>
        assertValidMovement({
          ...base,
          source: StockMovementSource.APPOINTMENT,
          adjustmentReason: null,
          appointmentId: null,
        }),
      );
      expect(error.code).toBe('STOCK_APPOINTMENT_ID_REQUIRED');
    });

    it('rejeita ORDER_IMPORT sem purchaseOrderId', () => {
      const error = catchDomainError(() =>
        assertValidMovement({
          ...base,
          source: StockMovementSource.ORDER_IMPORT,
          adjustmentReason: null,
          purchaseOrderId: null,
        }),
      );
      expect(error.code).toBe('STOCK_PURCHASE_ORDER_ID_REQUIRED');
    });
  });

  describe('assertPositiveQuantity', () => {
    it('passa para valor positivo e devolve o Decimal', () => {
      expectDecimal(assertPositiveQuantity('0.5'), '0.5');
    });

    it.each<DecimalInput>([0, -1, NaN, Infinity, 'abc'])(
      'lança DomainError INVALID_INPUT para %p',
      quantity => {
        const error = catchDomainError(() => assertPositiveQuantity(quantity));
        expect(error.kind).toBe('INVALID_INPUT');
        expect(error.code).toBe('STOCK_QUANTITY_INVALID');
      },
    );
  });

  describe('assertSufficientBalance', () => {
    const inboundOf = (quantity: DecimalInput): MovementLike => ({
      type: StockMovementType.INBOUND,
      quantity,
    });

    const outboundOf = (quantity: DecimalInput): MovementLike => ({
      type: StockMovementType.OUTBOUND,
      quantity,
    });

    it('returns the resulting balance when it stays non-negative', () => {
      const result = assertSufficientBalance(10, outboundOf(4), {
        allowNegativeBalance: false,
      });
      expect(result.toString()).toBe('6');
    });

    it('allows a resulting balance of exactly zero', () => {
      const result = assertSufficientBalance(10, outboundOf(10), {
        allowNegativeBalance: false,
      });
      expect(result.toString()).toBe('0');
    });

    it('blocks an outbound that would leave the balance negative, by default', () => {
      expect(() =>
        assertSufficientBalance(5, outboundOf(8), {
          allowNegativeBalance: false,
        }),
      ).toThrow(DomainError);
    });

    it('allows a negative resulting balance when explicitly authorized', () => {
      const result = assertSufficientBalance(5, outboundOf(8), {
        allowNegativeBalance: true,
      });
      expect(result.toString()).toBe('-3');
    });

    it('never blocks an inbound movement', () => {
      const result = assertSufficientBalance(-3, inboundOf(3), {
        allowNegativeBalance: false,
      });
      expect(result.toString()).toBe('0');
    });
  });
});
