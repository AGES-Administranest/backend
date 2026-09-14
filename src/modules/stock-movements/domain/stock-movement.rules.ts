import {
  AdjustmentReason,
  Prisma,
  StockMovementSource,
  StockMovementType,
} from '@prisma/client';

import { DomainError } from '../../../shared/errors/domain-error';

/**
 * Pure rules for the stock ledger (`stock_movement`).
 *
 * No Nest, no Prisma Client, no HTTP: just the arithmetic and the invariants
 * that the data dictionary describes (see `docs/data-dictionary.md`). The stock
 * service, once it exists, calls these functions; the tests cover them
 * directly.
 **/

export type Decimal = Prisma.Decimal;

/** Accepted wherever a quantity/balance comes in: the DB `Decimal`, or something convertible. */
export type DecimalInput = Prisma.Decimal | number | string;

const toDecimal = (value: DecimalInput): Decimal =>
  value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);

/** The minimum a movement needs in order to take part in the balance calculation. */
export interface MovementLike {
  type: StockMovementType;
  /** positive magnitude — the sign comes from `type`, never from here */
  quantity: DecimalInput;
  /** soft-deleted movements do not count towards the balance */
  deletedAt?: Date | null;
}

/** Complete shape validated by {@link assertValidMovement}. */
export interface MovementShape extends MovementLike {
  source: StockMovementSource;
  adjustmentReason?: AdjustmentReason | null;
  appointmentId?: string | null;
  purchaseOrderId?: string | null;
  notes?: string | null;
}

/**
 * `quantity` with the sign of `type`. This is the only correct way to turn a
 * `stock_movement` row into a summable number.
 *
 * @throws DomainError if `quantity` is not strictly positive.
 */
export function signedQuantity(movement: MovementLike): Decimal {
  const quantity = assertPositiveQuantity(movement.quantity);
  return movement.type === StockMovementType.INBOUND
    ? quantity
    : quantity.negated();
}

/**
 * Balance resulting from a list of movements. Ignores those with `deletedAt`
 * set (soft delete).
 */
export function stockBalance(movements: readonly MovementLike[]): Decimal {
  return movements
    .filter(m => m.deletedAt == null)
    .reduce((total, m) => total.plus(signedQuantity(m)), new Prisma.Decimal(0));
}

/**
 * The `type` of a reversal (`source = CORRECTION_REVERSAL`): always the opposite
 * of the record being corrected, with the same `quantity`.
 */
export function reversalType(original: StockMovementType): StockMovementType {
  return original === StockMovementType.INBOUND
    ? StockMovementType.OUTBOUND
    : StockMovementType.INBOUND;
}

/**
 * Translates a balance correction (signed delta) into the canonical shape:
 * positive `quantity` + `type`. A delta of exactly zero produces no movement.
 */
export function movementForDelta(
  delta: DecimalInput,
): { type: StockMovementType; quantity: Decimal } | null {
  const d = toDecimal(delta);
  if (d.isZero()) return null;
  return d.isPositive()
    ? { type: StockMovementType.INBOUND, quantity: d }
    : { type: StockMovementType.OUTBOUND, quantity: d.negated() };
}

/**
 * US10: a negative balance is the trigger to mark the item as "needs
 * adjustment". The flag itself (`item.needs_adjustment`) is persisted — it stays
 * on even if a later inbound clears the negative, until the user records the
 * adjustment. This function is just the trigger condition.
 */
export function balanceRequiresAdjustment(balance: DecimalInput): boolean {
  return toDecimal(balance).isNegative();
}

/**
 * Guards the balance against an outbound bigger than what is in stock.
 *
 * `allowNegativeBalance` is the explicit authorization the US10 correction
 * reversal needs: it has to go through even when it drives the balance below
 * zero, because the reversal is undoing stock that was never physically there.
 * Every ordinary outbound is blocked instead.
 *
 * @returns the balance the item is left with.
 * @throws DomainError `INSUFFICIENT_STOCK`, carrying the balance still
 * available in `details.available` — the app interpolates that number.
 */
export function assertSufficientBalance(
  currentBalance: DecimalInput,
  movement: MovementLike,
  options: { allowNegativeBalance: boolean },
): Decimal {
  const balanceBefore = toDecimal(currentBalance);
  const resultingBalance = balanceBefore.plus(signedQuantity(movement));

  if (resultingBalance.isNegative() && !options.allowNegativeBalance) {
    throw new DomainError(
      'CONFLICT',
      'INSUFFICIENT_STOCK',
      "This movement would leave the item with a negative balance. Check the item's current balance before recording it.",
      {
        // What the caller can still take out. Never negative: an item already
        // in the red has nothing available, not a negative amount of it.
        available: Prisma.Decimal.max(balanceBefore, 0).toString(),
        requested: toDecimal(movement.quantity).toString(),
        currentBalance: balanceBefore.toString(),
        resultingBalance: resultingBalance.toString(),
      },
    );
  }

  return resultingBalance;
}

/**
 * Invariant that Prisma does not express: `adjustmentReason` exists if and only
 * if `source = MANUAL_ADJUSTMENT`.
 *
 * @throws DomainError with kind `INVALID_INPUT`.
 */
export function assertValidMovement(movement: MovementShape): void {
  assertPositiveQuantity(movement.quantity);

  const isAdjustment =
    movement.source === StockMovementSource.MANUAL_ADJUSTMENT;
  const hasReason = movement.adjustmentReason != null;

  if (isAdjustment && !hasReason) {
    throw new DomainError(
      'INVALID_INPUT',
      'STOCK_REASON_ADJUSTMENT_INVALID',
      'A manual stock adjustment requires a reason (adjustmentReason)',
      { source: movement.source },
    );
  }
  if (!isAdjustment && hasReason) {
    throw new DomainError(
      'INVALID_INPUT',
      'STOCK_REASON_ADJUSTMENT_INVALID',
      'adjustmentReason is only valid when source = MANUAL_ADJUSTMENT',
      { source: movement.source },
    );
  }

  // `OTHER` says nothing on its own: without the note the history shows an
  // adjustment whose reason is literally "other", which no one can audit later.
  if (
    movement.adjustmentReason === AdjustmentReason.OTHER &&
    (movement.notes == null || movement.notes.trim() === '')
  ) {
    throw new DomainError(
      'INVALID_INPUT',
      'STOCK_REASON_ADJUSTMENT_INVALID',
      'An adjustment with reason OTHER requires a note describing what happened',
      { adjustmentReason: movement.adjustmentReason },
    );
  }

  const isAppointment = movement.source === StockMovementSource.APPOINTMENT;
  if (isAppointment && movement.appointmentId == null) {
    throw new DomainError(
      'INVALID_INPUT',
      'STOCK_APPOINTMENT_ID_REQUIRED',
      'source = APPOINTMENT requires appointmentId',
      { source: movement.source },
    );
  }

  const isOrderImport = movement.source === StockMovementSource.ORDER_IMPORT;
  if (isOrderImport && movement.purchaseOrderId == null) {
    throw new DomainError(
      'INVALID_INPUT',
      'STOCK_PURCHASE_ORDER_ID_REQUIRED',
      'source = ORDER_IMPORT requires purchaseOrderId',
      { source: movement.source },
    );
  }
}

/**
 * Normalizes and validates a movement quantity.
 *
 * @returns the quantity as a `Decimal`.
 * @throws DomainError if it is not a finite number > 0.
 */
export function assertPositiveQuantity(quantity: DecimalInput): Decimal {
  let d: Decimal;
  try {
    d = toDecimal(quantity);
  } catch {
    d = new Prisma.Decimal(NaN);
  }
  if (!d.isFinite() || d.isNaN() || d.lessThanOrEqualTo(0)) {
    throw new DomainError(
      'INVALID_INPUT',
      'STOCK_QUANTITY_INVALID',
      'the quantity of a stock movement must be positive',
      { quantity: String(quantity) },
    );
  }
  return d;
}
